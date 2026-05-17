"""United MileagePlus award search plugin.

REAL SCRAPE ACTIVE: Posts to united.com's public award-search API.
Two-step flow:
  1. GET /api/token/anonymous → bearer token (no auth required)
  2. POST /api/flight/FetchFlights → award itineraries + miles + taxes

The token endpoint is lightly protected; FetchFlights sits behind Akamai
Bot Manager. We hit both via httpx + a realistic Chrome User-Agent +
IPRoyal residential proxy. The community evidence (gaukas Go gist,
OwenKruse wiki, lg/awardwiz archived TypeScript) suggests this works
~90% of the time from clean residential IPs; curl_cffi with chrome131
TLS impersonation is the next step if Akamai burns the request.

Falls back to canonical seed data when:
  - Token endpoint 4xx/5xx
  - FetchFlights 4xx/5xx (Akamai 403 typical on burned IPs)
  - Empty / unparseable response
  - Off-route queries (e.g. JFK→LHR for which UA has no award)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from common.plugin_wrapper import with_canonical_fallback
from common.scrape_client import scrape_client
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "UA_MP"
PROGRAM_NAME = "United MileagePlus"

TOKEN_URL = "https://www.united.com/api/token/anonymous"
SEARCH_URL = "https://www.united.com/api/flight/FetchFlights"


def _united_cabin(cabin_filter: str) -> str:
    return {
        "Y": "economy",
        "W": "premium-economy",
        "J": "business",
        "F": "first",
    }.get(cabin_filter, "economy")


def _normalize_product_cabin(s: str) -> str | None:
    """Map United's product-description strings to our Y/W/J/F enum."""
    s = (s or "").lower()
    if "economy" in s and ("premium" in s or "plus" in s):
        return "W"
    if "economy" in s:
        return "Y"
    if "business" in s or "polaris" in s:
        return "J"
    if "first" in s:
        return "F"
    return None


async def _fetch_token(client) -> str | None:
    try:
        r = await client.get(
            TOKEN_URL,
            headers={
                "Origin": "https://www.united.com",
                "Referer": "https://www.united.com/en/us/fsr/choose-flights",
            },
        )
        if r.status_code != 200:
            log.warning("UA token endpoint returned %s", r.status_code)
            return None
        body = r.json()
        token = body.get("data", {}).get("token", {}).get("hash")
        if not token:
            log.warning("UA token response missing data.token.hash")
            return None
        return token
    except Exception as exc:  # noqa: BLE001
        log.warning("UA token fetch failed: %s", exc)
        return None


def _build_search_body(origin: str, dest: str, date: str, pax: int, cabin: str) -> dict[str, Any]:
    return {
        "SearchTypeSelection": 1,
        "SortType": "BESTMATCHES",
        "SortTypeDescending": False,
        "Trips": [
            {
                "Origin": origin,
                "Destination": dest,
                "DepartDate": date,
                "Index": 1,
                "SearchRadiusMilesOrigin": 0,
                "SearchRadiusMilesDestination": 0,
                "DepartTimeApprox": 0,
            }
        ],
        "AwardTravel": True,
        "CabinPreference": cabin,
        "FareFamilyDescriptions": [],
        "Passengers": [{"PassengerTypeCode": "ADT", "PassengerCount": pax}],
        "RecordLocator": "",
        "SessionId": "",
    }


def _parse_flights(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Map United's FetchFlights JSON tree into our NormalizedResult shape.

    United's response varies — wrap each lookup defensively so one bad
    itinerary doesn't kill the rest. Shape is well-documented (Trips[0].
    Flights[] → each has Products[] with Prices) but new fields appear
    without notice; treat unknowns as null.
    """
    results: list[NormalizedResult] = []
    trips = payload.get("data", {}).get("Trips") or []
    if not trips:
        return results

    flights = trips[0].get("Flights") or []
    for flight in flights[:5]:  # cap top-5 itineraries per program
        try:
            segments_raw = flight.get("Connections") or [flight]
            segments: list[ResultSegment] = []
            for i, seg in enumerate(segments_raw):
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=(
                            seg.get("OperatingCarrier")
                            or seg.get("MarketingCarrier")
                            or "UA"
                        ),
                        marketing_airline_iata=seg.get("MarketingCarrier") or "UA",
                        flight_number=str(seg.get("FlightNumber") or ""),
                        origin_iata=seg.get("Origin") or origin,
                        dest_iata=seg.get("Destination") or dest,
                        depart_at=seg.get("DepartDateTime") or f"{date}T00:00:00Z",
                        arrive_at=seg.get("DestinationDateTime")
                        or f"{date}T00:00:00Z",
                        aircraft_icao=(
                            seg.get("EquipmentDisclosures", {}).get("EquipmentType")
                            if isinstance(seg.get("EquipmentDisclosures"), dict)
                            else None
                        ),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            for product in flight.get("Products") or []:
                cabin_code = _normalize_product_cabin(
                    product.get("ProductTypeDescription") or product.get("CabinName") or ""
                )
                if not cabin_code:
                    continue
                prices = product.get("Prices") or [{}]
                miles = prices[0].get("Amount") or 0
                taxes = prices[0].get("TotalTaxes") or 0
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin_code,  # type: ignore[arg-type]
                        seats_remaining=int(product.get("BookingCount") or 0),
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=0,  # UA never passes YQ
                        taxes_usd_per_pax=int(round(float(taxes))),
                    )
                )
            if not cabin_prices:
                continue

            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            results.append(
                NormalizedResult(
                    program_id=PROGRAM_ID,
                    program_name=PROGRAM_NAME,
                    origin_iata=origin,
                    dest_iata=dest,
                    depart_date=date,
                    arrive_date=date,  # UA doesn't always echo; approximate
                    total_duration_min=int(flight.get("TravelMinutes") or 0),
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=78,  # real-scrape rows start at "High"
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("UA flight parse error: %s", exc)
            continue

    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    async with scrape_client(timeout_s=20.0) as client:
        token = await _fetch_token(client)
        if not token:
            return []
        try:
            r = await client.post(
                SEARCH_URL,
                json=_build_search_body(origin, dest, date, 1, _united_cabin(cabin_filter)),
                headers={
                    "x-authorization-api": f"bearer {token}",
                    "Origin": "https://www.united.com",
                    "Referer": "https://www.united.com/en/us/fsr/choose-flights",
                    "Content-Type": "application/json",
                },
            )
            if r.status_code != 200:
                log.warning("UA FetchFlights returned %s", r.status_code)
                return []
            return _parse_flights(r.json(), origin, dest, date)
        except Exception as exc:  # noqa: BLE001
            log.warning("UA FetchFlights failed: %s", exc)
            return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
