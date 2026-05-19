"""American AAdvantage award search plugin — BD Browser API + CapSolver BMP.

Path determined empirically over many attempts in session 5:
  - Direct API POST (WU or page.evaluate): blocked by AA app-layer (error 309)
  - Direct HTML page load (WU): blocked by Akamai (captcha/protection page)
  - BD Browser API alone: ~0% Akamai success now. Sensor.js executes but its
    INTERNAL bot detection (canvas/WebGL/timing) flags Patchright, leaves
    `_abck` cookie in CHALLENGED state, reload still 403s.

The actual industrial solution: CapSolver's AntiAkamaiBMPTask computes
valid sensor_data externally. We POST it to Akamai's sensor endpoint
(URL extracted from the deny page's <script src="...">), Akamai responds
with a VALIDATED `_abck` cookie, and the subsequent page load is allowed.
This is the same stack AwardWiz used before it was archived.

Flow:
  1. BD Browser API loads /booking/find-flights → gets 403 + sensor script URL
  2. Extract script URL from HTML via regex
  3. Call CapSolver createTask with website URL + UA
  4. Poll getTaskResult until ready (~10-30s typical)
  5. POST sensor_data to the script URL via page.evaluate (in the BD browser
     so cookies/network context match)
  6. Reload the page — cookie now in TRUSTED state, Akamai allows
  7. Drive the booking form to capture the real search XHR (this part still
     TBD until we have a successful page load to inspect)

Uses print(flush=True) for visibility (logging.* drops on this worker).
"""

from __future__ import annotations

import asyncio
import html as html_mod
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from common.browser import browser_page
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AA_AADVANTAGE"
PROGRAM_NAME = "AAdvantage"

SEARCH_PAGE = "https://www.aa.com/booking/find-flights"
LOYALTY_REFERER = "https://www.aa.com/loyalty/login"
MAX_ATTEMPTS = 5  # CapSolver costs $ per solve; few attempts is the right shape.

CAPSOLVER_CREATE = "https://api.capsolver.com/createTask"
CAPSOLVER_RESULT = "https://api.capsolver.com/getTaskResult"


