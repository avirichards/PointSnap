"""Avianca LifeMiles award search plugin — REAL SCRAPE ACTIVE.

Patchright + LifeMiles login + XHR capture on lifemiles.com/fly/find.
SPA endpoint not publicly documented; relies on response listener.

Recommends Colombian residential IP for best inventory parity but
runs on any region.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page, creds_for
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AV_LIFEMILES"
PROGRAM_NAME = "Avianca LifeMiles"

LOGIN_URL = "https://www.lifemiles.com/web/login"
SEARCH_PAGE = "https://www.lifemiles.com/fly/find"
XHR_HINTS = ("availability", "redemption", "flights", "fly/find")


def _parse(payload: Any, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Speculative parse — LifeMiles SPA shape unknown until HAR capture."""
    results: list[NormalizedResult] = []
    items = (payload.get("itineraries") or payload.get("results") or []) if isinstance(payload, dict) else []
    for it in items[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for c in ("Y", "W", "J", "F"):
                miles = (it.get("prices") or {}).get(c)
                if miles:
                    cabin_prices.append(
                        CabinPrice(
                            cabin=c,  # type: ignore[arg-type]
                            seats_remaining=0,
                            miles_per_pax=int(miles),
                            surcharge_usd_per_pax=0,  # AV doesn't pass YQ
                            taxes_usd_per_pax=int(round(float(it.get("taxes") or 0))),
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
                            operating_airline_iata=it.get("carrier") or "AV",
                            marketing_airline_iata="AV",
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
                    confidence_score=70,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("AV parse error: %s", exc)
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
        log.info("AV creds not set; skipping real scrape")
        return []

    try:
        async with browser_page(timeout_ms=150_000, use_brightdata=True) as page:
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
                await page.fill("input[name='userName'], input[name='username'], input#username", user)
                await page.fill("input[name='password'], input#password", pwd)
                await page.click("button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("AV login failed: %s", exc)
                return []

            search_url = f"{SEARCH_PAGE}?origin={origin}&destination={dest}&date={date}&pax=1&type=ONE_WAY"
            await page.goto(search_url, wait_until="domcontentloaded")
            await asyncio.sleep(5.0)  # SPA fetch delay

            if captured.get("json"):
                log.info("AV captured XHR: %s", captured.get("first_url"))
                return _parse(captured["json"], origin, dest, date)
            log.warning("AV no XHR captured")
            return []
    except Exception as exc:  # noqa: BLE001
        log.warning("AV scrape failed: %s", exc)
        return []


search = _scrape_real
