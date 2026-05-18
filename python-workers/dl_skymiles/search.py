"""Delta SkyMiles award search plugin — REAL SCRAPE ACTIVE.

Patchright primes DataDome, optional login captures miles pricing,
search fires from inside the page so DataDome's intent ML accepts.
Ported from AwardWiz delta.ts (archived 2024) + community references.

Endpoint speculative (Delta renames internals frequently); on URL
miss the fallback wrapper kicks in.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page, creds_for
from common.plugin_wrapper import with_canonical_fallback
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "DL_SKYMILES"
PROGRAM_NAME = "Delta SkyMiles"

SEARCH_PAGE = "https://www.delta.com/flight-search/book-a-flight"
LOGIN_URL = "https://www.delta.com/skymiles/login"
SEARCH_API = "https://www.delta.com/shop/ow/search"


def _cabin_from_cos(code: str) -> str | None:
    return {"O": "J", "I": "J", "Z": "J", "U": "J"}.get(code, "Y")


def _build_search_body(origin: str, dest: str, date: str, pax: int) -> dict[str, Any]:
    return {
        "selectTripType": "OW",
        "awardTravel": True,
        "passengerInfo": [{"count": pax, "type": "ADT"}],
        "tripOriginAirportCode": origin,
        "tripDestinationAirportCode": dest,
        "departureDate": date,
        "cabinFareClass": "BE",
        "shopType": "MILES",
        "searchByCabin": True,
        "flexAirportRadius": "nonStop",
        "numberOfResults": 50,
    }


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    results: list[NormalizedResult] = []
    for it in (payload.get("itinerary") or [])[:6]:
        try:
            trips = it.get("trip") or []
            segments_raw = []
            for t in trips:
                segments_raw.extend(t.get("flightSegment") or [])

            segments: list[ResultSegment] = []
            for i, seg in enumerate(segments_raw):
                mc = (seg.get("marketingCarrier") or {}).get("code") or "DL"
                op = (seg.get("operatingCarrier") or {}).get("code") or mc
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=op,
                        marketing_airline_iata=mc,
                        flight_number=str(seg.get("flightNumber") or ""),
                        origin_iata=(seg.get("originAirport") or {}).get("code") or origin,
                        dest_iata=(seg.get("destAirport") or {}).get("code") or dest,
                        depart_at=seg.get("departureDateTime") or f"{date}T00:00:00Z",
                        arrive_at=seg.get("arrivalDateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=(seg.get("equipment") or {}).get("model"),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices_by_code: dict[str, CabinPrice] = {}
            for offer in it.get("fareOffer") or []:
                if offer.get("soldOut"):
                    continue
                cos = ((offer.get("brandInfoByFlightLegs") or [{}])[0].get("cos") or [None])[0]
                cabin = _cabin_from_cos(cos or "")
                if not cabin:
                    continue
                miles = ((offer.get("totalPrice") or {}).get("miles") or {}).get("miles") or 0
                cash = ((offer.get("totalPrice") or {}).get("currency") or {}).get("amount") or 0
                if not miles:
                    continue
                existing = cabin_prices_by_code.get(cabin)
                if existing and existing.miles_per_pax <= int(miles):
                    continue
                cabin_prices_by_code[cabin] = CabinPrice(
                    cabin=cabin,  # type: ignore[arg-type]
                    seats_remaining=0,
                    miles_per_pax=int(miles),
                    surcharge_usd_per_pax=0,
                    taxes_usd_per_pax=int(round(float(cash))),
                )
            if not cabin_prices_by_code:
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
                    total_duration_min=0,
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=list(cabin_prices_by_code.values()),
                    confidence_score=55,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("DL itinerary parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    user, pwd = creds_for(PROGRAM_ID)
    body = _build_search_body(origin, dest, date, 1)

    try:
        async with browser_page(timeout_ms=120_000, use_scraperapi=True, proxy_country="us") as page:
            await page.goto(SEARCH_PAGE, wait_until="domcontentloaded")
            await asyncio.sleep(3.0)  # DataDome JS warmup

            if user and pwd:
                try:
                    await page.goto(LOGIN_URL, wait_until="domcontentloaded")
                    await page.fill("input[name='username'], input#username", user)
                    await page.fill("input[name='password'], input#password", pwd)
                    await page.click("button[type='submit']")
                    await page.wait_for_load_state("networkidle", timeout=15_000)
                except Exception as exc:  # noqa: BLE001
                    log.warning("DL login failed (continuing anonymously): %s", exc)

            result = await page.evaluate(
                """async (body) => {
                    const r = await fetch('/shop/ow/search', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
                        body: JSON.stringify(body),
                        credentials: 'include',
                    });
                    return { status: r.status, text: await r.text() };
                }""",
                body,
            )
            if result.get("status") != 200:
                log.warning("DL search POST returned %s", result.get("status"))
                return []
            try:
                payload = json.loads(result["text"])
            except Exception as exc:  # noqa: BLE001
                log.warning("DL response not JSON: %s", exc)
                return []
            return _parse(payload, origin, dest, date)
    except Exception as exc:  # noqa: BLE001
        log.warning("DL scrape failed: %s", exc)
        return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
