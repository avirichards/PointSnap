"""American AAdvantage award search plugin — mobile-redirect form-fill.

Discovery path through session 5:
  - BD Browser API on www.aa.com/booking/find-flights: Akamai 403 across all
    IPs/countries/sessions; sensor.js cookies never validate.
  - BD Web Unlocker direct API POST: AA returns error 309 (no session).
  - CapSolver Akamai BMP: CapSolver deprecated this task type.
  - **BD Browser API on mobile.aa.com**: HTTP 200 — Akamai redirects
    mobile.aa.com → www.aa.com/homePage.do, the latter loads cleanly with
    full HTML. From there the legacy `reservationFlightSearchForm` is
    available and Patchright can fill + submit it like a real user.

Flow:
  1. Browser API navigates to mobile.aa.com → AA redirects → homePage.do
     loads (200 OK, full HTML).
  2. Wait for the booking form to render.
  3. Fill originAirport, destinationAirport, departDate.
  4. Toggle the "redeem miles" checkbox so AA returns award prices.
  5. Click the search submit button.
  6. Capture either the resulting XHR (AA fires a booking API call) or
     the navigation to the results page.
  7. Parse cabin prices.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AA_AADVANTAGE"
PROGRAM_NAME = "AAdvantage"

ENTRY_URL = "https://mobile.aa.com/booking"  # redirects to www.aa.com/homePage.do
MAX_ATTEMPTS = 3


def _cabin_from_aa(product_type: str) -> str | None:
    s = (product_type or "").upper()
    if "FIRST" in s: return "F"
    if "BUSINESS" in s or "FLAGSHIP" in s: return "J"
    if "PREMIUM" in s and "ECONOMY" in s: return "W"
    if "COACH" in s or "ECONOMY" in s or "MAIN" in s: return "Y"
    return None


def _parse_xhr(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse the JSON the booking widget's search API returns.
    Shape mirrors the AwardWiz parser; will need fixups if AA changed it."""
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


def _date_mmddyyyy(iso_date: str) -> str:
    """Convert YYYY-MM-DD to MM/DD/YYYY (AA's form expects this format)."""
    y, m, d = iso_date.split("-")
    return f"{m}/{d}/{y}"


