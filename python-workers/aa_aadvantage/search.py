"""American AAdvantage award search plugin — Sekinal/aa_contest pattern.

Phase 0 (2026-05-19) confirmed the original mobile.aa.com form-fill approach
fails because the post-form Akamai "Challenge Validation" interstitial doesn't
clear from Fly egress. The canonical 2026 bypass (per Sekinal/aa_contest +
asadfix/scraping-guide) is a "deep-link + XHR capture" flow:

Flow:
  1. Camoufox loads aa.com homepage (sensor.js fires; _abck cookie minted).
  2. Optionally accept cookie banner.
  3. Navigate to /booking/search?slices=[...]&searchType=Award&... deep-link.
     AA's SPA auto-fires POST /booking/api/search/itinerary.
  4. page.on("response") captures the JSON XHR.
  5. Parse via _parse_xhr (same parser as before; payload shape unchanged).

No proxy needed (Sekinal proves Fly egress works for AA). No captcha solver.
Cookie validity ~30min. IP block cooldown ~40min after detection.

Per Agent 1's Phase 0 deep-dive on Sekinal (commit Nov 7 2025, MIT-licensed):
  - Camoufox kwargs: headless=virtual, humanize=True, block_webrtc=True,
    geoip=True, window=(1366,768). (browser_page() already sets these.)
  - Critical AA cookies after warm-up: XSRF-TOKEN, spa_session_id.
  - Header injection on API calls (if doing curl_cffi replay): X-XSRF-TOKEN,
    X-CID derived from those cookies. NOT NEEDED for in-page XHR capture.
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

ENTRY_URL = "https://www.aa.com/"  # direct homepage, avoids mobile->www redirect chain
MAX_ATTEMPTS = 3  # Sekinal pattern retries up to 3x on transient Akamai blocks

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
    """One attempt at AA award search via the Sekinal/aa_contest pattern.

    Steps:
      1. Camoufox warms up on aa.com homepage (sensor.js fires; _abck minted).
      2. Optionally dismiss cookie banner.
      3. Navigate to /booking/search?slices=[...]&searchType=Award deep-link.
         AA's SPA auto-fires POST /booking/api/search/itinerary on load.
      4. Capture the XHR JSON via page.on("response").
      5. Parse via _parse_xhr (payload shape unchanged from old form-fill flow).

    Returns (verdict, results). Verdicts:
      ok | nav_failed | page_blocked | xhr_timeout | xhr_no_slices |
      no_results | crash
    """
    import random as _rand
    import time as _time
    import urllib.parse as _urlparse

    try:
        # Phase 1 smoke (2026-05-19) proved Fly egress is Akamai-flagged for
        # AA: _abck stays at ~-1~ (untrusted) for the full 90s wait, so AA's
        # SPA never fires the search API. Switching to BD Residential
        # (country=US, sticky session) to get a clean residential IP that
        # Akamai's sensor.js can score to trusted ~0~. ignore_https_errors
        # is required because BD MITMs HTTPS by default.
        async with browser_page(
            timeout_ms=120_000,
            use_camoufox=True,
            use_brightdata_residential=True,
            brightdata_country="us",
            brightdata_session=f"aa_{int(_time.time())}_{attempt}",
        ) as page:
            captured_xhrs: list[dict] = []

            async def _on_response(resp):
                try:
                    if "/booking/api/search/itinerary" not in resp.url:
                        return
                    ct = (resp.headers or {}).get("content-type", "") or ""
                    if "json" not in ct.lower() or resp.status != 200:
                        return
                    item = {"url": resp.url, "status": resp.status}
                    try:
                        item["json"] = await resp.json()
                    except Exception:
                        return
                    captured_xhrs.append(item)
                except Exception:  # noqa: BLE001
                    pass
            page.on("response", _on_response)

            # Step 1: warm-up on homepage so sensor.js fires
            print(f"AA: attempt {attempt} warm-up → {ENTRY_URL}", flush=True)
            try:
                await page.goto(ENTRY_URL, wait_until="domcontentloaded", timeout=60_000)
            except Exception as exc:  # noqa: BLE001
                print(f"AA: attempt {attempt} homepage goto failed: {exc!r}", flush=True)
                return ("nav_failed", [])
            await asyncio.sleep(2.0)

            # Step 2: dismiss cookie banner if present (Sekinal step)
            for sel in (
                "#accept-recommended-btn-handler",
                "#onetrust-accept-btn-handler",
                'button:has-text("Accept all")',
                'button:has-text("Accept All")',
            ):
                try:
                    btn = await page.wait_for_selector(sel, timeout=2_000, state="visible")
                    if btn:
                        await btn.click()
                        await asyncio.sleep(1.0)
                        break
                except Exception:  # noqa: BLE001
                    continue

            # Quick check for hard block on homepage
            try:
                home_title = await asyncio.wait_for(page.title(), timeout=5.0)
            except Exception:  # noqa: BLE001
                home_title = ""
            if "Access Denied" in home_title:
                print(f"AA: attempt {attempt} homepage hard-blocked (title={home_title!r})", flush=True)
                return ("page_blocked", [])

            # Step 3: build deep-link with slices and navigate
            slices_json = json.dumps(
                [{"orig": origin, "origNearby": False,
                  "dest": dest, "destNearby": False,
                  "date": date}],
                separators=(",", ":"),
            )
            search_url = (
                "https://www.aa.com/booking/search?"
                "locale=en_US&fareType=Lowest&pax=1&adult=1&type=OneWay&"
                "searchType=Award&cabin=&carriers=ALL&travelType=personal&"
                f"slices={_urlparse.quote(slices_json)}"
            )
            print(f"AA: attempt {attempt} deep-link → /booking/search?…&slices={slices_json}", flush=True)

            try:
                await page.goto(search_url, wait_until="domcontentloaded", timeout=60_000)
            except Exception as exc:  # noqa: BLE001
                print(f"AA: attempt {attempt} deep-link goto failed: {exc!r}", flush=True)
                return ("nav_failed", [])

            # Check for hard block on search page
            try:
                title = await asyncio.wait_for(page.title(), timeout=5.0)
            except Exception:  # noqa: BLE001
                title = ""
            try:
                body_preview = (await asyncio.wait_for(
                    page.locator("body").inner_text(), timeout=5.0))[:400]
            except Exception:  # noqa: BLE001
                body_preview = ""
            if "Access Denied" in title or "Access Denied" in body_preview:
                print(f"AA: attempt {attempt} search page hard-blocked (title={title!r})", flush=True)
                return ("page_blocked", [])

            # Step 4: wait up to 90s for the itinerary XHR with humanized motion
            # and Akamai _abck cookie monitoring (per Sekinal's 90s wait_for_function).
            # Sensor.js scoring can take 30-60s; SPA fires the API only after
            # _abck reaches the trusted "~0~" state.
            t_start = asyncio.get_event_loop().time()
            last_abck_log = 0.0
            for _wait_round in range(90):
                if captured_xhrs:
                    break
                elapsed = asyncio.get_event_loop().time() - t_start
                if elapsed > 90:
                    break
                # Light motion to feed sensor.js (per Sekinal pattern)
                try:
                    await asyncio.wait_for(
                        page.mouse.move(
                            _rand.randint(200, 1100), _rand.randint(150, 550), steps=3,
                        ),
                        timeout=2.0,
                    )
                except Exception:  # noqa: BLE001
                    pass
                # Log _abck state every 10s for diag visibility
                if elapsed - last_abck_log >= 10.0:
                    last_abck_log = elapsed
                    try:
                        cks = await asyncio.wait_for(page.context.cookies(), timeout=2.0)
                        abck = next((c.get("value", "") for c in cks if c.get("name") == "_abck"), "")
                        trusted = "~0~" in abck
                        title_now = await asyncio.wait_for(page.title(), timeout=2.0)
                        print(
                            f"AA: attempt {attempt} +{int(elapsed)}s "
                            f"title={title_now!r} _abck_trusted={trusted} "
                            f"abck[:40]={abck[:40]!r} xhrs={len(captured_xhrs)}",
                            flush=True,
                        )
                    except Exception:  # noqa: BLE001
                        pass
                await asyncio.sleep(1.0)

            # Final scroll nudge if still empty (Sekinal pattern step 4)
            if not captured_xhrs:
                try:
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(5.0)
                except Exception:  # noqa: BLE001
                    pass

            # Stash diag (always, even on empty result)
            try:
                title_now = await asyncio.wait_for(page.title(), timeout=3.0)
            except Exception:  # noqa: BLE001
                title_now = ""
            html_len = 0
            try:
                html_len = len(await asyncio.wait_for(page.content(), timeout=3.0))
            except Exception:  # noqa: BLE001
                pass
            # On XHR timeout, capture page HTML + cookies for triage
            html_preview = ""
            abck_final = ""
            cookies_count = 0
            if not captured_xhrs:
                try:
                    html_full = await asyncio.wait_for(page.content(), timeout=5.0)
                    html_preview = html_full[:2000]
                except Exception:  # noqa: BLE001
                    pass
                try:
                    cks = await asyncio.wait_for(page.context.cookies(), timeout=3.0)
                    cookies_count = len(cks)
                    abck_final = next((c.get("value", "") for c in cks if c.get("name") == "_abck"), "")
                except Exception:  # noqa: BLE001
                    pass

            attempt_diag = {
                "attempt": attempt,
                "deep_link_url": search_url[:500],
                "final_url": page.url,
                "title": title_now,
                "html_len": html_len,
                "html_preview": html_preview,
                "cookies_count": cookies_count,
                "abck": abck_final[:80],
                "abck_trusted": "~0~" in abck_final,
                "xhrs_seen": len(captured_xhrs),
                "xhrs": [{"url": x["url"], "status": x["status"],
                          "has_slices": isinstance(x.get("json"), dict) and bool(x["json"].get("slices"))}
                         for x in captured_xhrs],
            }
            LAST_RUN_DIAG["attempts"].append(attempt_diag)

            print(f"AA: attempt {attempt} captured {len(captured_xhrs)} itinerary XHRs", flush=True)

            if not captured_xhrs:
                return ("xhr_timeout", [])

            # Step 5: parse the first XHR that has a slices array
            for x in captured_xhrs:
                payload = x.get("json")
                if not isinstance(payload, dict):
                    continue
                if payload.get("slices"):
                    parsed = _parse_xhr(payload, origin, dest, date)
                    if parsed:
                        return ("ok", parsed)
                    return ("no_results", [])

            return ("xhr_no_slices", [])

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
