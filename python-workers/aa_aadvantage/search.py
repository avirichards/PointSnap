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
MAX_ATTEMPTS = 1  # debugging — single attempt for fast signal; bump to 3 once working

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


async def _search_via_curl_cffi(
    cookies: dict[str, str],
    user_agent: str,
    origin: str,
    dest: str,
    date: str,
    bd_proxy_url: str | None,
) -> tuple[str, dict | None]:
    """POST to AA's `/booking/api/search/itinerary` with curl_cffi using
    Firefox 135 TLS fingerprint (matches what Camoufox just minted in).

    Per Sekinal/aa_contest's cookie-replay pattern: the API gate validates
    cookies + TLS fingerprint. With valid `XSRF-TOKEN` + `spa_session_id`
    + Firefox 135 JA4, AA serves the response regardless of whether
    _abck has progressed past ~-1~ to ~0~ (the ~0~ requirement is for
    the SPA browser session, not the API itself).

    Returns (verdict, json_payload). Verdicts:
      ok | api_403 | api_html | api_no_json | api_no_slices | curl_err
    """
    from curl_cffi.requests import AsyncSession

    payload = {
        "metadata": {"selectedProducts": [], "tripType": "OneWay", "udo": {}},
        "passengers": [{"type": "adult", "count": 1}],
        "requestHeader": {"clientId": "AAcom"},
        "slices": [{
            "allCarriers": True, "cabin": "", "connectionCity": None,
            "departureDate": date, "destination": dest,
            "destinationNearbyAirports": False, "maxStops": None,
            "origin": origin, "originNearbyAirports": False,
        }],
        "tripOptions": {
            "corporateBooking": False, "fareType": "Lowest",
            "locale": "en_US", "pointOfSale": "", "searchType": "Award",
        },
        "loyaltyInfo": None,
        "version": "",
        "queryParams": {"sliceIndex": 0, "sessionId": "", "solutionSet": "",
                        "solutionId": "", "sort": "CARRIER"},
    }
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.5",
        "Content-Type": "application/json",
        "Referer": "https://www.aa.com/",
        "Origin": "https://www.aa.com",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }
    # AA-required header injection from cookies (Sekinal pattern)
    if cookies.get("XSRF-TOKEN"):
        headers["X-XSRF-TOKEN"] = cookies["XSRF-TOKEN"]
    if cookies.get("spa_session_id"):
        headers["X-CID"] = cookies["spa_session_id"]

    try:
        async with AsyncSession(impersonate="firefox135") as s:
            r = await s.post(
                "https://www.aa.com/booking/api/search/itinerary",
                json=payload,
                headers=headers,
                cookies=cookies,
                proxy=bd_proxy_url,
                verify=False,  # BD MITMs HTTPS by default
                timeout=30,
            )
    except Exception as exc:  # noqa: BLE001
        return (f"curl_err:{type(exc).__name__}", None)

    if r.status_code == 403:
        return ("api_403", None)
    ct = r.headers.get("content-type", "").lower()
    if "html" in ct:
        return ("api_html", None)
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        return ("api_no_json", None)
    if not isinstance(body, dict) or not body.get("slices"):
        return ("api_no_slices", body if isinstance(body, dict) else None)
    return ("ok", body)


def _build_bd_proxy_url(session_id: str) -> str | None:
    """Assemble a BD Residential proxy URL string (`http://user:pass@host:port`)
    with the same session_id used by Camoufox, so curl_cffi exits through the
    same residential IP that minted the cookies.

    Without IP consistency Akamai may invalidate the session on first
    cookie replay.
    """
    import os as _os
    from urllib.parse import urlparse as _urlp

    raw = _os.environ.get("BRIGHTDATA_RESIDENTIAL_URL")
    if not raw:
        return None
    p = _urlp(raw)
    username = p.username or ""
    if session_id and "-session-" not in username:
        username = f"{username}-session-{session_id}"
    if "-country-" not in username:
        username = f"{username}-country-us"
    return f"http://{username}:{p.password}@{p.hostname}:{p.port}"


