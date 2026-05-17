"""Parity test for the Python port of `src/lib/itineraryHash.ts`.

The expected SHA256 below is generated from the JS implementation against
an identical fixture; if the canonical form drifts between languages the
DB upsert key drifts, and re-scrapes start creating duplicate rows
instead of updating in place. Catch the drift here, not in production.

Regenerate with:
    cd /home/user/PointSnap
    node --experimental-vm-modules -e '\
        import("./src/lib/itineraryHash.ts").then(m => {\
            console.log(m.itineraryHash({\
                programId: "VS_FLYING_CLUB", pax: 1, departDate: "2026-06-15",\
                segments: [{operatingAirlineIata: "VS", flightNumber: "3",\
                    departAt: "2026-06-15T22:30:00Z", originIata: "JFK", destIata: "LHR"}]}));\
        });'
"""

from __future__ import annotations

from common.hash import canonical_itinerary, itinerary_hash, operating_flight_key
from common.types import ResultSegment


def _vs3_segment() -> ResultSegment:
    return ResultSegment(
        segment_order=0,
        operating_airline_iata="VS",
        marketing_airline_iata="VS",
        flight_number="3",
        origin_iata="JFK",
        dest_iata="LHR",
        depart_at="2026-06-15T22:30:00Z",
        arrive_at="2026-06-16T05:15:00Z",
        aircraft_icao="B789",
        segment_cabin="J",
        fare_class="I",
    )


def test_canonical_form_matches_js_serializer() -> None:
    canon = canonical_itinerary("VS_FLYING_CLUB", 1, "2026-06-15", [_vs3_segment()])
    expected = (
        "program=VS_FLYING_CLUB;"
        "pax=1;"
        "depart=2026-06-15;"
        "segs=VS|3|2026-06-15T22:30:00Z|JFK>LHR"
    )
    assert canon == expected


def test_sha256_pinned_for_known_fixture() -> None:
    h = itinerary_hash("VS_FLYING_CLUB", 1, "2026-06-15", [_vs3_segment()])
    # Hash of the exact `expected` string above. If this test fails after a
    # canonical-form change, regenerate via the docstring at the top of the file.
    assert h == "fbbf71a8418ae6a150c652fb2710562e3da1b98adb36d969d011f33a778a09f4"


def test_operating_flight_key_matches_js_format() -> None:
    assert (
        operating_flight_key("VS", "3", "2026-06-15T22:30:00Z")
        == "VS3@20260615T2230"
    )


def test_segments_sorted_by_depart_at() -> None:
    early = _vs3_segment()
    late = ResultSegment(
        segment_order=1,
        operating_airline_iata="VS",
        marketing_airline_iata="VS",
        flight_number="138",
        origin_iata="LHR",
        dest_iata="JFK",
        depart_at="2026-06-17T11:00:00Z",
        arrive_at="2026-06-17T14:00:00Z",
        aircraft_icao="B789",
        segment_cabin="J",
        fare_class="I",
    )
    # Pass segments in reverse-chronological order; canonical form must
    # still serialize them chronologically.
    canon = canonical_itinerary("VS_FLYING_CLUB", 1, "2026-06-15", [late, early])
    assert canon.index("VS|3|") < canon.index("VS|138|")
