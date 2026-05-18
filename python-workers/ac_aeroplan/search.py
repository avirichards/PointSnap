"""Air Canada Aeroplan award search plugin — REAL SCRAPE ACTIVE.

Ported from AwardWiz aeroplan.ts (lg/awardwiz, archived Sept 2024).
Endpoint structure unchanged as of 2026-05.

Flow (Patchright-driven, no login strictly required for browse):
  1. Navigate to aircanada.com/aeroplan/redeem/availability/outbound
     with route/date query params.
  2. Wait for the XHR to ../loyalty/dapidynamic/{path}/v2/search/air-bounds.
  3. Capture the response JSON via page.on("response").
  4. Parse data.airBoundGroups[] → segments + prices.milesConversion.

If AEROPLAN_USER/PASS are set in Fly secrets, login first for better
partner inventory coverage. Otherwise browse anonymously.

Returns [] if the scrape fails — no canonical fallback.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page, creds_for
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AC_AEROPLAN"
PROGRAM_NAME = "Aeroplan"

SEARCH_URL_TMPL = (
    "https://www.aircanada.com/aeroplan/redeem/availability/outbound"
    "?org0={origin}&dest0={dest}&departureDate0={date}"
    "&lang=en-CA&tripType=O&ADT=1&YTH=0&CHD=0&INF=0&INS=0&marketCode=TNB"
)
LOGIN_URL = "https://www.aircanada.com/aeroplan/login"
# Hit the homepage first so Akamai's sensor.js mints `_abck` (solved-state)
# and `bm_sz` cookies on this datacenter IP. The booking widget URL is
# path-protected by Akamai 403 — only requests with valid cookies and
# matching IP get past it.
WARMUP_URL = "https://www.aircanada.com"
AIR_BOUNDS_PATH = "/v2/search/air-bounds"


def _cabin_from_ac(code: str) -> str | None:
    return {
        "eco": "Y",
        "ecoPremium": "W",
        "business": "J",
        "first": "F",
    }.get(code)


def _parse_air_bounds(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    results: list[NormalizedResult] = []
    data = payload.get("data") or {}
    groups = data.get("airBoundGroups") or []
    flight_dict = (data.get("dictionaries") or {}).get("flight") or {}

    for grp in groups[:6]:  # cap top 6 itineraries
        try:
            bound = (grp.get("boundDetails") or {})
            seg_ids = bound.get("segments") or []
            segments: list[ResultSegment] = []
            for i, seg_ref in enumerate(seg_ids):
                fid = seg_ref.get("flightId") if isinstance(seg_ref, dict) else seg_ref
                f = flight_dict.get(fid) or {}
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=(f.get("operatingAirline") or {}).get("code") or "AC",
                        marketing_airline_iata=(f.get("marketingAirline") or {}).get("code") or "AC",
                        flight_number=str(f.get("number") or ""),
                        origin_iata=(f.get("origin") or {}).get("locationCode") or origin,
                        dest_iata=(f.get("destination") or {}).get("locationCode") or dest,
                        depart_at=(f.get("departure") or {}).get("dateTime") or f"{date}T00:00:00Z",
                        arrive_at=(f.get("arrival") or {}).get("dateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=(f.get("aircraft") or {}).get("code"),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            for air_bound in grp.get("airBounds") or []:
                cabin_code = _cabin_from_ac(air_bound.get("availabilityDetails", [{}])[0].get("cabin") or "")
                if not cabin_code:
                    continue
                prices = air_bound.get("prices") or {}
                miles_obj = (prices.get("milesConversion") or {}).get("convertedMiles") or {}
                miles = int(miles_obj.get("base") or 0)
                taxes_cents = int(prices.get("totalTaxes") or 0)
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin_code,  # type: ignore[arg-type]
                        seats_remaining=int(air_bound.get("availabilityDetails", [{}])[0].get("quota") or 0),
                        miles_per_pax=miles,
                        surcharge_usd_per_pax=0,  # AC doesn't pass YQ
                        taxes_usd_per_pax=int(round(taxes_cents / 100.0)),
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
                    total_duration_min=int(bound.get("duration") or 0),
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=81,  # match canonical AC confidence; differentiate by flight#
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("AC airBoundGroup parse error: %s", exc)
            continue

    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    url = SEARCH_URL_TMPL.format(origin=origin, dest=dest, date=date)
    user, pwd = creds_for(PROGRAM_ID)

    # AC: IPRoyal blocks aircanada.com at CONNECT, Fly direct gets Akamai
    # 403 on the booking widget path, ScraperAPI's shared pool gets 499
    # ("multiple users from your IP"). Premium=true uses clean residential
    # exits (25 credits/req).
    try:
        async with browser_page(
            timeout_ms=150_000,
            use_scraperapi=True,
            scraperapi_premium=True,
            proxy_country="ca",
        ) as page:
            captured: dict[str, Any] = {}

            async def on_response(resp):
                if AIR_BOUNDS_PATH in resp.url and resp.status == 200:
                    try:
                        captured["json"] = await resp.json()
                    except Exception:  # noqa: BLE001
                        pass

            page.on("response", on_response)

            # Block telemetry to keep the page fast.
            await page.route(
                "**/*",
                lambda route: (
                    route.abort()
                    if any(h in route.request.url for h in ("go-mpulse.net", "adobedtm.com"))
                    else route.continue_()
                ),
            )

            # Step 1: Warm-up — load homepage so Akamai sensor.js completes
            # and mints valid `_abck` (solved-state) + `bm_sz` cookies.
            try:
                await page.goto(WARMUP_URL, wait_until="domcontentloaded", timeout=30_000)
                await asyncio.sleep(4.0)  # let sensor.js finish
            except Exception as exc:  # noqa: BLE001
                log.warning("AC homepage warmup failed: %s", exc)

            # Step 2: Optional login (better partner coverage; not required).
            if user and pwd:
                try:
                    await page.goto(LOGIN_URL, wait_until="domcontentloaded")
                    await page.fill("input[name='J_USERNAME'], input#cust", user)
                    await page.fill("input[name='J_PASSWORD'], input#pin", pwd)
                    await page.click("button[type='submit'], #login-btn")
                    await page.wait_for_load_state("networkidle", timeout=15_000)
                except Exception as exc:  # noqa: BLE001
                    log.warning("AC login attempt failed (continuing anonymously): %s", exc)

            # Step 3: Navigate to the booking widget with warmed cookies.
            # Pass Referer=homepage so Akamai sees a believable navigation
            # chain instead of a cold direct request to the protected URL.
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000, referer=WARMUP_URL)
            except Exception as exc:  # noqa: BLE001
                log.warning("AC booking widget goto failed: %s", exc)
                return []

            # Wait up to 45s for the air-bounds XHR.
            for _ in range(45):
                if captured.get("json"):
                    break
                await asyncio.sleep(1.0)

            payload = captured.get("json")
            if not payload:
                log.warning("AC air-bounds XHR not captured for %s→%s", origin, dest)
                return []
            return _parse_air_bounds(payload, origin, dest, date)
    except Exception as exc:  # noqa: BLE001
        log.warning("AC scrape failed: %s", exc)
        return []


search = _scrape_real