async def _try_once(attempt: int, origin: str, dest: str, date: str) -> tuple[str, list[NormalizedResult]]:
    """One attempt at AA award search via Sekinal's cookie-mint + curl_cffi
    replay pattern.

    Steps:
      1. Camoufox + BD Residential loads aa.com homepage (NOT the deep-link —
         deep-link triggers a visible Akamai challenge interstitial).
      2. Wait up to 60s for AA's critical cookies (XSRF-TOKEN, spa_session_id)
         to be minted by the SPA's bootstrap script.
      3. Export cookies + user-agent from the Camoufox session.
      4. Hand off to curl_cffi (Firefox 135 TLS impersonation) which POSTs to
         /booking/api/search/itinerary through the SAME BD residential session
         (IP consistency matters — Akamai invalidates sessions that swap IPs).
      5. Parse response via _parse_xhr (payload shape unchanged).

    Returns (verdict, results). Verdicts:
      ok | nav_failed | page_blocked | no_cookies | <curl_cffi verdicts>
      | no_results | crash
    """
    import time as _time

    session_id = f"aa_{int(_time.time())}_{attempt}"
    bd_proxy_url = _build_bd_proxy_url(session_id)
    if not bd_proxy_url:
        return ("crash", [])

    try:
        async with browser_page(
            timeout_ms=120_000,
            use_camoufox=True,
            use_brightdata_residential=True,
            brightdata_country="us",
            brightdata_session=session_id,
        ) as page:
            # Step 1: load homepage (works cleanly from BD residential per
            # earlier smoke tests; no visible Akamai challenge on this path)
            print(f"AA: attempt {attempt} homepage → {ENTRY_URL}", flush=True)
            try:
                await page.goto(ENTRY_URL, wait_until="domcontentloaded", timeout=60_000)
            except Exception as exc:  # noqa: BLE001
                err_str = f"{type(exc).__name__}: {str(exc)[:300]}"
                print(f"AA: attempt {attempt} homepage goto failed: {err_str}", flush=True)
                LAST_RUN_DIAG["attempts"].append({
                    "attempt": attempt, "stage": "homepage_goto", "error": err_str,
                })
                return ("nav_failed", [])

            # Quick check for hard block / Access Denied
            try:
                home_title = await asyncio.wait_for(page.title(), timeout=5.0)
            except Exception:  # noqa: BLE001
                home_title = ""
            if "Access Denied" in home_title:
                print(f"AA: attempt {attempt} homepage hard-blocked (title={home_title!r})", flush=True)
                return ("page_blocked", [])

            # Step 2: wait up to 60s for AA-required cookies to mint
            cookies_dict: dict[str, str] = {}
            user_agent: str = ""
            cookies_ready = False
            t_start = asyncio.get_event_loop().time()
            last_log = 0.0
            for _wait_round in range(60):
                elapsed = asyncio.get_event_loop().time() - t_start
                if elapsed > 60:
                    break
                try:
                    cks = await asyncio.wait_for(page.context.cookies(), timeout=2.0)
                    cookies_dict = {c["name"]: c["value"] for c in cks}
                except Exception:  # noqa: BLE001
                    cookies_dict = {}
                if "XSRF-TOKEN" in cookies_dict and "spa_session_id" in cookies_dict:
                    cookies_ready = True
                    break
                if elapsed - last_log >= 10.0:
                    last_log = elapsed
                    abck = cookies_dict.get("_abck", "")
                    print(
                        f"AA: attempt {attempt} +{int(elapsed)}s "
                        f"cookies={len(cookies_dict)} xsrf={'XSRF-TOKEN' in cookies_dict} "
                        f"spa_sid={'spa_session_id' in cookies_dict} _abck[:40]={abck[:40]!r}",
                        flush=True,
                    )
                await asyncio.sleep(1.5)

            # Get user-agent from Camoufox
            try:
                user_agent = await asyncio.wait_for(
                    page.evaluate("navigator.userAgent"), timeout=3.0,
                )
            except Exception:  # noqa: BLE001
                user_agent = "Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0"

            # Capture final cookie state for diag (before potential API failure)
            abck_final = cookies_dict.get("_abck", "")
            attempt_diag = {
                "attempt": attempt,
                "stage": "post_cookie_mint",
                "cookies_count": len(cookies_dict),
                "cookies_ready": cookies_ready,
                "abck": abck_final[:80],
                "abck_trusted": "~0~" in abck_final,
                "has_xsrf": "XSRF-TOKEN" in cookies_dict,
                "has_spa_sid": "spa_session_id" in cookies_dict,
                "user_agent": user_agent[:120],
            }

            if not cookies_ready:
                print(f"AA: attempt {attempt} required cookies never minted in 60s", flush=True)
                LAST_RUN_DIAG["attempts"].append(attempt_diag)
                return ("no_cookies", [])

            print(
                f"AA: attempt {attempt} cookies ready in {int(asyncio.get_event_loop().time() - t_start)}s "
                f"({len(cookies_dict)} cookies, _abck_trusted={'~0~' in abck_final})",
                flush=True,
            )

        # Camoufox session closed; now hand off to curl_cffi (outside the
        # `async with` so the proxy connection is fresh — avoids cert state
        # contamination from the browser's TLS session).
        print(f"AA: attempt {attempt} curl_cffi POST → /booking/api/search/itinerary", flush=True)
        verdict, body = await _search_via_curl_cffi(
            cookies=cookies_dict,
            user_agent=user_agent,
            origin=origin,
            dest=dest,
            date=date,
            bd_proxy_url=bd_proxy_url,
        )
        attempt_diag["curl_verdict"] = verdict
        attempt_diag["api_has_slices"] = bool(body and body.get("slices"))
        LAST_RUN_DIAG["attempts"].append(attempt_diag)

        if verdict != "ok" or not body:
            print(f"AA: attempt {attempt} curl_cffi verdict={verdict}", flush=True)
            return (verdict, [])

        parsed = _parse_xhr(body, origin, dest, date)
        if not parsed:
            return ("no_results", [])
        return ("ok", parsed)

    except Exception as exc:  # noqa: BLE001
        err_str = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"AA: attempt {attempt} crash: {err_str}", flush=True)
        try:
            LAST_RUN_DIAG["attempts"].append({
                "attempt": attempt, "stage": "outer_crash", "error": err_str,
            })
        except Exception:  # noqa: BLE001
            pass
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
