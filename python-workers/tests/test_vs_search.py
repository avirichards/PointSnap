"""Shape test for the VS_FLYING_CLUB plugin stub.

Catches regressions in the field set the Next.js cockpit relies on.
Real-scrape correctness arrives in session 5.
"""

from __future__ import annotations

import pytest

from common.types import NormalizedResult
from vs.search import search


@pytest.mark.asyncio
async def test_jfk_lhr_returns_one_result() -> None:
    results = await search("JFK", "LHR", "2026-06-15")
    assert len(results) == 1
    r = results[0]
    assert isinstance(r, NormalizedResult)
    assert r.program_id == "VS_FLYING_CLUB"
    assert r.origin_iata == "JFK"
    assert r.dest_iata == "LHR"
    assert r.depart_date == "2026-06-15"
    assert r.arrive_date == "2026-06-16"
    assert r.num_segments == 1 == len(r.segments)

    seg = r.segments[0]
    assert seg.operating_airline_iata == "VS"
    assert seg.flight_number == "3"
    assert seg.depart_at.endswith("Z")
    assert seg.arrive_at.endswith("Z")
    assert seg.aircraft_icao == "B789"

    cabins = {cp.cabin for cp in r.cabin_prices}
    assert cabins == {"Y", "J"}
    j = next(cp for cp in r.cabin_prices if cp.cabin == "J")
    assert j.miles_per_pax == 47_500
    assert j.surcharge_usd_per_pax == 720
    assert j.seats_remaining > 0


@pytest.mark.asyncio
async def test_unsupported_route_returns_empty() -> None:
    results = await search("JFK", "NRT", "2026-06-15")
    assert results == []


@pytest.mark.asyncio
async def test_serializes_to_dict() -> None:
    [r] = await search("JFK", "LHR", "2026-06-15")
    d = r.to_dict()
    assert d["program_id"] == "VS_FLYING_CLUB"
    assert isinstance(d["segments"], list)
    assert isinstance(d["cabin_prices"], list)
    assert d["segments"][0]["flight_number"] == "3"
