"""Air France / KLM Flying Blue award search plugin — REAL SCRAPE ACTIVE.

Patchright + Flying Blue login + Imperva JS challenge handling + XHR
capture. Endpoint not publicly documented; response listener captures
whatever the award search fires.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page, creds_for
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AF_FLYINGBLUE"
PROGRAM_NAME = "Flying Blue"

LOGIN_URL = "https://www.airfrance.com/sign-in"
SEARCH_PAGE = "https://www.flyingblue.com/en/spend/flights/rewards"
XHR_HINTS = ("rewards", "availability", "calendar", "offers", "booking")


def _parse(payload: Any, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    results: list[NormalizedResult] = []
    flights = (payload.get("flights") or payload.get("calendar") or payload.get("offers") or []) if isinstance(payload, dict) else []
    for f in flights[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for cabin_code in ("Y", "W", "J", "F"):
                miles_obj = (f.get("prices") or f.get("cabins") or {}).get(cabin_code)
                if not miles_obj:
                    continue
                miles = miles_obj if isinstance(miles_obj, int) else miles_obj.get("miles", 0)
                if not miles:
                    continue
                taxes_eur = miles_obj.get("taxes", 0) if isinstance(miles_obj, dict) else 0
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin_code,  # type: ignore[arg-type]
                        seats_remaining=0,
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=int(round(float(taxes_eur) * 1.1)),  # EUR→USD rough
                        taxes_usd_per_pax=0,
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
                            operating_airline_iata=f.get("carrier") or "AF",
                            marketing_airline_iata="AF",
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
                    confidence_score=67,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("AF parse error: %s", exc)
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
        log.info("AF creds not set; skipping real scrape")
        return []

    try:
        async with browser_page(timeout_ms=150_000, use_scraperapi=True, proxy_country="fr") as page:
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
                await page.fill("input[name='_username'], input#_username, input[type='email']", user)
                await page.fill("input[name='_password'], input#_password, input[type='password']", pwd)
                await page.click("button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=25_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("AF login failed: %s", exc)
                return []

            search_url = (
                f"{SEARCH_PAGE}?origin={origin}&destination={dest}&departureDate={date}&pax=1&type=ONE_WAY"
            )
            await page.goto(search_url, wait_until="domcontentloaded")
            await asyncio.sleep(6.0)  # Imperva + SPA delay

            if captured.get("json"):
                log.info("AF captured XHR: %s", captured.get("first_url"))
                return _parse(captured["json"], origin, dest, date)
            log.warning("AF no XHR captured")
            return []
    except Exception as exc:  # noqa: BLE001
        log.warning("AF scrape failed: %s", exc)
        return []


search = _scrape_real
