"""Virgin Atlantic Flying Club plugin — day-1 stub.

Real Patchright scraping arrives in session 5. For now this returns a
hard-coded JFK→LHR response so the rest of the pipeline (worker → DB →
SSE → cockpit) can be exercised end-to-end on a forgiving target.

VS Flying Club JFK→LHR award structure (approx., chart-based one-way):
    Y (Economy)     10,000 miles + ~$420 YQ
    W (Premium)     20,000 miles + ~$520 YQ          (not exposed day-1)
    J (Upper Class) 47,500 miles + ~$720 YQ

VS3 (B789, JFK 18:30 EDT → LHR 06:15 BST next day, ~6h45m) is the
canonical evening departure; real VS-operated route. Day-1 ships this as
the single segment so the cockpit has something realistic to render
before session 5 swaps in live scrape output.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from common.types import CabinPrice, NormalizedResult, ResultSegment

PROGRAM_ID = "VS_FLYING_CLUB"
PROGRAM_NAME = "Virgin Atlantic"


def _iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def search(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """Return a hard-coded JFK→LHR result for any day-1 query.

    Args:
        origin / dest: 3-letter IATA, upper-cased by the bridge.
        date: YYYY-MM-DD departure date.
        cabin_filter: minimum cabin ('Y'|'W'|'J'|'F'). Ignored for day-1.

    Real scrape lives behind a TODO in session 5 — Patchright + IPRoyal +
    CapSolver are wired in there. Any unsupported O&D currently returns [].
    """
    if (origin, dest) != ("JFK", "LHR"):
        return []  # session 5 widens coverage to the rest of VS's network

    depart_date = datetime.strptime(date, "%Y-%m-%d").date()
    # VS3 schedule: JFK 18:30 EDT → LHR 06:15 BST next day. In UTC that's
    # 22:30Z → 05:15Z+1 (assuming EDT=UTC-4, BST=UTC+1). Real scrape will
    # honor actual time zones; day-1 uses summer offsets.
    depart_at = datetime.combine(
        depart_date,
        datetime.min.time().replace(hour=22, minute=30),
        tzinfo=timezone.utc,
    )
    arrive_at = depart_at + timedelta(hours=6, minutes=45)
    now = datetime.now(timezone.utc)
    observed = _iso_utc(now)

    segment = ResultSegment(
        segment_order=0,
        operating_airline_iata="VS",
        marketing_airline_iata="VS",
        flight_number="3",
        origin_iata="JFK",
        dest_iata="LHR",
        depart_at=_iso_utc(depart_at),
        arrive_at=_iso_utc(arrive_at),
        aircraft_icao="B789",
        segment_cabin="J",
        fare_class="I",
    )

    cabin_prices = [
        CabinPrice(
            cabin="Y",
            seats_remaining=9,
            miles_per_pax=10_000,
            surcharge_usd_per_pax=420,
            taxes_usd_per_pax=51,
        ),
        CabinPrice(
            cabin="J",
            seats_remaining=4,
            miles_per_pax=47_500,
            surcharge_usd_per_pax=720,
            taxes_usd_per_pax=51,
        ),
    ]

    return [
        NormalizedResult(
            program_id=PROGRAM_ID,
            program_name=PROGRAM_NAME,
            origin_iata="JFK",
            dest_iata="LHR",
            depart_date=date,
            arrive_date=(depart_date + timedelta(days=1)).isoformat(),
            total_duration_min=405,
            num_segments=1,
            segments=[segment],
            cabin_prices=cabin_prices,
            confidence_score=72,
            observed_at=observed,
            last_seen_at=observed,
        )
    ]
