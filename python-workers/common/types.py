"""Normalized shapes the Python plugins emit.

These mirror the TypeScript `SearchResultRow` / `ResultSegment` / `CabinPrice`
in `src/lib/types.ts`. JSON round-trips through the FastAPI bridge into the
Next.js `/api/search` route, which passes them straight into the SSE
`partial` event without translation.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

Cabin = Literal["Y", "W", "J", "F"]


@dataclass(slots=True)
class ResultSegment:
    segment_order: int
    operating_airline_iata: str
    marketing_airline_iata: str
    flight_number: str
    origin_iata: str
    dest_iata: str
    depart_at: str   # ISO 8601 UTC, e.g. "2026-06-15T23:30:00Z"
    arrive_at: str
    aircraft_icao: str | None
    segment_cabin: Cabin | None
    fare_class: str | None


@dataclass(slots=True)
class CabinPrice:
    cabin: Cabin
    seats_remaining: int
    miles_per_pax: int
    surcharge_usd_per_pax: int
    taxes_usd_per_pax: int
    cpp_micro_at_obs: int | None = None


@dataclass(slots=True)
class NormalizedResult:
    """One scraped itinerary, ready for SSE emission + DB writeback."""

    program_id: str
    program_name: str
    origin_iata: str
    dest_iata: str
    depart_date: str            # YYYY-MM-DD
    arrive_date: str            # YYYY-MM-DD
    total_duration_min: int
    num_segments: int
    segments: list[ResultSegment]
    cabin_prices: list[CabinPrice]
    confidence_score: int
    observed_at: str            # ISO 8601 UTC
    last_seen_at: str           # ISO 8601 UTC

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(slots=True)
class SearchQuery:
    origin: str
    dest: str
    depart_date: str            # YYYY-MM-DD
    pax: int = 1
    min_cabin: Cabin = "Y"
