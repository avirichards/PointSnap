"""American AAdvantage award search plugin — Browser API + form-fill flow.

Path determined empirically over many attempts in session 5:
  - Direct API POST (WU or page.evaluate): blocked by AA app-layer (error 309)
    AA requires session state that only a real form submission creates.
  - Direct HTML page load (WU): blocked by Akamai (captcha/protection page)
  - BD Browser API + Referer trick: ~20% of exit IPs load the page, but the
    in-page fetch to /booking/api/search/itinerary returns 403.

The remaining option is to load the booking page in BD's Browser API and
drive the booking widget like a human would — fill form, click search,
capture the XHR that AA's own JS fires. AA's JS handles the session/CSRF/
cookie minting that we can't reproduce manually.

This file is currently in DIAGNOSTIC mode: it loads the page (with retry
across sticky sessions), inspects the form structure, and prints all input
fields it sees. Once we know the current selectors, this becomes the real
scrape.

Uses print(flush=True) instead of logging.* because some log statements
are not appearing in Fly logs (likely a Python logging config interaction
we haven't tracked down yet).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AA_AADVANTAGE"
PROGRAM_NAME = "AAdvantage"

SEARCH_PAGE = "https://www.aa.com/booking/find-flights"
LOYALTY_REFERER = "https://www.aa.com/loyalty/login"
MAX_ATTEMPTS = 30
# BD lets you embed a country in the session_id ("...-country-XX"). Rotate
# across multiple residential pools — US is heavily blacklisted by AA today;
# other-country residentials may be less filtered.
COUNTRY_ROTATION = ["us", "ca", "gb", "de", "jp", "au"]


def _build_search_body(origin: str, dest: str, date: str, pax: int) -> dict[str, Any]:
    """Kept for compatibility/reference — not used in form-fill flow."""
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
    if "FIRST" in s: return "F"
    if "BUSINESS" in s or "FLAGSHIP" in s: return "J"
    if "PREMIUM" in s and "ECONOMY" in s: return "W"
    if "COACH" in s or "ECONOMY" in s or "MAIN" in s: return "Y"
    return None


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Same parser as the previous version — slices[].segments[].flight + pricingDetail[]."""
    results: list[NormalizedResult] = []
    slices = payload.get("slices") or []
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
                if not pd.get("productAvailable"): continue
                cabin = _cabin_from_aa(pd.get("productType") or "")
                if not cabin: continue
                miles = int(pd.get("perPassengerAwardPoints") or 0)
                if not miles: continue
                cabin_prices.append(CabinPrice(
                    cabin=cabin,  # type: ignore[arg-type]
                    seats_remaining=0,
                    miles_per_pax=miles,
                    surcharge_usd_per_pax=0,
                    taxes_usd_per_pax=int(round(float(pd.get("perPassengerTaxesAndFees") or 0))),
                ))
            if not cabin_prices: continue
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            results.append(NormalizedResult(
                program_id=PROGRAM_ID, program_name=PROGRAM_NAME,
                origin_iata=origin, dest_iata=dest,
                depart_date=date, arrive_date=date,
                total_duration_min=int(sl.get("durationInMinutes") or 0),
                num_segments=len(segments), segments=segments, cabin_prices=cabin_prices,
                confidence_score=86,
                observed_at=now, last_seen_at=now,
            ))
        except Exception as exc:  # noqa: BLE001
            print(f"AA: slice parse error: {exc}", flush=True)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """Diagnostic phase: load the booking page via BD Browser API, inspect
    the form, and report what selectors are present so we can build the
    real form-fill flow."""
    print(f"AA: ===== search start {origin}->{dest} {date} =====", flush=True)

    # Skip 'us' — empirically gets a hard block with no redemption. Non-US
    # countries get the Akamai soft-challenge variant which embeds sensor.js
    # and is solvable by letting Patchright execute it then retrying.
    non_us_rotation = ["ca", "gb", "de", "jp", "au"]

    for attempt in range(1, MAX_ATTEMPTS + 1):
        country = non_us_rotation[(attempt - 1) % len(non_us_rotation)]
        session_id = f"aa{uuid.uuid4().hex[:6]}-country-{country}"
        print(f"AA: attempt {attempt}/{MAX_ATTEMPTS} session={session_id}", flush=True)

        try:
            async with browser_page(
                timeout_ms=90_000,
                use_brightdata=True,
                brightdata_session=session_id,
            ) as page:
                captured: dict[str, Any] = {"xhrs": []}

                async def _on_response(resp):
                    url = resp.url
                    if any(p in url for p in ("/booking/api/", "/api/booking/", "/aapi/", "/search/")):
                        try:
                            ct = (resp.headers or {}).get("content-type", "")
                            captured["xhrs"].append({"url": url, "status": resp.status, "content_type": ct})
                        except Exception:  # noqa: BLE001
                            pass
                page.on("response", _on_response)

                # First request — Akamai soft-challenge will return 403 with
                # an embedded sensor.js. networkidle waits for the script to
                # finish minting cookies.
                await page.goto(SEARCH_PAGE, wait_until="networkidle", referer=LOYALTY_REFERER, timeout=60_000)
                await asyncio.sleep(4.0)  # extra margin for sensor.js to complete and Set-Cookie to apply

                title = await page.title()
                if "Access Denied" in title:
                    # Soft-challenge variant — sensor.js has now (hopefully) minted
                    # the _abck cookie. Reload the page in the same session; cookies
                    # carry over and Akamai should accept this second request.
                    cookies_before = len(await page.context.cookies())
                    print(f"AA: attempt {attempt} got challenge (cookies={cookies_before}); reloading after sensor.js", flush=True)
                    try:
                        await page.goto(SEARCH_PAGE, wait_until="networkidle", referer=LOYALTY_REFERER, timeout=60_000)
                        await asyncio.sleep(2.5)
                    except Exception as exc:  # noqa: BLE001
                        print(f"AA: attempt {attempt} reload failed: {type(exc).__name__}: {str(exc)[:120]}", flush=True)
                        continue
                    title = await page.title()
                    cookies_after = len(await page.context.cookies())
                    print(f"AA: attempt {attempt} after reload title={title!r} cookies={cookies_after}", flush=True)
                    if "Access Denied" in title:
                        if attempt <= 4:
                            html = (await page.content())[:600]
                            print(f"AA:   still blocked body=html[:500]={html[:500]!r}", flush=True)
                        print(f"AA: attempt {attempt} PAGE_BLOCKED_after_reload country={country}", flush=True)
                        continue

                print(f"AA: attempt {attempt} PAGE_LOADED country={country} title={title!r}", flush=True)
                print(f"AA:   page url after load: {page.url}", flush=True)

                # Dump form structure
                form_info = await page.evaluate("""
                    () => {
                        const inputs = Array.from(document.querySelectorAll('input,select,button[type="submit"]')).slice(0, 50).map(el => ({
                            tag: el.tagName.toLowerCase(),
                            type: el.type || null,
                            name: el.getAttribute('name') || null,
                            id: el.id || null,
                            placeholder: el.placeholder || null,
                            aria_label: el.getAttribute('aria-label') || null,
                            data_test: el.getAttribute('data-test') || null,
                            text: (el.innerText || el.value || '').slice(0, 40),
                        }));
                        const forms = Array.from(document.querySelectorAll('form')).slice(0, 5).map(f => ({
                            action: f.action,
                            method: f.method,
                            id: f.id,
                            name: f.name,
                        }));
                        return {
                            inputs: inputs.filter(x => x.name || x.id || x.placeholder || x.aria_label || x.data_test || x.text),
                            forms,
                        };
                    }
                """)

                print(f"AA:   form_info: {json.dumps(form_info)[:1500]}", flush=True)
                print(f"AA:   XHRs captured during load: {len(captured['xhrs'])}", flush=True)
                for x in captured["xhrs"][:10]:
                    print(f"AA:     XHR {x['status']} {x['url'][:140]}", flush=True)

                # Diagnostic done; return [] so the cockpit knows nothing yet
                print(f"AA: diagnostic complete on attempt {attempt}", flush=True)
                return []

        except Exception as exc:  # noqa: BLE001
            print(f"AA: attempt {attempt} CRASH: {type(exc).__name__}: {str(exc)[:150]}", flush=True)
            continue

    print(f"AA: all {MAX_ATTEMPTS} attempts exhausted, no successful page load", flush=True)
    return []


search = _scrape_real
