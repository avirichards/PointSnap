"""American AAdvantage award search plugin — REAL SCRAPE ACTIVE.

Ported from AwardWiz aa.ts (lg/awardwiz, archived Sept 2024). Body
shape verified; Shape Security in front of aa.com so we use Patchright
to prime _abck cookies.

Flow:
  1. Patchright navigates aa.com/booking/find-flights, lets Shape's
     VM-JS compute the valid _abck cookie.
  2. Optional login if AA_USER/PASS set — improves partner inventory.
  3. POST /booking/api/search/itinerary via the live page's fetch
     (so Shape's per-request tokens come along).
  4. Parse slices[].segments[].flight + pricingDetail[].

Falls back to canonical seed via wrapper on failure.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page, creds_for
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


MAX_RETRIES = 8  # AA's Akamai partially blacklists BD's pool; per-IP success ~20%.

# Sticky-session cache. Bright Data assigns one exit IP per session_id and
# pins it for ~10min idle. Once we find a session that bypasses Akamai we
# reuse it for subsequent searches — turns the ~5-attempt cost into a
# 1-attempt cost most of the time. Worker restart resets the cache.
_GOOD_SESSION_ID: str | None = None
_NEXT_PROBE_INDEX: int = 1


async def _try_once(
    attempt: int,
    session_id: str,
    user: str | None,
    pwd: str | None,
    body: dict[str, Any],
    origin: str,
    dest: str,
    date: str,
) -> tuple[str, list[NormalizedResult]]:
    """One BD-session attempt with a specific sticky session_id. Returns
    (verdict, results). verdict ∈ {'ok','page_blocked','api_blocked','bad_json','crash'}."""
    try:
        async with browser_page(
            timeout_ms=150_000,
            use_brightdata=True,
            brightdata_session=session_id,
        ) as page:
            # Prime sensor.js for /booking AND present a same-origin referer
            # in the same shot. Empirical: bare goto = 403; with referer the
            # request looks like organic intra-site navigation and Akamai
            # accepts it on ~20% of BD's exit IPs.
            await page.goto(SEARCH_PAGE, wait_until="domcontentloaded", referer=LOGIN_URL)
            await asyncio.sleep(2.0)  # sensor.js

            # Fast-fail block check before spending an API call.
            title = await page.title()
            body_text = (await page.locator("body").inner_text())[:200]
            if "Access Denied" in title or "Access Denied" in body_text:
                return ("page_blocked", [])

            # Optional login (anonymous works for browse; logged-in improves partner inventory).
            if user and pwd:
                try:
                    await page.goto(LOGIN_URL, wait_until="domcontentloaded")
                    await page.fill("input[name='loginID']", user)
                    await page.fill("input[name='password']", pwd)
                    await page.click("button[type='submit']")
                    await page.wait_for_load_state("networkidle", timeout=15_000)
                except Exception as exc:  # noqa: BLE001
                    log.warning("AA attempt %d login failed (continuing anonymously): %s", attempt, exc)

            # Fire the search XHR from inside the live page so per-request
            # tokens are appended automatically.
            result = await page.evaluate(
                """async (body) => {
                    const r = await fetch('/booking/api/search/itinerary', {
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
                return ("api_blocked", [])
            try:
                payload = json.loads(result["text"])
            except Exception:  # noqa: BLE001
                return ("bad_json", [])
            return ("ok", _parse(payload, origin, dest, date))
    except Exception as exc:  # noqa: BLE001
        log.debug("AA attempt %d crashed: %s", attempt, exc)
        return ("crash", [])


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    global _GOOD_SESSION_ID, _NEXT_PROBE_INDEX
    user, pwd = creds_for(PROGRAM_ID)
    body = _build_search_body(origin, dest, date, 1)

    # Step 1: if we've found a working session previously, try it first.
    # A working session typically holds for ~10min of inactivity before BD
    # rotates the underlying IP, so most subsequent calls land 1-attempt.
    if _GOOD_SESSION_ID:
        verdict, results = await _try_once(1, _GOOD_SESSION_ID, user, pwd, body, origin, dest, date)
        if verdict == "ok":
            log.info("AA: cached session %s succeeded (%d results)", _GOOD_SESSION_ID, len(results))
            return results
        log.info("AA: cached session %s stopped working (verdict=%s), rotating", _GOOD_SESSION_ID, verdict)
        _GOOD_SESSION_ID = None

    # Step 2: probe new sessions until one passes Akamai. Increment the
    # probe index globally so consecutive calls don't replay known-bad IDs.
    verdicts: list[str] = []
    for attempt in range(1, MAX_RETRIES + 1):
        session_id = f"aa{_NEXT_PROBE_INDEX}"
        _NEXT_PROBE_INDEX += 1
        verdict, results = await _try_once(attempt, session_id, user, pwd, body, origin, dest, date)
        verdicts.append(f"{session_id}={verdict}")
        if verdict == "ok":
            _GOOD_SESSION_ID = session_id
            log.info("AA: found working session %s on probe %d/%d (%d results, prior=%s)",
                     session_id, attempt, MAX_RETRIES, len(results), verdicts[:-1])
            return results
        if attempt < MAX_RETRIES:
            await asyncio.sleep(1.0 + attempt * 0.3)

    log.warning("AA: exhausted %d probes, verdicts=%s", MAX_RETRIES, verdicts)
    return []


search = _scrape_real
