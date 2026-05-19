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

# Module-level diagnostic state — last scrape's captured XHRs, exposed via
# /diag/aa_last endpoint so we can inspect without depending on fly logs.
LAST_RUN_DIAG: dict = {"attempts": []}


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
            captured_xhrs: list[dict] = []  # graphql + booking APIs (parser candidates)

            async def _on_response(resp):
                try:
                    url = resp.url
                    if "/services/graphql" not in url and not any(
                        p in url for p in ("/booking/api/", "/api/booking/", "/api/search/itinerary")
                    ):
                        return
                    ct = (resp.headers or {}).get("content-type", "") or ""
                    if "json" not in ct.lower() or resp.status != 200:
                        return
                    item = {"url": url, "status": resp.status, "content_type": ct}
                    try:
                        item["json"] = await resp.json()
                    except Exception:
                        return
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

            # Wait for the form (any input with originAirport or similar name).
            try:
                await page.wait_for_selector("input[name='originAirport']", timeout=15_000)
            except Exception:  # noqa: BLE001
                pass  # we'll dump page state anyway

            # DIAGNOSTIC: dump EVERY form, button (any visible), and link on
            # the loaded page so we can see what the actual search widget is.
            page_dump = await page.evaluate("""
                () => {
                    const inputs = Array.from(document.querySelectorAll('input,select')).slice(0,80).map(el => ({
                        tag: el.tagName.toLowerCase(), name: el.getAttribute('name'),
                        id: el.id, type: el.type || null, value: (el.value||'').slice(0,30),
                        aria: el.getAttribute('aria-label'), placeholder: el.placeholder,
                        visible: el.offsetParent !== null,
                    })).filter(x => x.name || x.id || x.aria || x.placeholder);
                    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]')).slice(0,40).map(el => ({
                        tag: el.tagName.toLowerCase(),
                        text: (el.innerText || el.value || '').slice(0,40).trim(),
                        type: el.type, id: el.id, name: el.getAttribute('name'),
                        aria: el.getAttribute('aria-label'),
                        data_test: el.getAttribute('data-testid') || el.getAttribute('data-test'),
                        visible: el.offsetParent !== null,
                    }));
                    const forms = Array.from(document.querySelectorAll('form')).slice(0,8).map(f => ({
                        id: f.id, name: f.getAttribute('name'),
                        action: f.action, method: f.method,
                        visible: f.offsetParent !== null,
                    }));
                    const has_react = !!window.React;
                    const has_submitSearch = typeof window.submitSearch === 'function';
                    return {inputs, buttons, forms, has_react, has_submitSearch};
                }
            """)
            print(f"AA: attempt {attempt} PAGE DUMP:", flush=True)
            print(f"AA:   forms: {json.dumps(page_dump.get('forms', []))[:600]}", flush=True)
            print(f"AA:   has_react={page_dump.get('has_react')} has_submitSearch={page_dump.get('has_submitSearch')}", flush=True)
            print(f"AA:   visible inputs: {json.dumps([i for i in page_dump.get('inputs', []) if i.get('visible')])[:1200]}", flush=True)
            print(f"AA:   visible buttons: {json.dumps([b for b in page_dump.get('buttons', []) if b.get('visible')])[:1200]}", flush=True)

            # Save the dump to the diag for /diag/aa_last
            try:
                LAST_RUN_DIAG.setdefault("page_dumps", []).append({"attempt": attempt, "dump": page_dump})
            except Exception:  # noqa: BLE001
                pass

            print(f"AA: attempt {attempt} form found, filling via real keystrokes…", flush=True)
            step_errors: list[dict] = []

            async def _step(name: str, coro_fn):
                """Run a fill step; log + record failure but don't abort."""
                try:
                    await coro_fn()
                    return True
                except Exception as exc:  # noqa: BLE001
                    err = {"step": name, "type": type(exc).__name__, "msg": str(exc)[:300]}
                    step_errors.append(err)
                    print(f"AA: attempt {attempt} step '{name}' FAILED: {err}", flush=True)
                    return False

            # 1. One-way radio (force=True bypasses overlap/visibility checks)
            await _step("click_oneway", lambda: page.click(
                "input[name='tripType'][value='oneWay']", timeout=8_000, force=True))
            # 2. Award checkbox
            await _step("check_redeem", lambda: page.check(
                "input[name='redeemMiles']", timeout=8_000, force=True))
            # 3. Origin — fill triggers input/change events
            await _step("fill_origin", lambda: page.fill(
                "input[name='originAirport']", origin, timeout=8_000, force=True))
            await asyncio.sleep(0.7)
            await page.keyboard.press("Tab")
            # 4. Destination
            await _step("fill_dest", lambda: page.fill(
                "input[name='destinationAirport']", dest, timeout=8_000, force=True))
            await asyncio.sleep(0.7)
            await page.keyboard.press("Tab")
            # 5. Departure date — use id selector since name has duplicates
            await _step("fill_date", lambda: page.fill(
                "input[id='aa-leavingOn']", _date_mmddyyyy(date), timeout=8_000, force=True))
            await page.keyboard.press("Tab")
            await asyncio.sleep(0.5)

            # 6. Submit
            submit_ok = await _step("click_submit", lambda: page.click(
                "input[type='submit'][id='flightSearchForm.button.reSubmit']",
                timeout=10_000, force=True))

            # Stash step errors in diag regardless of outcome
            try:
                LAST_RUN_DIAG.setdefault("step_errors", []).append({
                    "attempt": attempt, "errors": step_errors,
                })
            except Exception:  # noqa: BLE001
                pass

            if not submit_ok and step_errors:
                # If submit failed AND we had other failures, surface them
                return ("fill_failed", [])
            print(f"AA: attempt {attempt} fields filled ({len(step_errors)} step errors), submit clicked", flush=True)

            # Wait for the post-submit navigation, then watch for the title to
            # change away from 'Challenge Validation' (Akamai's interstitial on
            # the results page). During this wait, simulate human mouse + scroll
            # behavior — sensor.js scores sessions partly on movement, and a
            # session that LOOKS active is more likely to graduate to trusted.
            try:
                await page.wait_for_load_state("load", timeout=30_000)
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(2.0)

            import random
            for wait_round in range(24):  # 24 * 2.5s = 60s
                cur_title = await page.title()
                if "Challenge Validation" not in cur_title and "Access Denied" not in cur_title:
                    print(f"AA: attempt {attempt} challenge CLEARED at round {wait_round} (title={cur_title!r})", flush=True)
                    break
                if wait_round in (0, 6, 12, 18, 23):
                    print(f"AA: attempt {attempt} still on challenge (round {wait_round}, title={cur_title!r})", flush=True)
                # Random mouse movement
                try:
                    await page.mouse.move(random.randint(100, 1200), random.randint(100, 600), steps=5)
                except Exception:  # noqa: BLE001
                    pass
                # Slight scroll
                try:
                    await page.evaluate(f"window.scrollBy(0, {random.randint(-50, 50)})")
                except Exception:  # noqa: BLE001
                    pass
                await asyncio.sleep(2.5)

            print(f"AA: attempt {attempt} post-submit url={page.url} title={await page.title()!r}", flush=True)
            print(f"AA: attempt {attempt} captured {len(captured_xhrs)} graphql/booking JSON XHRs", flush=True)

            # Stash captured XHRs in module-level diag so /diag/aa_last can serve them
            attempt_diag = {
                "attempt": attempt,
                "post_submit_url": page.url,
                "post_submit_title": await page.title(),
                "xhrs": [],
            }
            for x in captured_xhrs:
                attempt_diag["xhrs"].append({
                    "url": x["url"],
                    "status": x["status"],
                    "content_type": x.get("content_type"),
                    "payload": x["json"],  # full payload — can be large
                })
            LAST_RUN_DIAG["attempts"].append(attempt_diag)

            # Look for a GraphQL response that contains actual flight data.
            # Heuristics: top-level data key isn't 'staticContent'/'loginInfo'
            # AND the payload contains slice/flight/itinerary text.
            for i, x in enumerate(captured_xhrs):
                payload = x["json"]
                if not isinstance(payload, dict):
                    continue
                # Old shape (just in case AA still serves it under some query)
                if payload.get("slices"):
                    parsed = _parse_xhr(payload, origin, dest, date)
                    if parsed:
                        return ("ok", parsed)
                # New shape: look for flight-y content in data
                data = payload.get("data") or {}
                data_keys = list(data.keys())
                if data_keys and not all(k in ("staticContent", "loginInfo") for k in data_keys):
                    # This is a NEW graphql query we haven't seen — could be
                    # the search response. Mark verdict so we can write a
                    # parser once we see the shape.
                    return ("new_graphql_unparsed", [])

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
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "origin": origin, "dest": dest, "date": date,
        "attempts": [],
    }
    print(f"AA: ===== search start {origin}->{dest} {date} =====", flush=True)
    verdicts = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        verdict, results = await _try_once(attempt, origin, dest, date)
        verdicts.append(verdict)
        if verdict == "ok":
            print(f"AA: attempt {attempt} SUCCESS ({len(results)} rows, prior={verdicts[:-1]})", flush=True)
            LAST_RUN_DIAG["verdicts"] = verdicts
            LAST_RUN_DIAG["row_count"] = len(results)
            return results
    print(f"AA: exhausted {MAX_ATTEMPTS} attempts, verdicts={verdicts}", flush=True)
    LAST_RUN_DIAG["verdicts"] = verdicts
    LAST_RUN_DIAG["row_count"] = 0
    return []


search = _scrape_real