async def _capsolver_solve_akamai(
    target_url: str,
    user_agent: str,
    api_key: str,
) -> str | None:
    """Submit AntiAkamaiBMTask to CapSolver and poll for the solution.
    Returns the sensor_data string, or None on failure/timeout."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        create = await client.post(CAPSOLVER_CREATE, json={
            "clientKey": api_key,
            "task": {
                "type": "AntiAkamaiBMTask",
                "url": target_url,
                "userAgent": user_agent,
            },
        })
        cdata = create.json()
        if cdata.get("errorId", 0) != 0:
            print(f"AA: CapSolver createTask failed: {cdata}", flush=True)
            return None
        task_id = cdata.get("taskId")
        if not task_id:
            print(f"AA: CapSolver createTask no taskId: {cdata}", flush=True)
            return None
        print(f"AA: CapSolver task created {task_id}, polling…", flush=True)

        for poll in range(30):
            await asyncio.sleep(2.0)
            r = await client.post(CAPSOLVER_RESULT, json={"clientKey": api_key, "taskId": task_id})
            rdata = r.json()
            status = rdata.get("status")
            if status == "ready":
                sol = rdata.get("solution") or {}
                sd = sol.get("sensorData") or sol.get("sensor_data") or sol.get("deviceData")
                print(f"AA: CapSolver returned sensor_data ({len(sd or '')} chars)", flush=True)
                return sd
            if rdata.get("errorId", 0) != 0:
                print(f"AA: CapSolver poll error: {rdata}", flush=True)
                return None
        print(f"AA: CapSolver timed out (60s polling)", flush=True)
        return None


def _extract_sensor_script_url(html: str) -> str | None:
    """Pull the Akamai sensor.js script URL out of a deny-page HTML body.
    Akamai randomizes the path on each request; we just need ONE script src
    that points to a same-origin obfuscated path."""
    # Decode HTML entities first (the dump showed &lt;script&gt;)
    decoded = html_mod.unescape(html)
    # Same-origin <script src="..."> with a deeply-nested obfuscated path
    m = re.search(r'<script[^>]+src="(/[A-Za-z0-9]{16,}/[A-Za-z0-9/]+\?[^"]+)"', decoded)
    if m:
        return m.group(1)
    return None


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

    # Empirical from session 5: sticky sessions (brightdata_session=X) pin
    # to a smaller subset of BD's pool and get 0% Akamai page-load success.
    # BD's DEFAULT rotation (no session_id) samples wider — T3 of the bypass
    # battery this morning hit a working IP that way. Try that path here:
    # no sticky session, no country override, just raw default rotation per
    # attempt. Each browser_page() call gets a fresh IP from BD's whole pool.
    for attempt in range(1, MAX_ATTEMPTS + 1):
        print(f"AA: attempt {attempt}/{MAX_ATTEMPTS} (default BD rotation)", flush=True)

        try:
            async with browser_page(
                timeout_ms=90_000,
                use_brightdata=True,
                # No brightdata_session — BD rotates randomly across pool.
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
                    # Akamai challenge. Patchright running sensor.js in-browser
                    # leaves the cookie in challenged state; we need CapSolver to
                    # compute valid sensor_data EXTERNALLY then POST it.
                    full_html = await page.content()
                    script_url = _extract_sensor_script_url(full_html)
                    print(f"AA: attempt {attempt} challenged; script_url={script_url!r}", flush=True)

                    capsolver_key = os.environ.get("CAPSOLVER_API_KEY")
                    if not capsolver_key:
                        print(f"AA: CAPSOLVER_API_KEY not set; skipping", flush=True)
                        continue
                    if not script_url:
                        print(f"AA: no script URL in deny page, can't solve", flush=True)
                        continue

                    # Pull the browser UA so CapSolver computes sensor_data that matches.
                    page_ua = await page.evaluate("() => navigator.userAgent")
                    sensor_data = await _capsolver_solve_akamai(SEARCH_PAGE, page_ua, capsolver_key)
                    if not sensor_data:
                        print(f"AA: attempt {attempt} CapSolver gave no sensor_data", flush=True)
                        continue

                    # POST sensor_data to Akamai's script endpoint from within the
                    # BD browser so cookies + Akamai's CDN-bound session match.
                    post_url = f"https://www.aa.com{script_url}"
                    post_result = await page.evaluate(
                        """
                        async ({ url, sensorData }) => {
                            try {
                                const r = await fetch(url, {
                                    method: 'POST',
                                    body: JSON.stringify({ sensor_data: sensorData }),
                                    headers: {'Content-Type': 'text/plain;charset=UTF-8'},
                                    credentials: 'include',
                                });
                                return { ok: true, status: r.status };
                            } catch (e) {
                                return { ok: false, error: String(e) };
                            }
                        }
                        """,
                        {"url": post_url, "sensorData": sensor_data},
                    )
                    print(f"AA: attempt {attempt} sensor POST result: {post_result}", flush=True)
                    await asyncio.sleep(1.5)

                    # Reload the page — _abck should now be in solved state.
                    try:
                        await page.goto(SEARCH_PAGE, wait_until="networkidle", referer=LOYALTY_REFERER, timeout=60_000)
                        await asyncio.sleep(2.5)
                    except Exception as exc:  # noqa: BLE001
                        print(f"AA: attempt {attempt} reload failed: {type(exc).__name__}: {str(exc)[:120]}", flush=True)
                        continue
                    title = await page.title()
                    cookies_after = len(await page.context.cookies())
                    print(f"AA: attempt {attempt} after CapSolver+reload title={title!r} cookies={cookies_after}", flush=True)
                    if "Access Denied" in title:
                        if attempt <= 2:
                            stuck = (await page.content())[:500]
                            print(f"AA:   still blocked html[:400]={stuck[:400]!r}", flush=True)
                        print(f"AA: attempt {attempt} PAGE_BLOCKED_after_capsolver", flush=True)
                        continue

                print(f"AA: attempt {attempt} PAGE_LOADED title={title!r}", flush=True)
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
