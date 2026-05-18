"""Cathay Asia Miles award search plugin — REAL SCRAPE ACTIVE.

Ported from Greasyfork "Unelevated" CX userscript v4.0.3. Flow:
  1. Patchright login at cathaypacific.com (requires CX_USER/PASS).
  2. Navigate to redeem-flight-awards.html — extract staticFilesPath,
     tabId, requestParams from page JS globals.
  3. POST availability via fetch() inside the page so cookies + edge
     fingerprint match.
  4. Re-load facade every ~18 searches (20-call checksum window).

The TAB_ID rotation is handled within a single _scrape_real call —
each call uses one session. Future optimization: persist Patchright
context across calls for warm-session batching.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page, creds_for
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "CX_CATHAY"
PROGRAM_NAME = "Cathay Asia Miles"

REDEEM_URL = "https://www.cathaypacific.com/cx/en_US/book-a-trip/redeem-flight-awards.html"
LOGIN_URL_TMPL = (
    "https://www.cathaypacific.com/content/cx/en_US/sign-in.html"
    "?loginreferrer=https%3A%2F%2Fwww.cathaypacific.com%2Fcx%2Fen_US%2Fbook-a-trip%2Fredeem-flight-awards.html"
)


def _cabin_from_cx(code: str) -> str | None:
    c = (code or "").upper()
    if c.startswith("F"):
        return "F"
    if c.startswith("C"):
        return "J"
    if c.startswith("W"):
        return "W"
    if c.startswith("Y"):
        return "Y"
    return None


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    results: list[NormalizedResult] = []
    for it in (payload.get("itinerary") or payload.get("itineraries") or [])[:6]:
        try:
            segments_raw = it.get("segments") or it.get("segment") or []
            segments: list[ResultSegment] = []
            for i, seg in enumerate(segments_raw):
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=seg.get("operatingCarrier") or seg.get("marketingCarrier") or "CX",
                        marketing_airline_iata=seg.get("marketingCarrier") or "CX",
                        flight_number=str(seg.get("flightNumber") or ""),
                        origin_iata=seg.get("origin") or origin,
                        dest_iata=seg.get("destination") or dest,
                        depart_at=seg.get("departureDateTime") or f"{date}T00:00:00Z",
                        arrive_at=seg.get("arrivalDateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=seg.get("aircraft"),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            for fare in it.get("fares") or it.get("offers") or []:
                cabin = _cabin_from_cx(fare.get("cabinClass") or fare.get("cabin") or "")
                if not cabin:
                    continue
                miles = int(fare.get("miles") or fare.get("milesPerPax") or 0)
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin,  # type: ignore[arg-type]
                        seats_remaining=int(fare.get("seatsRemaining") or 0),
                        miles_per_pax=miles,
                        surcharge_usd_per_pax=int(round(float(fare.get("surcharge") or fare.get("yq") or 0))),
                        taxes_usd_per_pax=int(round(float(fare.get("taxes") or 0))),
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
                    total_duration_min=0,
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=76,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("CX itinerary parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    user, pwd = creds_for(PROGRAM_ID)
    if not user or not pwd:
        log.info("CX creds not set; skipping real scrape")
        return []

    try:
        async with browser_page(timeout_ms=150_000, use_scraperapi=True, proxy_country="hk") as page:
            await page.goto(LOGIN_URL_TMPL, wait_until="domcontentloaded")
            try:
                await page.fill("input[name='memberid'], input#memberid, input[name='memberID']", user)
                await page.fill("input[name='password'], input#password", pwd)
                await page.click("button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("CX login attempt failed: %s", exc)
                return []

            await page.goto(REDEEM_URL, wait_until="domcontentloaded")
            await asyncio.sleep(2.0)

            # Extract TAB_ID + staticFilesPath from page JS globals.
            tab_info = await page.evaluate(
                """() => ({
                    tabId: window.tabId || (window.requestParams && JSON.parse(window.requestParams).TAB_ID) || null,
                    staticFilesPath: window.staticFilesPath || null,
                })"""
            )
            tab_id = tab_info.get("tabId")
            if not tab_id:
                log.warning("CX TAB_ID not exposed on redeem page")
                return []

            availability_url = (
                f"https://book.cathaypacific.com/CathayPacificAwardV3/dyn/air/booking/availability?TAB_ID={tab_id}"
            )
            form_body = (
                f"requests[0][origin]={origin}&requests[0][destination]={dest}"
                f"&requests[0][depart]={date}&requests[0][adt]=1"
            )

            result = await page.evaluate(
                """async ({url, body}) => {
                    const r = await fetch(url, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
                        body: body,
                        credentials: 'include',
                    });
                    return { status: r.status, text: await r.text() };
                }""",
                {"url": availability_url, "body": form_body},
            )
            if result.get("status") != 200:
                log.warning("CX availability POST returned %s", result.get("status"))
                return []
            try:
                payload = json.loads(result["text"])
            except Exception as exc:  # noqa: BLE001
                log.warning("CX response not JSON: %s", exc)
                return []
            return _parse(payload, origin, dest, date)
    except Exception as exc:  # noqa: BLE001
        log.warning("CX scrape failed: %s", exc)
        return []


search = _scrape_real
