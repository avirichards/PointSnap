"""Python port of src/lib/itineraryHash.ts.

Must produce byte-identical canonical strings (and therefore byte-identical
SHA256 hashes) as the JS implementation — the cockpit and the worker both
read/write `search_results.itinerary_hash`, so parity is non-negotiable.

If you change the canonical form here, change it there in the same commit.
"""

from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from typing import Iterable

from .types import ResultSegment


def canonical_itinerary(
    program_id: str,
    pax: int,
    depart_date: str,
    segments: Iterable[ResultSegment],
) -> str:
    sorted_segs = sorted(segments, key=lambda s: s.depart_at)
    seg_strs = [
        f"{s.operating_airline_iata}|{s.flight_number}|{s.depart_at}|{s.origin_iata}>{s.dest_iata}"
        for s in sorted_segs
    ]
    return (
        f"program={program_id};"
        f"pax={pax};"
        f"depart={depart_date};"
        f"segs={'~'.join(seg_strs)}"
    )


def itinerary_hash(
    program_id: str,
    pax: int,
    depart_date: str,
    segments: Iterable[ResultSegment],
) -> str:
    return sha256(
        canonical_itinerary(program_id, pax, depart_date, segments).encode("utf-8")
    ).hexdigest()


def operating_flight_key(
    operating_airline_iata: str,
    flight_number: str,
    depart_at: str,
) -> str:
    """`<IATA><flight#>@YYYYMMDDTHHMM` in UTC. Matches JS `operatingFlightKey`."""
    # JS uses new Date(departAt).getUTC*() — for ISO-8601 strings ending in `Z`
    # the datetime here parses identically once we swap `Z` → `+00:00`.
    dt = datetime.fromisoformat(depart_at.replace("Z", "+00:00"))
    return f"{operating_airline_iata}{flight_number}@{dt.strftime('%Y%m%dT%H%M')}"
