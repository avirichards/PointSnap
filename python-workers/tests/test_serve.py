"""Bridge smoke tests — exercise the JSON contract the Next.js route relies on."""

from __future__ import annotations

import os

os.environ.setdefault("PYTHONWORKERS_SKIP_DB", "1")

from fastapi.testclient import TestClient  # noqa: E402

from serve import app  # noqa: E402

client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_search_vs_jfk_lhr_returns_camelcase_rows() -> None:
    r = client.get(
        "/search",
        params={
            "program": "VS_FLYING_CLUB",
            "origin": "JFK",
            "dest": "LHR",
            "date": "2026-06-15",
        },
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
    assert row["departDate"] == "2026-06-15"
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
    assert row["operatingFlightKey"] == "VS3@20260615T2230"


def test_unknown_program_404s() -> None:
    r = client.get(
        "/search",
        params={
            "program": "MARS_AIRLINES",
            "origin": "JFK",
            "dest": "LHR",
            "date": "2026-06-15",
        },
    )
    assert r.status_code == 404


def test_unsupported_route_returns_empty_rows() -> None:
    r = client.get(
        "/search",
        params={
            "program": "VS_FLYING_CLUB",
            "origin": "JFK",
            "dest": "NRT",
            "date": "2026-06-15",
        },
    )
    assert r.status_code == 200
    assert r.json()["rows"] == []
