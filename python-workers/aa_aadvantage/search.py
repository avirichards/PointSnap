"""American AAdvantage award search plugin — REAL SCRAPE ACTIVE.

Strategy: Bright Data Web Unlocker. AA's Akamai has two layers — a page-load
block AND a separate API-endpoint block — and the BD Browser API (CDP) can
intermittently defeat the first but never the second. Web Unlocker is BD's
purpose-built product for sites with this kind of layered protection: it
renders the page, runs sensor.js, handles cookies, and forwards our POST
to /booking/api/search/itinerary from a clean residential IP, then returns
the JSON response body to us.

Flow:
  1. POST our search body to https://api.brightdata.com/request with the
     AA itinerary URL + method=POST + data=our-body. BD handles Akamai.
  2. WU returns AA's JSON response body verbatim (format=raw).
  3. Parse slices[].segments[].flight + pricingDetail[] same as before.

Falls back to [] on any failure (auth, WU error, Akamai still blocks,
unparseable response). The cockpit falls back to chart-only inventory.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AA_AADVANTAGE"
PROGRAM_NAME = "AAdvantage"

SEARCH_URL = "https://www.aa.com/booking/api/search/itinerary"
SEARCH_PAGE = "https://www.aa.com/booking/find-flights"
LOGIN_URL = "https://www.aa.com/loyalty/login"


def _build_search_body(origin: str, dest: str, date: str, pax: int) -> dict[str, Any]:
    return {
        "metadata": {"selectedProducts": [], "tripType": "OneWay", "udo": {}},
        "passengers": [{"type": "adult", "count": pax}],
        "queryParams": {"sliceIndex": 0, "sessionId": "", "solutionId": "", "solutionSet": ""},
        "requestHeader": {"clientId": "AAcom"},
        "slices": [
            {
                "allCarriers": True,
                "cabin": "",
                "departureDate": date,
                "destination": dest,
                "origin": origin,
                "departureTime": "040001",
                "includeNearbyAirports": False,
            }
        ],
        "tripOptions": {"locale": "en_US", "searchType": "Award"},
        "loyaltyInfo": None,
    }


def _cabin_from_aa(product_type: str) -> str | None:
    s = (product_type or "").upper()
    if "FIRST" in s:
        return "F"
    if "BUSINESS" in s or "FLAGSHIP" in s:
        return "J"
    if "PREMIUM" in s and "ECONOMY" in s:
        return "W"
    if "COACH" in s or "ECONOMY" in s or "MAIN" in s:
        return "Y"
    return None


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    results: list[NormalizedResult] = []
    slices = payload.get("slices") or []
    if not slices:
        return results

    for sl in slices[:6]:
        try:
            segments: list[ResultSegment] = []
            for i, seg in enumerate(sl.get("segments") or []):
                flight = seg.get("flight") or {}
                first_leg = (seg.get("legs") or [{}])[0]
                last_leg = (seg.get("legs") or [{}])[-1]
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=flight.get("carrierCode") or "AA",
                        marketing_airline_iata=flight.get("carrierCode") or "AA",
                        flight_number=str(flight.get("flightNumber") or ""),
                        origin_iata=first_leg.get("origin") or origin,
                        dest_iata=last_leg.get("destination") or dest,
                        depart_at=first_leg.get("departureDateTime") or f"{date}T00:00:00Z",
                        arrive_at=last_leg.get("arrivalDateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=first_leg.get("aircraft"),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            pricing = (sl.get("segments") or [{}])[0].get("pricingDetail") or []
            for pd in pricing:
                if not pd.get("productAvailable"):
                    continue
                cabin = _cabin_from_aa(pd.get("productType") or "")
                if not cabin:
                    continue
                miles = int(pd.get("perPassengerAwardPoints") or 0)
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin,  # type: ignore[arg-type]
                        seats_remaining=0,
                        miles_per_pax=miles,
                        surcharge_usd_per_pax=0,  # AA doesn't pass YQ on own metal
                        taxes_usd_per_pax=int(round(float(pd.get("perPassengerTaxesAndFees") or 0))),
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
                    arrive_date=date,
                    total_duration_min=int(sl.get("durationInMinutes") or 0),
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=86,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("AA slice parse error: %s", exc)
            continue
    return results


WEBUNLOCKER_URL = "https://api.brightdata.com/request"
WEBUNLOCKER_ZONE = "pointsnap_webunlock"


async def _scrape_via_webunlocker(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    api_key = os.environ.get("BRIGHTDATA_API_KEY")
    if not api_key:
        log.error("AA: BRIGHTDATA_API_KEY env var not set; cannot use Web Unlocker")
        return []

    body = _build_search_body(origin, dest, date, 1)
    wu_request = {
        "zone": WEBUNLOCKER_ZONE,
        "url": SEARCH_URL,
        "format": "raw",
        "method": "POST",
        "data": json.dumps(body),
        "headers": {
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
            resp = await client.post(WEBUNLOCKER_URL, json=wu_request, headers=headers)
    except Exception as exc:  # noqa: BLE001
        log.warning("AA: Web Unlocker request error: %s", exc)
        return []

    if resp.status_code != 200:
        log.warning("AA: Web Unlocker returned HTTP %d: %s", resp.status_code, resp.text[:300])
        return []

    # WU returns AA's response body verbatim when format=raw. If Akamai
    # blocked AA's API endpoint despite WU's bypass attempts, we'll see
    # HTML "Access Denied" instead of JSON.
    text = resp.text
    if "Access Denied" in text[:1000] or "errors.edgesuite" in text[:1000]:
        log.warning("AA: Akamai still blocking through Web Unlocker (body[:200]=%r)", text[:200])
        return []

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        log.warning("AA: Web Unlocker response not JSON: %s", text[:300])
        return []

    parsed = _parse(payload, origin, dest, date)
    log.info("AA: Web Unlocker succeeded (%d results)", len(parsed))
    return parsed


search = _scrape_via_webunlocker
