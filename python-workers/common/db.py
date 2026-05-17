"""Postgres writeback for scraped results.

Connects to Neon via psycopg over TCP 5432. Vercel functions + Fly.io
machines both have egress on 5432; the Claude Code sandbox does not, so
set `PYTHONWORKERS_SKIP_DB=1` for local-only dev (the bridge will return
plugin output without persisting). Schema lives in src/db/schema/searches.ts.

Idempotency: `search_results` has unique index `results_itin_uniq` on
(itinerary_hash, program_id, depart_date). Segments + cabin prices are
delete-and-reinserted under the result row each call — cabin availability
and segment ordering can change between scrapes.
"""

from __future__ import annotations

import logging
import os
from typing import Iterable

import psycopg

from .hash import itinerary_hash, operating_flight_key
from .types import NormalizedResult, SearchQuery

log = logging.getLogger(__name__)


def _database_url() -> str | None:
    return os.environ.get("DATABASE_URL")


def writeback_skipped() -> bool:
    return os.environ.get("PYTHONWORKERS_SKIP_DB") == "1" or not _database_url()


async def write_results(
    query: SearchQuery,
    results: Iterable[NormalizedResult],
) -> dict:
    """Persist a list of NormalizedResults to Neon.

    Returns a small summary `{written: N, skipped: bool}` for the HTTP bridge
    to surface back to the caller.
    """
    rows = list(results)
    if writeback_skipped():
        log.info("DB writeback skipped (PYTHONWORKERS_SKIP_DB=1 or no DATABASE_URL).")
        return {"written": 0, "skipped": True, "count": len(rows)}

    if not rows:
        return {"written": 0, "skipped": False, "count": 0}

    dsn = _database_url()
    assert dsn is not None  # guarded by writeback_skipped above

    written = 0
    async with await psycopg.AsyncConnection.connect(dsn) as conn:
        async with conn.cursor() as cur:
            for r in rows:
                itin_hash = itinerary_hash(
                    r.program_id, query.pax, r.depart_date, r.segments
                )
                cabins = [cp.cabin for cp in r.cabin_prices]

                await cur.execute(
                    """
                    INSERT INTO search_results (
                        itinerary_hash, program_id, origin_iata, dest_iata,
                        depart_date, arrive_date, pax, total_duration_min,
                        num_segments, cabins_available, confidence_score,
                        observed_at, last_seen_at
                    )
                    VALUES (
                        %s, %s, %s, %s,
                        %s::date, %s::date, %s, %s,
                        %s, %s::cabin[], %s,
                        %s::timestamptz, %s::timestamptz
                    )
                    ON CONFLICT (itinerary_hash, program_id, depart_date)
                    DO UPDATE SET
                        last_seen_at = EXCLUDED.last_seen_at,
                        cabins_available = EXCLUDED.cabins_available,
                        confidence_score = EXCLUDED.confidence_score,
                        num_segments = EXCLUDED.num_segments,
                        total_duration_min = EXCLUDED.total_duration_min
                    RETURNING id
                    """,
                    (
                        itin_hash,
                        r.program_id,
                        r.origin_iata,
                        r.dest_iata,
                        r.depart_date,
                        r.arrive_date,
                        query.pax,
                        r.total_duration_min,
                        r.num_segments,
                        cabins,
                        r.confidence_score,
                        r.observed_at,
                        r.last_seen_at,
                    ),
                )
                row = await cur.fetchone()
                assert row is not None
                search_result_id = row[0]

                # Re-insert segments + cabin prices under this row. Cheaper than
                # diffing and keeps the data exactly mirroring the scraper output.
                await cur.execute(
                    "DELETE FROM result_segments WHERE search_result_id = %s",
                    (search_result_id,),
                )
                await cur.execute(
                    "DELETE FROM result_cabin_prices WHERE search_result_id = %s",
                    (search_result_id,),
                )

                for seg in r.segments:
                    op_key = operating_flight_key(
                        seg.operating_airline_iata, seg.flight_number, seg.depart_at
                    )
                    await cur.execute(
                        """
                        INSERT INTO result_segments (
                            search_result_id, segment_order,
                            operating_airline_iata, marketing_airline_iata,
                            flight_number, origin_iata, dest_iata,
                            depart_at, arrive_at,
                            aircraft_icao, fare_class, segment_cabin,
                            operating_flight_key
                        )
                        VALUES (
                            %s, %s,
                            %s, %s,
                            %s, %s, %s,
                            %s::timestamptz, %s::timestamptz,
                            %s, %s, %s::cabin,
                            %s
                        )
                        """,
                        (
                            search_result_id,
                            seg.segment_order,
                            seg.operating_airline_iata,
                            seg.marketing_airline_iata,
                            seg.flight_number,
                            seg.origin_iata,
                            seg.dest_iata,
                            seg.depart_at,
                            seg.arrive_at,
                            seg.aircraft_icao,
                            seg.fare_class,
                            seg.segment_cabin,
                            op_key,
                        ),
                    )

                for cp in r.cabin_prices:
                    await cur.execute(
                        """
                        INSERT INTO result_cabin_prices (
                            search_result_id, cabin,
                            seats_remaining, miles_per_pax,
                            surcharge_usd_per_pax, taxes_usd_per_pax,
                            cpp_micro_at_obs
                        )
                        VALUES (%s, %s::cabin, %s, %s, %s, %s, %s)
                        """,
                        (
                            search_result_id,
                            cp.cabin,
                            cp.seats_remaining,
                            cp.miles_per_pax,
                            cp.surcharge_usd_per_pax,
                            cp.taxes_usd_per_pax,
                            cp.cpp_micro_at_obs,
                        ),
                    )

                written += 1

        await conn.commit()

    return {"written": written, "skipped": False, "count": len(rows)}
