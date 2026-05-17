"""Factory that turns a ProgramSeed (canonical hardcoded data) into a
plugin-compatible search() coroutine.

Used by serve.py to register all 12 non-VS launch programs without 12
near-identical plugin files. The data lives in seed_data.py; this is just
the time-of-call wrapping into NormalizedResult shape.

When a program graduates from hardcoded → real scraper (Sessions 5-10),
its registration in serve.py swaps from `make_mock_plugin("X")` to the
program's own module.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from common.seed_data import ProgramSeed, SEEDS_JFK_NRT
from common.types import CabinPrice, NormalizedResult, ResultSegment

PluginCallable = "Callable[..., Coroutine[None, None, list[NormalizedResult]]]"


def _iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _build_result(seed: ProgramSeed, depart_date: str) -> NormalizedResult:
    base = datetime.fromisoformat(f"{depart_date}T11:10:00+00:00")
    segments: list[ResultSegment] = []
    total_duration = 0
    for i, seg in enumerate(seed.segments):
        seg_depart = base + timedelta(minutes=seg.depart_offset_min)
        seg_arrive = seg_depart + timedelta(minutes=seg.duration_min)
        segments.append(
            ResultSegment(
                segment_order=i,
                operating_airline_iata=seg.operating_airline_iata,
                marketing_airline_iata=seg.marketing_airline_iata,
                flight_number=seg.flight_number,
                origin_iata=seg.origin_iata,
                dest_iata=seg.dest_iata,
                depart_at=_iso_utc(seg_depart),
                arrive_at=_iso_utc(seg_arrive),
                aircraft_icao=seg.aircraft_icao,
                segment_cabin=seg.segment_cabin,  # type: ignore[arg-type]
                fare_class=seg.fare_class,
            )
        )
        # Last segment's arrival - first segment's departure (covers connections)
        total_duration = int(
            (seg_arrive - base).total_seconds() // 60
        )

    cabin_prices = [
        CabinPrice(
            cabin=c.cabin,  # type: ignore[arg-type]
            seats_remaining=c.seats_remaining,
            miles_per_pax=c.miles_per_pax,
            surcharge_usd_per_pax=c.surcharge_usd_per_pax,
            taxes_usd_per_pax=c.taxes_usd_per_pax,
            cpp_micro_at_obs=c.cpp_micro_at_obs,
        )
        for c in seed.cabins
    ]

    now = datetime.now(timezone.utc)
    last_seen = now - timedelta(minutes=seed.last_seen_minutes_ago)

    last_seg = seed.segments[-1]
    arrive_date = (
        base + timedelta(minutes=last_seg.depart_offset_min + last_seg.duration_min)
    ).strftime("%Y-%m-%d")

    return NormalizedResult(
        program_id=seed.program_id,
        program_name=seed.program_name,
        origin_iata=seed.segments[0].origin_iata,
        dest_iata=last_seg.dest_iata,
        depart_date=depart_date,
        arrive_date=arrive_date,
        total_duration_min=total_duration,
        num_segments=len(seed.segments),
        segments=segments,
        cabin_prices=cabin_prices,
        confidence_score=seed.confidence_score,
        observed_at=_iso_utc(now),
        last_seen_at=_iso_utc(last_seen),
    )


def make_mock_plugin(program_id: str):
    """Return an async `search()` coroutine for the given program.

    Matches the plugin protocol consumed by serve.py PLUGINS dict.
    Returns rows only when origin/dest matches the seed's first/last
    segment (JFK→NRT for all current entries); otherwise returns [] so the
    cockpit's chart-fallback path takes over.
    """

    seed = SEEDS_JFK_NRT.get(program_id)
    if seed is None:
        raise KeyError(f"No mock seed for program {program_id}")

    expected_origin = seed.segments[0].origin_iata
    expected_dest = seed.segments[-1].dest_iata

    async def search(
        origin: str,
        dest: str,
        date: str,
        cabin_filter: str = "Y",
    ) -> list[NormalizedResult]:
        del cabin_filter  # mock returns all cabins; route filters later
        if (origin, dest) != (expected_origin, expected_dest):
            return []
        return [_build_result(seed, date)]

    return search
