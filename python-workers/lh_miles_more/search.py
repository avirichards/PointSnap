"""Lufthansa Miles & More award search plugin — REAL SCRAPE ACTIVE.

Hardest of the 13. Patchright + Miles&More login + XHR capture from
miles-and-more.com / lufthansa.com booking widget. Endpoint never
publicly reverse-engineered — relies entirely on response listener.

Expect aggressive Akamai BMP behavior + 3-challenge stacking. Throttle
hard if scaling.
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
PROGRAM_ID = "LH_MILES_MORE"
PROGRAM_NAME = "Miles & More"

LOGIN_URL = "https://www.miles-and-more.com/de/en/account/login.html"
SEARCH_PAGE = "https://www.miles-and-more.com/de/en/spend/award-overview.html"
XHR_HINTS = ("award", "availability", "booking", "offers", "search")


def _parse(payload: Any, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    results: list[NormalizedResult] = []
    flights = (payload.get("flights") or payload.get("offers") or payload.get("itineraries") or []) if isinstance(payload, dict) else []
    for f in flights[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for cab_key, cab in (("economy", "Y"), ("premiumEconomy", "W"), ("business", "J"), ("first", "F")):
                price_obj = (f.get("prices") or f.get("cabins") or {}).get(cab_key) or {}
                miles = price_obj.get("miles") if isinstance(price_obj, dict) else price_obj
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cab,  # type: ignore[arg-type]
                        seats_remaining=0,
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=850 if cab == "F" else 0,  # LH F YQ typical
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
                            operating_airline_iata=f.get("carrier") or "LH",
                            marketing_airline_iata="LH",
                            flight_number=str(f.get("flightNumber") or ""),
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
                    confidence_score=22,  # heavy phantom; keep "Low"
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("LH parse error: %s", exc)
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
        log.info("LH creds not set; skipping real scrape")
        return []

    try:
        async with browser_page(timeout_ms=150_000, use_scraperapi=True, proxy_country="de") as page:
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
                await page.fill("input[name='userId'], input[name='cardNumber']", user)
                await page.fill("input[name='password'], input[name='pin']", pwd)
                await page.click("button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=30_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("LH login failed: %s", exc)
                return []

            await page.goto(SEARCH_PAGE, wait_until="domcontentloaded")
            await asyncio.sleep(4.0)
            try:
                await page.fill("input[name='origin'], input[name='from']", origin)
                await page.fill("input[name='destination'], input[name='to']", dest)
                await page.fill("input[name='outboundDate']", date)
                await page.click("button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=45_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("LH form fill failed: %s", exc)

            if captured.get("json"):
                log.info("LH captured XHR: %s", captured.get("first_url"))
                return _parse(captured["json"], origin, dest, date)
            log.warning("LH no XHR captured")
            return []
    except Exception as exc:  # noqa: BLE001
        log.warning("LH scrape failed: %s", exc)
        return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
