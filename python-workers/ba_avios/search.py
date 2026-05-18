"""British Airways Avios award search plugin — REAL SCRAPE ACTIVE.

Patchright + Executive Club login + XHR capture on ba.com's reward
search page. Endpoint URL not publicly documented for 2026; we use
Patchright's response listener to capture whatever XHR the search form
fires.

BA renames internal endpoints frequently — this scraper logs the
captured URL so debugging is straightforward.
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
PROGRAM_ID = "BA_AVIOS"
PROGRAM_NAME = "British Airways Avios"

LOGIN_URL = "https://www.britishairways.com/travel/loginr/public/en_gb"
SEARCH_PAGE = "https://www.britishairways.com/travel/redeem/execclub/_gf/en_gb"
# Likely XHR path patterns (we filter responses by substring)
XHR_HINTS = ("redeem", "availability", "reward", "flightfinder", "search")


def _cabin_from_ba(code: str) -> str | None:
    return {"M": "Y", "Y": "Y", "W": "W", "C": "J", "J": "J", "F": "F", "A": "F"}.get((code or "").upper())


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Best-effort parse. BA's response shape is approximated from
    historical references (timrogers/ba_rewards 2014); modern shape may
    differ. If parse fails the wrapper falls back to canonical."""
    results: list[NormalizedResult] = []
    flights = payload.get("flights") or payload.get("itineraries") or payload.get("out") or []
    for f in flights[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for cabin_key, miles_obj in (f.get("prices") or f.get("fares") or {}).items():
                cabin = _cabin_from_ba(cabin_key)
                miles = miles_obj if isinstance(miles_obj, int) else (miles_obj.get("miles") if isinstance(miles_obj, dict) else 0)
                if not cabin or not miles:
                    continue
                taxes = 0
                if isinstance(miles_obj, dict):
                    taxes = int(round(float(miles_obj.get("tax") or 0)))
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin,  # type: ignore[arg-type]
                        seats_remaining=int(f.get("bs") or f.get("seatsRemaining") or 0),
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=175,  # BA YQ typical per segment
                        taxes_usd_per_pax=taxes,
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
                            operating_airline_iata="BA",
                            marketing_airline_iata="BA",
                            flight_number=str(f.get("flightNumber") or ""),
                            origin_iata=origin,
                            dest_iata=dest,
                            depart_at=f.get("departureDateTime") or f"{date}T00:00:00Z",
                            arrive_at=f.get("arrivalDateTime") or f"{date}T00:00:00Z",
                            aircraft_icao=None,
                            segment_cabin=None,
                            fare_class=None,
                        )
                    ],
                    cabin_prices=cabin_prices,
                    confidence_score=68,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("BA flight parse error: %s", exc)
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
        log.info("BA creds not set; skipping real scrape")
        return []

    try:
        async with browser_page(timeout_ms=150_000, use_scraperapi=True, proxy_country="gb") as page:
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
                await page.fill("input[name='membershipNumber'], input#membershipNumber", user)
                await page.fill("input[name='password'], input#password", pwd)
                await page.click("button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("BA login attempt failed: %s", exc)
                return []

            await page.goto(SEARCH_PAGE, wait_until="domcontentloaded")
            await asyncio.sleep(2.0)
            # Best-effort form fill — selectors are speculative without HAR
            try:
                await page.fill("input[name='from'], input[name='origin']", origin)
                await page.fill("input[name='to'], input[name='destination']", dest)
                await page.fill("input[name='departureDate']", date)
                await page.click("button[type='submit'], input[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=30_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("BA form fill failed (no captured XHR): %s", exc)

            if captured.get("json"):
                log.info("BA captured XHR: %s", captured.get("first_url"))
                return _parse(captured["json"], origin, dest, date)
            log.warning("BA: no XHR captured matching hints %s", XHR_HINTS)
            return []
    except Exception as exc:  # noqa: BLE001
        log.warning("BA scrape failed: %s", exc)
        return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
