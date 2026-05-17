"""FastAPI bridge — Next.js cockpit calls this to run a plugin.

The Next.js `/api/search` route fans out per-program; for `VS_FLYING_CLUB`
it hits this app at `${PYTHON_WORKER_URL}/search?…` instead of the mock
generator. Plugin selection is keyed by the `program` query param.

The bridge's JSON output is intentionally shaped to match the TypeScript
`SearchResultRow` in `src/lib/types.ts`, so the route can forward the
results into the SSE `partial` event without translation.
"""

from __future__ import annotations

import logging
from typing import Callable, Coroutine

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from common.db import write_results, writeback_skipped
from common.hash import itinerary_hash, operating_flight_key
from common.types import NormalizedResult, SearchQuery
from vs import search as vs_search

load_dotenv()
log = logging.getLogger(__name__)

app = FastAPI(title="pointsnap-workers", version="0.1.0")


# Plugin registry. Session 5 adds more entries.
PluginCallable = Callable[..., Coroutine[None, None, list[NormalizedResult]]]
PLUGINS: dict[str, PluginCallable] = {
    "VS_FLYING_CLUB": vs_search.search,
}


def _serialize(query: SearchQuery, r: NormalizedResult) -> dict:
    """Convert NormalizedResult (snake_case) → SearchResultRow (camelCase).

    The route emits this verbatim into the SSE `partial` event, so any
    drift here breaks the cockpit rendering.
    """
    h = itinerary_hash(r.program_id, query.pax, r.depart_date, r.segments)
    first = r.segments[0]
    op_key = operating_flight_key(
        first.operating_airline_iata, first.flight_number, first.depart_at
    )
    return {
        "id": f"{r.program_id}_{h[:12]}",
        "itineraryHash": h,
        "programId": r.program_id,
        "programName": r.program_name,
        "originIata": r.origin_iata,
        "destIata": r.dest_iata,
        "departDate": r.depart_date,
        "arriveDate": r.arrive_date,
        "totalDurationMin": r.total_duration_min,
        "numSegments": r.num_segments,
        "segments": [
            {
                "segmentOrder": s.segment_order,
                "operatingAirlineIata": s.operating_airline_iata,
                "marketingAirlineIata": s.marketing_airline_iata,
                "flightNumber": s.flight_number,
                "originIata": s.origin_iata,
                "destIata": s.dest_iata,
                "departAt": s.depart_at,
                "arriveAt": s.arrive_at,
                "aircraftIcao": s.aircraft_icao,
                "segmentCabin": s.segment_cabin,
                "fareClass": s.fare_class,
            }
            for s in r.segments
        ],
        "cabinPrices": {
            cp.cabin: {
                "cabin": cp.cabin,
                "seatsRemaining": cp.seats_remaining,
                "milesPerPax": cp.miles_per_pax,
                "surchargeUsdPerPax": cp.surcharge_usd_per_pax,
                "taxesUsdPerPax": cp.taxes_usd_per_pax,
                "cppMicroAtObs": cp.cpp_micro_at_obs,
            }
            for cp in r.cabin_prices
        },
        "confidenceScore": r.confidence_score,
        "observedAt": r.observed_at,
        "lastSeenAt": r.last_seen_at,
        "operatingFlightKey": op_key,
    }


@app.get("/health")
async def health() -> dict[str, str | bool]:
    return {"status": "ok", "dbSkipped": writeback_skipped()}


@app.get("/search")
async def search(
    program: str = Query(..., description="Program ID, e.g. VS_FLYING_CLUB"),
    origin: str = Query(..., min_length=3, max_length=3),
    dest: str = Query(..., min_length=3, max_length=3),
    date: str = Query(..., description="Depart date YYYY-MM-DD"),
    pax: int = Query(1, ge=1, le=9),
    minCabin: str = Query("Y", pattern="^[YWJF]$"),
) -> JSONResponse:
    plugin = PLUGINS.get(program)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"Unknown program: {program}")

    origin_u = origin.upper()
    dest_u = dest.upper()
    query = SearchQuery(
        origin=origin_u, dest=dest_u, depart_date=date, pax=pax, min_cabin=minCabin  # type: ignore[arg-type]
    )

    try:
        results = await plugin(origin_u, dest_u, date, minCabin)
    except Exception as exc:  # noqa: BLE001 — surface scraper errors to caller
        log.exception("Plugin %s raised", program)
        raise HTTPException(status_code=502, detail=f"Plugin error: {exc}") from exc

    db_summary = await write_results(query, results)
    rows = [_serialize(query, r) for r in results]
    return JSONResponse(
        {
            "program": program,
            "origin": origin_u,
            "dest": dest_u,
            "date": date,
            "rows": rows,
            "db": db_summary,
        }
    )
