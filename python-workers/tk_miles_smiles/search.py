"""Turkish Miles&Smiles award search plugin — REAL SCRAPE ACTIVE.

Patchright + Miles&Smiles login + form-driven search + XHR capture
from turkishairlines.com booking flow. Phantom-availability handling
deferred to follow-up (record what comes back; future commit adds the
price-confirm step).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page, creds_for
from common.plugin_wrapper import with_canonical_fallback
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "TK_MILES_SMILES"
PROGRAM_NAME = "Turkish Miles&Smiles"

LOGIN_URL = "https://www.turkishairlines.com/en-int/miles-and-smiles/login/"
SEARCH_PAGE = (
    "https://www.turkishairlines.com/en-int/miles-and-smiles/book-award-tickets/availability/"
)
XHR_HINTS = ("availability", "booking", "miles", "search", "offer")


def _parse(payload: Any, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    results: list[NormalizedResult] = []
    items = (payload.get("availabilities") or payload.get("offers") or payload.get("flights") or []) if isinstance(payload, dict) else []
    for it in items[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for cabin_key, cab in (("economy", "Y"), ("business", "J"), ("first", "F")):
                price_obj = (it.get("prices") or it.get("cabins") or {}).get(cabin_key) or {}
                miles = price_obj.get("miles") if isinstance(price_obj, dict) else price_obj
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cab,  # type: ignore[arg-type]
                        seats_remaining=0,
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=0,
                        taxes_usd_per_pax=int(round(float(price_obj.get("taxes") or 0))) if isinstance(price_obj, dict) else 0,
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
                    num_segments=1,
                    segments=[
                        ResultSegment(
                            segment_order=0,
                            operating_airline_iata="TK",
                            marketing_airline_iata="TK",
                            flight_number=str(it.get("flightNumber") or ""),
                            origin_iata=origin,
                            dest_iata=dest,
                            depart_at=f"{date}T00:00:00Z",
                            arrive_at=f"{date}T00:00:00Z",
                            aircraft_icao=None,
                            segment_cabin=None,
                            fare_class=None,
                        )
                    ],
                    cabin_prices=cabin_prices,
                    confidence_score=38,  # phantom-prone — keep low until two-step verify lands
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("TK parse error: %s", exc)
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
        log.info("TK creds not set; skipping real scrape")
        return []

    try:
        async with browser_page(timeout_ms=60_000) as page:
            captured: dict[str, Any] = {}

            async def on_response(resp):
                if any(h in resp.url for h in XHR_HINTS) and "json" in (resp.headers.get("content-type") or ""):
                    try:
                        captured.setdefault("first_url", resp.url)
                        captured["json"] = await resp.json()
                    except Exception:
                        pass

            page.on("response", on_response)

            await page.goto(LOGIN_URL, wait_until="domcontentloaded")
            try:
                await page.fill("input[name='memberNumber'], input[name='username']", user)
                await page.fill("input[name='password']", pwd)
                await page.click("button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("TK login failed: %s", exc)
                return []

            await page.goto(SEARCH_PAGE, wait_until="domcontentloaded")
            await asyncio.sleep(2.0)
            try:
                await page.fill("input[name='origin'], input[name='from']", origin)
                await page.fill("input[name='destination'], input[name='to']", dest)
                await page.fill("input[name='departureDate']", date)
                await page.click("button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=30_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("TK form fill failed: %s", exc)

            if captured.get("json"):
                log.info("TK captured XHR: %s", captured.get("first_url"))
                return _parse(captured["json"], origin, dest, date)
            log.warning("TK no XHR captured")
            return []
    except Exception as exc:  # noqa: BLE001
        log.warning("TK scrape failed: %s", exc)
        return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