async def _try_once(attempt: int, origin: str, dest: str, date: str) -> tuple[str, list[NormalizedResult]]:
    """One attempt: load mobile.aa.com → home page → fill form → submit →
    capture XHR. Returns (verdict, results)."""
    try:
        async with browser_page(
            timeout_ms=120_000,
            use_brightdata=True,
        ) as page:
            captured_xhrs: list[dict] = []

            async def _on_response(resp):
                url = resp.url
                if any(p in url for p in ("/booking/api/", "/api/booking/", "/api/search/", "/booking/find-flights")):
                    try:
                        ct = (resp.headers or {}).get("content-type", "") or ""
                        item = {"url": url, "status": resp.status, "content_type": ct}
                        if "json" in ct.lower() and resp.status == 200:
                            try:
                                item["json"] = await resp.json()
                            except Exception:
                                pass
                        captured_xhrs.append(item)
                    except Exception:  # noqa: BLE001
                        pass
            page.on("response", _on_response)

            print(f"AA: attempt {attempt} navigating to {ENTRY_URL}", flush=True)
            # domcontentloaded fires when HTML is parsed; AA has continuous
            # analytics XHRs so networkidle never settles within the timeout.
            await page.goto(ENTRY_URL, wait_until="domcontentloaded", timeout=60_000)
            await asyncio.sleep(5.0)  # let initial JS render the form

            title = await page.title()
            url_now = page.url
            print(f"AA: attempt {attempt} loaded title={title!r} url={url_now}", flush=True)
            if "Access Denied" in title:
                return ("page_blocked", [])

            # Look for the booking form. It uses field name 'originAirport' on
            # both mobile and desktop variants.
            try:
                await page.wait_for_selector("input[name='originAirport']", timeout=15_000)
            except Exception as exc:  # noqa: BLE001
                # Form not present; capture what IS on the page for diagnosis
                form_dump = await page.evaluate("""
                    () => Array.from(document.querySelectorAll('input,select,button[type="submit"]')).slice(0,40).map(el => ({
                        tag: el.tagName.toLowerCase(), name: el.getAttribute('name'),
                        id: el.id, type: el.type || null, aria: el.getAttribute('aria-label'),
                    })).filter(x => x.name || x.id || x.aria)
                """)
                print(f"AA: attempt {attempt} form not found; inputs on page: {json.dumps(form_dump)[:600]}", flush=True)
                return ("no_form", [])

            print(f"AA: attempt {attempt} form found, filling…", flush=True)

            # Fill the form. Use JS evaluate for reliability — selectors are stable
            # in name= attribute but jQuery may also be involved.
            fill_result = await page.evaluate(
                """
                ({ origin, dest, date }) => {
                    function setVal(name, val) {
                        const el = document.querySelector(`[name="${name}"]`);
                        if (!el) return false;
                        el.value = val;
                        el.dispatchEvent(new Event('input', {bubbles:true}));
                        el.dispatchEvent(new Event('change', {bubbles:true}));
                        return true;
                    }
                    const results = {};
                    results.tripType = setVal('tripType', 'oneWay');
                    // tripType is a radio group; click the right radio explicitly
                    const oneWayRadio = document.querySelector('input[name="tripType"][value="oneWay"]');
                    if (oneWayRadio) { oneWayRadio.checked = true; oneWayRadio.click(); results.oneWayClicked = true; }
                    const award = document.querySelector('input[name="redeemMiles"]');
                    if (award) { award.checked = true; award.click(); results.awardClicked = true; }
                    results.origin = setVal('originAirport', origin);
                    results.dest = setVal('destinationAirport', dest);
                    results.date = setVal('departDate', date);
                    return results;
                }
                """,
                {"origin": origin, "dest": dest, "date": _date_mmddyyyy(date)},
            )
            print(f"AA: attempt {attempt} fill result: {fill_result}", flush=True)
            await asyncio.sleep(1.0)

            # Submit by clicking the search button (form's onsubmit JS will fire).
            try:
                # Common button selectors AA uses
                submit_btn = await page.query_selector(
                    "button[type='submit'][name*='Search'], "
                    "button:has-text('Search'), "
                    "input[name='flightSearchForm.button.reSubmit'], "
                    "button#flightSearchSubmit"
                )
                if submit_btn:
                    await submit_btn.click()
                    print(f"AA: attempt {attempt} clicked submit button", flush=True)
                else:
                    # Fallback: submit form via JS
                    await page.evaluate(
                        "document.querySelector('form[name=\"reservationFlightSearchForm\"]')?.submit()"
                    )
                    print(f"AA: attempt {attempt} submitted form via JS fallback", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"AA: attempt {attempt} submit failed: {exc}", flush=True)
                return ("submit_failed", [])

            # Wait for either navigation or search XHR. Use load (not
            # networkidle — AA's analytics never goes idle).
            try:
                await page.wait_for_load_state("load", timeout=30_000)
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(6.0)  # extra time for XHR to fire and complete

            print(f"AA: attempt {attempt} post-submit url={page.url} title={await page.title()!r}", flush=True)
            print(f"AA: attempt {attempt} captured {len(captured_xhrs)} relevant XHRs", flush=True)
            for x in captured_xhrs[:10]:
                has_json = "json" in x
                print(f"AA:   XHR {x['status']} {x['url'][:120]} json={has_json}", flush=True)

            # Find a usable JSON payload in the XHRs
            for x in captured_xhrs:
                if "json" in x and isinstance(x["json"], dict):
                    payload = x["json"]
                    if payload.get("slices"):
                        parsed = _parse_xhr(payload, origin, dest, date)
                        if parsed:
                            return ("ok", parsed)

            # If no useful XHR, look at the page itself for award prices (HTML results page)
            page_text = await page.locator("body").inner_text()
            if "miles" in page_text.lower() and (origin in page_text or dest in page_text):
                # Found a results page rendered to HTML — but we'd need a separate parser.
                # For now, report this as a partial success so we know the form submission worked.
                print(f"AA: attempt {attempt} got HTML results page (parser TBD); text snippet: {page_text[:600]!r}", flush=True)
                return ("html_results_unparsed", [])

            return ("no_results", [])

    except Exception as exc:  # noqa: BLE001
        print(f"AA: attempt {attempt} crash: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
        return ("crash", [])


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    print(f"AA: ===== search start {origin}->{dest} {date} =====", flush=True)
    verdicts = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        verdict, results = await _try_once(attempt, origin, dest, date)
        verdicts.append(verdict)
        if verdict == "ok":
            print(f"AA: attempt {attempt} SUCCESS ({len(results)} rows, prior={verdicts[:-1]})", flush=True)
            return results
        if verdict in ("html_results_unparsed",):
            # Partial success — page loaded with results but parser TBD.
            # Continue to next attempt in case we eventually get JSON XHR.
            pass
    print(f"AA: exhausted {MAX_ATTEMPTS} attempts, verdicts={verdicts}", flush=True)
    return []


search = _scrape_real
