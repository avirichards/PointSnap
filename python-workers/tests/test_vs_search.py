"""VS_FLYING_CLUB parser tests.

Hermetic: these feed a synthetic Virgin Atlantic calendar payload through the
parser (`_extract_for_date`) — no network. The end-to-end live scrape is
covered by `test_jfk_lhr_live` below, which is marked `live` and excluded from
the default suite (it hits virginatlantic.com and depends on real availability).
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from common.types import NormalizedResult
from vs.search import _extract_for_date, search

# One month entry with a per-day breakdown, matching the shape documented in
# vs/search.py (_extract_for_date docstring).
SAMPLE_PAYLOAD = [
    {
        "date": "2026-08-01",
        "month": "AUGUST",
        "pointsDays": [
            {
                "date": "2026-08-15",
                "minPrice": 200,  # GBP → *1.25 ≈ 250 USD
                "seats": {
                    "awardEconomy": {
                        "cabinPointsValue": 10_000,
                        "cabinClassSeatCount": 9,
                    },
                    "awardComfortPlusPremiumEconomy": {
                        "cabinPointsValue": 22_500,
                        "cabinClassSeatCount": 4,
                    },
                    "awardBusiness": {
                        "cabinPointsValue": 47_500,
                        "cabinClassSeatCount": 2,
                    },
                },
            },
            {
                "date": "2026-08-16",
                "minPrice": 0,
                "seats": {},  # no availability
            },
        ],
    }
]


def test_parses_available_day() -> None:
    r = _extract_for_date(SAMPLE_PAYLOAD, "2026-08-15", "JFK", "LHR")
    assert isinstance(r, NormalizedResult)
    assert r.program_id == "VS_FLYING_CLUB"
    assert r.origin_iata == "JFK"
    assert r.dest_iata == "LHR"
    assert r.depart_date == "2026-08-15"
    assert r.num_segments == 1 == len(r.segments)

    seg = r.segments[0]
    assert seg.operating_airline_iata == "VS"
    # Calendar rollup carries no specific flight number (was the misleading
    # "CAL" sentinel — now honestly empty).
    assert seg.flight_number == ""
    assert seg.depart_at.endswith("Z")

    cabins = {cp.cabin: cp for cp in r.cabin_prices}
    assert set(cabins) == {"Y", "W", "J"}
    assert cabins["Y"].miles_per_pax == 10_000
    assert cabins["J"].miles_per_pax == 47_500
    assert cabins["J"].surcharge_usd_per_pax == 250  # round(200 * 1.25)
    assert cabins["J"].seats_remaining == 2


def test_day_with_no_seats_is_skipped() -> None:
    assert _extract_for_date(SAMPLE_PAYLOAD, "2026-08-16", "JFK", "LHR") is None


def test_date_not_in_calendar_returns_none() -> None:
    assert _extract_for_date(SAMPLE_PAYLOAD, "2026-08-20", "JFK", "LHR") is None


def test_empty_payload_returns_none() -> None:
    assert _extract_for_date([], "2026-08-15", "JFK", "LHR") is None


def test_serializes_to_dict() -> None:
    r = _extract_for_date(SAMPLE_PAYLOAD, "2026-08-15", "JFK", "LHR")
    assert r is not None
    d = r.to_dict()
    assert d["program_id"] == "VS_FLYING_CLUB"
    assert isinstance(d["segments"], list)
    assert isinstance(d["cabin_prices"], list)
    assert d["segments"][0]["flight_number"] == ""


@pytest.mark.live
@pytest.mark.asyncio
async def test_jfk_lhr_live() -> None:
    """Real scrape against virginatlantic.com. Excluded by default (`-m live`).

    Uses a relative future date so it never rots, and only asserts structural
    invariants — availability varies, so we don't assert specific prices/seats.
    """
    future = (date.today() + timedelta(days=45)).isoformat()
    results = await search("JFK", "LHR", future)
    assert isinstance(results, list)
    for r in results:
        assert isinstance(r, NormalizedResult)
        assert r.program_id == "VS_FLYING_CLUB"
        assert r.depart_date == future
