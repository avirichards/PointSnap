"""Bridge smoke tests — exercise the JSON contract the Next.js route relies on.

Hermetic: the VS plugin is monkeypatched to return a fixed row, so these test
the serialization/hash/key contract without hitting the network.
"""

from __future__ import annotations

import os

os.environ.setdefault("PYTHONWORKERS_SKIP_DB", "1")

from datetime import datetime, timezone  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import serve  # noqa: E402
from common.types import CabinPrice, NormalizedResult, ResultSegment  # noqa: E402

client = TestClient(serve.app, headers={"Authorization": "Bearer test-worker-token"})

@pytest.fixture(autouse=True)
def worker_key(monkeypatch):
    monkeypatch.setenv("POINTSNAP_WORKER_TOKEN", "test-worker-token")



def _fixed_row() -> NormalizedResult:
    now = datetime(2026, 8, 15, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return NormalizedResult(
        program_id="VS_FLYING_CLUB",
        program_name="Virgin Atlantic",
        origin_iata="JFK",
        dest_iata="LHR",
        depart_date="2026-08-15",
        arrive_date="2026-08-16",
        total_duration_min=405,
        num_segments=1,
        segments=[
            ResultSegment(
                segment_order=0,
                operating_airline_iata="VS",
                marketing_airline_iata="VS",
                flight_number="3",
                origin_iata="JFK",
                dest_iata="LHR",
                depart_at="2026-08-15T22:30:00Z",
                arrive_at="2026-08-16T10:15:00Z",
                aircraft_icao="B789",
                segment_cabin=None,
                fare_class=None,
            )
        ],
        cabin_prices=[
            CabinPrice("Y", seats_remaining=9, miles_per_pax=10_000,
                       surcharge_usd_per_pax=420, taxes_usd_per_pax=0),
            CabinPrice("J", seats_remaining=4, miles_per_pax=47_500,
                       surcharge_usd_per_pax=720, taxes_usd_per_pax=0),
        ],
        confidence_score=78,
        observed_at=now,
        last_seen_at=now,
    )


@pytest.fixture()
def stub_vs(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake(origin: str, dest: str, date: str, cabin_filter: str = "Y"):
        if (origin, dest) == ("JFK", "LHR"):
            return [_fixed_row()]
        return []

    monkeypatch.setitem(serve.PLUGINS, "VS_FLYING_CLUB", _fake)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_search_vs_jfk_lhr_returns_camelcase_rows(stub_vs: None) -> None:
    r = client.get(
        "/search",
        params={"program": "VS_FLYING_CLUB", "origin": "JFK",
                "dest": "LHR", "date": "2026-08-15"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["program"] == "VS_FLYING_CLUB"
    assert body["db"]["skipped"] is True  # PYTHONWORKERS_SKIP_DB
    assert len(body["rows"]) == 1

    row = body["rows"][0]
    # camelCase shape so the Next.js route can pass it straight into SSE.
    assert row["programId"] == "VS_FLYING_CLUB"
    assert row["programName"] == "Virgin Atlantic"
    assert row["originIata"] == "JFK"
    assert row["destIata"] == "LHR"
    assert row["departDate"] == "2026-08-15"
    assert row["numSegments"] == 1
    assert row["totalDurationMin"] == 405

    seg = row["segments"][0]
    assert seg["operatingAirlineIata"] == "VS"
    assert seg["flightNumber"] == "3"
    assert seg["departAt"].endswith("Z")

    cabins = row["cabinPrices"]
    assert set(cabins.keys()) == {"Y", "J"}
    assert cabins["J"]["milesPerPax"] == 47_500
    assert cabins["Y"]["milesPerPax"] == 10_000

    assert row["id"].startswith("VS_FLYING_CLUB_")
    assert len(row["itineraryHash"]) == 64
    assert row["operatingFlightKey"] == "VS3@20260815T2230"


def test_unknown_program_404s() -> None:
    r = client.get(
        "/search",
        params={"program": "MARS_AIRLINES", "origin": "JFK",
                "dest": "LHR", "date": "2026-08-15"},
    )
    assert r.status_code == 404


def test_unsupported_route_returns_empty_rows(stub_vs: None) -> None:
    r = client.get(
        "/search",
        params={"program": "VS_FLYING_CLUB", "origin": "JFK",
                "dest": "NRT", "date": "2026-08-15"},
    )
    assert r.status_code == 200
    assert r.json()["rows"] == []
