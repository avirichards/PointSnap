"""United MileagePlus award search plugin — REAL SCRAPE ACTIVE.

Root cause of the prior HTTP 428: Akamai Bot Manager's sec-cpt challenge.
United's /api/flight/FetchFlights is behind Akamai BMP — a bare bearer
token isn't enough; the request needs Akamai cookies (_abck with ~0~
solved-state, bm_sz, ak_bmsc, sec_cpt with ~3~) which only get minted
when sensor.js runs in a real browser.

Fix: Patchright navigates united.com first to let sensor.js mint the
cookies, then fires the FetchFlights POST from inside the page via
page.evaluate fetch — so all the Akamai per-request headers + cookies
come along automatically.

Body shape per gaukas Go gist (verified 2024) + awardwiz scrapers:
  - PaxInfoList (not Passengers)
  - CabinPreferenceMain (not CabinPreference)
  - SortType lowercase "bestmatches"
  - SearchRadius* are string "-1"
  - Requires TripIndex, Characteristics, CalendarFilters, NGRP, FareType
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "UA_MP"
PROGRAM_NAME = "United MileagePlus"

SEARCH_PAGE = "https://www.united.com/en/us/fsr/choose-flights"


def _united_cabin(cabin_filter: str) -> str:
    return {
        "Y": "economy",
        "W": "premiumeconomy",
        "J": "business",
        "F": "first",
    }.get(cabin_filter, "economy")


def _build_body(origin: str, dest: str, date: str, pax: int, cabin: str) -> dict[str, Any]:
    return {
        "SearchTypeSelection": 1,
        "SortType": "bestmatches",
        "SortTypeDescending": False,
        "Trips": [
            {
                "Origin": origin,
                "Destination": dest,
                "DepartDate": date,
                "Index": 1,
                "TripIndex": 1,
                "SearchRadiusMilesOrigin": "-1",
                "SearchRadiusMilesDestination": "-1",
                "DepartTimeApprox": 0,
                "SearchFiltersIn": {
                    "FareFamily": "ECONOMY",
                    "AirportsStop": None,
                    "AirportsStopToAvoid": None,
                    "StopCountMax": 0,
                    "StopCountMin": -1,
                },
                "UseFilters": True,
                "NonStopMarket": False,
            }
        ],
        "CabinPreferenceMain": cabin,
        "PaxInfoList": [{"PaxType": 1} for _ in range(pax)],
        "AwardTravel": True,
        "NGRP": False,
        "CalendarLengthOfStay": 0,
        "PetCount": 0,
        "CalendarFilters": {"Filters": {"PriceScheduleOptions": {"Stops": 1}}},
        "Characteristics": [
            {"Code": "SOFT_LOGGED_IN", "Value": False},
            {"Code": "UsePassedCartId", "Value": False},
        ],
        "FareType": "Award",
    }


def _normalize_product_cabin(s: str) -> str | None:
    s = (s or "").lower()
    if "polaris" in s or "business" in s:
        return "J"
    if "first" in s:
        return "F"
    if "premium" in s and ("plus" in s or "economy" in s):
        return "W"
    if "economy" in s:
        return "Y"
    return None


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    results: list[NormalizedResult] = []
    trips = (payload.get("data") or {}).get("Trips") or []
    if not trips:
        return results

    flights = trips[0].get("Flights") or []
    for flight in flights[:6]:
        try:
            segments_raw = flight.get("Connections") or [flight]
            segments: list[ResultSegment] = []
            for i, seg in enumerate(segments_raw):
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=(
                            seg.get("OperatingCarrier") or seg.get("MarketingCarrier") or "UA"
                        ),
                        marketing_airline_iata=seg.get("MarketingCarrier") or "UA",
                        flight_number=str(seg.get("FlightNumber") or ""),
                        origin_iata=seg.get("Origin") or origin,
                        dest_iata=seg.get("Destination") or dest,
                        depart_at=seg.get("DepartDateTime") or f"{date}T00:00:00Z",
                        arrive_at=seg.get("DestinationDateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=(
                            seg.get("EquipmentDisclosures", {}).get("EquipmentType")
                            if isinstance(seg.get("EquipmentDisclosures"), dict) else None
                        ),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            for product in flight.get("Products") or []:
                cabin = _normalize_product_cabin(
                    product.get("Description") or product.get("ProductTypeDescription") or ""
                )
                if not cabin:
                    continue
                prices = product.get("Prices") or [{}]
                miles = prices[0].get("Amount") if prices else 0
                taxes = prices[1].get("Amount") if len(prices) > 1 else 0
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin,  # type: ignore[arg-type]
                        seats_remaining=int(product.get("BookingCount") or 0),
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=0,
                        taxes_usd_per_pax=int(round(float(taxes or 0))),
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
                    total_duration_min=int(flight.get("TravelMinutes") or 0),
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=78,
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
    body = _build_body(origin, dest, date, 1, _united_cabin(cabin_filter))
    try:
        # united.com is on ScraperAPI's "protected domain" list — needs
        # premium=true (clean residential exits, 25 credits/req).
        async with browser_page(
            timeout_ms=150_000,
            use_brightdata=True,
        ) as page:
            # Step 1: Land on united.com so Akamai's sensor.js mints the
            # bot-validation cookies. Without these, FetchFlights returns
            # 428 even with a valid bearer token.
            await page.goto(SEARCH_PAGE, wait_until="domcontentloaded")
            await asyncio.sleep(3.0)  # let sensor.js run to completion

            # Step 2: Mint the bearer in-page (same domain, same cookies).
            token_result = await page.evaluate(
                """async () => {
                    const r = await fetch('/api/token/anonymous', {credentials: 'include'});
                    if (!r.ok) return {error: r.status};
                    const j = await r.json();
                    return {token: j?.data?.token?.hash || null};
                }"""
            )
            token = token_result.get("token")
            if not token:
                log.warning("UA token fetch failed in-page: %s", token_result)
                return []

            # Step 3: POST FetchFlights via in-page fetch. Akamai cookies +
            # per-request bm_sz validation come along automatically.
            search_result = await page.evaluate(
                """async ({body, token}) => {
                    const r = await fetch('/api/flight/FetchFlights', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': '*/*',
                            'x-authorization-api': 'bearer ' + token,
                        },
                        body: JSON.stringify(body),
                        credentials: 'include',
                    });
                    return { status: r.status, text: await r.text() };
                }""",
                {"body": body, "token": token},
            )
            if search_result.get("status") != 200:
                log.warning(
                    "UA FetchFlights status %s body[:200]=%s",
                    search_result.get("status"),
                    (search_result.get("text") or "")[:200],
                )
                return []
            try:
                payload = json.loads(search_result["text"])
            except Exception as exc:  # noqa: BLE001
                log.warning("UA response not JSON: %s", exc)
                return []
            return _parse(payload, origin, dest, date)
    except Exception as exc:  # noqa: BLE001
        log.warning("UA scrape failed: %s", exc)
        return []


search = _scrape_real
