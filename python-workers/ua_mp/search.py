"""United MileagePlus award search plugin — Bright Data Web Unlocker transport.

Phase-1 transport rewrite (2026-05-20). The prior transport (Patchright +
BD Browser API) is Akamai-flagged for united.com, so the search silently
returned `[]`. This module replaces it with a **WU 3-step** pattern:

  Step 1 — mint an Akamai session:
      WU-GET united.com's `choose-flights` SPA deep-link. WU renders the
      page (solving Akamai BMP), and the returned Set-Cookie jar carries
      United's Akamai cookies (`_abck`, `bm_ss`, `bm_mi`, `bm_s`, `bm_so`,
      `bm_sz`, `akacd_*`) plus `Session`/`Locale`.

  Step 2 — mint an anonymous bearer token:
      WU-GET `https://www.united.com/api/token/anonymous`. United exposes
      anonymous bearer tokens here (`data.token.hash`); the award API
      `/api/flight/FetchFlights` requires `x-authorization-api: bearer
      {token}`. This GET is confirmed WU-clean (verified via `/diag/wu_probe`
      2026-05-20 — returns 200 + a real token + the Akamai jar).

  Step 3 — call the award API:
      WU-POST `https://www.united.com/api/flight/FetchFlights` with the
      bearer token + the minted cookie jar forwarded as a `Cookie:` header.

=============================================================================
INVESTIGATION FINDINGS (2026-05-20, all via `/diag/wu_probe`, format=json):

  * `GET /api/token/anonymous`  → 200, real token, full Akamai jar. WU-clean.
  * `POST /api/token/anonymous` → 200, real token. WU-clean (proves WU's
    `bad_endpoint` block below is PATH-specific, not POST-method-wide).
  * `GET choose-flights?f=...&t=...&d=...` → 200, 75 KB SPA shell + Akamai
    jar. NOTE: a nonsense route (`ZZZ→QQQ`) returns a byte-identical 75 KB
    body — WU's `format=json` GET returns the *un-hydrated Angular shell*,
    it does NOT wait for the SPA's own FetchFlights XHR. So an "in-page
    render" (Pattern B) won't surface award rows through WU's HTTP API.
  * `POST /api/flight/FetchFlights` via WU `format=json` → BD error
    `ub_bad_endpoint_robots`: "Requested site is not available for
    immediate access mode ... Ask your account manager to get full
    access." United's robots.txt does NOT disallow `/api/flight/*`
    (verified — robots.txt is 4 KB of old `.aspx` paths only), so this is
    BD's WU access-mode heuristic flagging that specific path, NOT a real
    robots rule and NOT an Akamai block.

  Therefore: the `format=json` (full unlocker engine) transport is blocked
  for the FetchFlights POST by a BD WU zone limitation. The plugin tries
  `format=json` first (definitive) then `format=raw` (`wu_post`, the proxy
  pass-through transport) — `raw` is the one transport not yet probed for
  this path, and the DL proof airline (Session 12) confirmed `wu_post` raw
  can POST successfully (to httpbin). If raw ALSO hits `bad_endpoint`, the
  fix is a BD-side zone setting (enable "full access mode" for united.com),
  not a code change — `LAST_RUN_DIAG` records enough to prove that.

  UA is NOT auth_required: the token flow is fully anonymous, there is no
  login wall on the award API itself. The blocker, if `raw` also fails, is
  purely the BD WU zone access tier.
=============================================================================

Body shape per gaukas Go gist (verified 2024) + awardwiz scrapers:
  - PaxInfoList (not Passengers), CabinPreferenceMain (not CabinPreference)
  - SortType lowercase "bestmatches", SearchRadius* are string "-1"
  - Requires TripIndex, Characteristics, CalendarFilters, NGRP, FareType

Defensive contract: `search()` never raises — every failure path returns
`[]` and records a verdict in `LAST_RUN_DIAG`.

No new env vars beyond `BRIGHTDATA_WU_TOKEN` / `BRIGHTDATA_WU_ZONE`
(both read by `common/bd_wu.py`).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from common.bd_wu import (
    cookies_to_header,
    wu_get,
    wu_mint_cookies,
    wu_post,
    wu_request_json,
)
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "UA_MP"
PROGRAM_NAME = "United MileagePlus"

# Deep-link into the choose-flights SPA — rendering this mints the Akamai
# cookie jar. The query params are cosmetic for the mint (WU returns the
# un-hydrated shell either way) but kept realistic so the request looks
# like a genuine booking navigation.
SEARCH_PAGE_TMPL = (
    "https://www.united.com/en/us/fsr/choose-flights"
    "?f={origin}&t={dest}&d={date}&tt=1&at=1&sc=7&px=1&taxng=1"
    "&newHP=True&clm=7&st=bestmatches&tqp=A"
)
TOKEN_URL = "https://www.united.com/api/token/anonymous"
FETCH_FLIGHTS_URL = "https://www.united.com/api/flight/FetchFlights"

# Module-level diagnostic state — last scrape's mint diag + token + API
# response. Forensic-detail by design (CLAUDE.md scraper log discipline).
LAST_RUN_DIAG: dict[str, Any] = {"attempts": []}


def _united_cabin(cabin_filter: str) -> str:
    return {
        "Y": "economy",
        "W": "premiumeconomy",
        "J": "business",
        "F": "first",
    }.get(cabin_filter, "economy")


def _build_body(origin: str, dest: str, date: str, pax: int, cabin: str) -> dict[str, Any]:
    """Construct the FetchFlights award-search body.

    Shape per the gaukas Go gist (2024) + lg/awardwiz united.ts. United's
    API is picky about exact key names — `PaxInfoList`, `CabinPreferenceMain`,
    string `"-1"` search radii, lowercase `bestmatches`.
    """
    return {
        "SearchTypeSelection": 1,
        "SortType": "bestmatches",
        "SortTypeDescending": False,
        "Trips": [
            {
                "Origin": origin,
                "Destination": dest,
                "DepartDate": date,
                "Index": 1,
                "TripIndex": 1,
                "SearchRadiusMilesOrigin": "-1",
                "SearchRadiusMilesDestination": "-1",
                "DepartTimeApprox": 0,
                "SearchFiltersIn": {
                    "FareFamily": "ECONOMY",
                    "AirportsStop": None,
                    "AirportsStopToAvoid": None,
                    "StopCountMax": 0,
                    "StopCountMin": -1,
                },
                "UseFilters": True,
                "NonStopMarket": False,
            }
        ],
        "CabinPreferenceMain": cabin,
        "PaxInfoList": [{"PaxType": 1} for _ in range(pax)],
        "AwardTravel": True,
        "NGRP": False,
        "CalendarLengthOfStay": 0,
        "PetCount": 0,
        "CalendarFilters": {"Filters": {"PriceScheduleOptions": {"Stops": 1}}},
        "Characteristics": [
            {"Code": "SOFT_LOGGED_IN", "Value": False},
            {"Code": "UsePassedCartId", "Value": False},
        ],
        "FareType": "Award",
    }


def _normalize_product_cabin(s: str) -> str | None:
    s = (s or "").lower()
    if "polaris" in s or "business" in s:
        return "J"
    if "first" in s:
        return "F"
    if "premium" in s and ("plus" in s or "economy" in s):
        return "W"
    if "economy" in s:
        return "Y"
    return None


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse FetchFlights' award response into NormalizedResult[].

    United returns `{"data":{"Trips":[{"Flights":[...]}]}}`. Each flight's
    `Connections[]` are the legs; `Products[]` carries per-cabin miles +
    taxes. Robust to missing keys — any flight that fails to parse is
    skipped, not fatal.
    """
    results: list[NormalizedResult] = []
    trips = (payload.get("data") or {}).get("Trips") or []
    if not trips:
        return results

    flights = trips[0].get("Flights") or []
    for flight in flights[:6]:
        try:
            segments_raw = flight.get("Connections") or [flight]
            segments: list[ResultSegment] = []
            for i, seg in enumerate(segments_raw):
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=(
                            seg.get("OperatingCarrier") or seg.get("MarketingCarrier") or "UA"
                        ),
                        marketing_airline_iata=seg.get("MarketingCarrier") or "UA",
                        flight_number=str(seg.get("FlightNumber") or ""),
                        origin_iata=seg.get("Origin") or origin,
                        dest_iata=seg.get("Destination") or dest,
                        depart_at=seg.get("DepartDateTime") or f"{date}T00:00:00Z",
                        arrive_at=seg.get("DestinationDateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=(
                            seg.get("EquipmentDisclosures", {}).get("EquipmentType")
                            if isinstance(seg.get("EquipmentDisclosures"), dict) else None
                        ),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            for product in flight.get("Products") or []:
                cabin = _normalize_product_cabin(
                    product.get("Description") or product.get("ProductTypeDescription") or ""
                )
                if not cabin:
                    continue
                prices = product.get("Prices") or [{}]
                miles = prices[0].get("Amount") if prices else 0
                taxes = prices[1].get("Amount") if len(prices) > 1 else 0
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin,  # type: ignore[arg-type]
                        seats_remaining=int(product.get("BookingCount") or 0),
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=0,
                        taxes_usd_per_pax=int(round(float(taxes or 0))),
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
                    total_duration_min=int(flight.get("TravelMinutes") or 0),
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=78,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("UA flight parse error: %s", exc)
            continue

    return results


def _api_headers(token: str, cookies: dict[str, str]) -> dict[str, str]:
    """Browser-shaped headers for the FetchFlights POST.

    `x-authorization-api: bearer {token}` is United's required auth header
    for the award API. The Akamai cookie jar is forwarded as a `Cookie:`
    header; Origin / Referer / Sec-Fetch-* mirror what the choose-flights
    SPA sends so Akamai treats the request as same-origin XHR.
    """
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        "x-authorization-api": f"bearer {token}",
        "Origin": "https://www.united.com",
        "Referer": "https://www.united.com/en/us/fsr/choose-flights",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Cookie": cookies_to_header(cookies),
    }


async def _mint_token(cookies: dict[str, str]) -> tuple[str | None, dict[str, Any]]:
    """WU-GET `/api/token/anonymous` and extract `data.token.hash`.

    Forwards the Akamai cookie jar minted in step 1 so the token GET looks
    like a same-session request. Returns `(token_or_None, diag)`.
    """
    diag: dict[str, Any] = {"stage": "token_mint", "endpoint": TOKEN_URL}
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.united.com/en/us/fsr/choose-flights",
        "Cookie": cookies_to_header(cookies),
    }
    try:
        status, raw = await wu_get(TOKEN_URL, headers=headers, timeout_s=90.0)
    except httpx.HTTPError as exc:
        diag["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        return None, diag
    except Exception as exc:  # noqa: BLE001
        diag["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        return None, diag

    diag["wu_status"] = status
    diag["body_len"] = len(raw)
    diag["body_head"] = raw[:300]
    token: str | None = None
    try:
        parsed = json.loads(raw)
        token = ((parsed.get("data") or {}).get("token") or {}).get("hash")
    except Exception:  # noqa: BLE001 — body not JSON (BD error / HTML)
        token = None
    diag["token_obtained"] = bool(token)
    return token, diag


async def _call_award_api(
    transport: str,
    body: dict[str, Any],
    headers: dict[str, str],
    origin: str,
    dest: str,
    date: str,
) -> tuple[list[NormalizedResult], str]:
    """One WU POST to FetchFlights, via either WU `format` transport.

    `transport` is "json" (`wu_request_json`, full unlocker engine — known
    to hit `ub_bad_endpoint_robots` for this path) or "raw" (`wu_post`,
    proxy pass-through — the untested transport). Appends a forensic
    `attempts[]` entry. Returns `(rows, verdict)`; verdict is one of:
      ok | no_results | no_trips | api_non_json | api_error
      | http_error | crash
    """
    attempt: dict[str, Any] = {
        "stage": "award_post",
        "transport": f"format_{transport}",
        "endpoint": FETCH_FLIGHTS_URL,
        "payload_keys": sorted(body.keys()),
    }

    status: int = 0
    parsed: dict[str, Any] | None = None
    raw_text: str = ""
    try:
        if transport == "json":
            status, envelope = await wu_request_json(
                FETCH_FLIGHTS_URL, method="POST", body=body, headers=headers, timeout_s=120.0
            )
            attempt["wu_http_status"] = status
            if isinstance(envelope, dict):
                attempt["target_status"] = (
                    envelope.get("status_code") or envelope.get("status")
                )
                env_hdrs = envelope.get("headers") or envelope.get("response_headers") or {}
                if isinstance(env_hdrs, dict):
                    attempt["x_brd_error"] = (
                        env_hdrs.get("x-brd-error") or env_hdrs.get("X-Brd-Error")
                    )
                    attempt["x_brd_error_code"] = (
                        env_hdrs.get("x-brd-error-code") or env_hdrs.get("X-Brd-Error-Code")
                    )
                env_body = envelope.get("body")
                if isinstance(env_body, str):
                    raw_text = env_body
                    try:
                        loaded = httpx.Response(200, text=env_body).json()
                        parsed = loaded if isinstance(loaded, dict) else None
                    except Exception:  # noqa: BLE001 — body not JSON
                        parsed = None
                tstat = attempt.get("target_status")
                if isinstance(tstat, int):
                    status = tstat
                elif isinstance(tstat, str) and tstat.isdigit():
                    status = int(tstat)
            else:
                attempt["envelope"] = "non-JSON WU response"
        else:  # raw
            status, parsed, raw_text = await wu_post(
                FETCH_FLIGHTS_URL, body=body, headers=headers, timeout_s=90.0
            )
            attempt["wu_status"] = status
    except httpx.HTTPError as exc:
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"UA: award POST ({transport}) httpx error: {err}", flush=True)
        attempt["error"] = err
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "http_error"
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"UA: award POST ({transport}) crash: {err}", flush=True)
        attempt["error"] = err
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "crash"

    attempt["effective_status"] = status
    attempt["raw_text_len"] = len(raw_text)
    attempt["raw_text_head"] = raw_text[:600]
    attempt["json_parsed"] = parsed is not None
    if parsed is not None:
        attempt["json_keys"] = sorted(parsed.keys())[:30]
        trips = (parsed.get("data") or {}).get("Trips") or []
        attempt["trip_count"] = len(trips)
        attempt["flight_count"] = len(trips[0].get("Flights") or []) if trips else 0

    print(
        f"UA: award POST ({transport}) → status={status} len={len(raw_text)} "
        f"parsed={parsed is not None} flights={attempt.get('flight_count', 0)}",
        flush=True,
    )

    if status and status != 200:
        attempt["verdict"] = "api_error"
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "api_error"
    if parsed is None:
        attempt["verdict"] = "api_non_json"
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "api_non_json"
    if not (parsed.get("data") or {}).get("Trips"):
        attempt["verdict"] = "no_trips"
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "no_trips"

    results = _parse(parsed, origin, dest, date)
    attempt["row_count"] = len(results)
    if not results:
        attempt["verdict"] = "no_results"
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "no_results"

    attempt["verdict"] = "ok"
    LAST_RUN_DIAG["attempts"].append(attempt)
    return results, "ok"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """Search United MileagePlus awards via the Bright Data Web Unlocker.

    Verdict codes recorded in `LAST_RUN_DIAG["last_verdict"]`:
      ok            — a WU POST returned 200 with parseable award rows
      no_results    — WU POST returned 200 + JSON but 0 rows parsed
      no_trips      — WU POST returned 200 + JSON but no data.Trips
      api_non_json  — WU POST returned 200 but body is not JSON
      api_error     — WU POST returned non-200 (e.g. bad_endpoint_robots)
      no_token      — `/api/token/anonymous` did not yield a token
      no_cookies    — choose-flights mint returned an empty cookie jar
      http_error    — network/timeout error reaching api.brightdata.com
      crash         — unhandled exception (programmer error)
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "bd_web_unlocker_3step",
        "origin": origin,
        "dest": dest,
        "date": date,
        "endpoint": FETCH_FLIGHTS_URL,
        "attempts": [],
    }
    print(f"UA: ===== search start {origin}->{dest} {date} via WU =====", flush=True)

    search_page = SEARCH_PAGE_TMPL.format(origin=origin, dest=dest, date=date)
    LAST_RUN_DIAG["search_page"] = search_page

    # --- Step 1: mint an Akamai session by rendering the SPA via WU -------
    mint_attempt: dict[str, Any] = {"stage": "page_mint", "url": search_page}
    try:
        cookies, mint_diag = await wu_mint_cookies(search_page)
    except httpx.HTTPError as exc:
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"UA: page mint httpx error: {err}", flush=True)
        mint_attempt.update(stage="mint_http_error", error=err)
        LAST_RUN_DIAG["attempts"].append(mint_attempt)
        LAST_RUN_DIAG["last_verdict"] = "http_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"UA: page mint crash: {err}", flush=True)
        mint_attempt.update(stage="mint_crash", error=err)
        LAST_RUN_DIAG["attempts"].append(mint_attempt)
        LAST_RUN_DIAG["last_verdict"] = "crash"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    mint_attempt["mint_diag"] = mint_diag
    mint_attempt["cookie_names"] = sorted(cookies.keys())
    mint_attempt["cookie_count"] = len(cookies)
    abck = cookies.get("_abck", "")
    mint_attempt["has_abck"] = bool(abck)
    mint_attempt["abck_validated"] = "~0~" in abck
    mint_attempt["has_bm_cookies"] = any(k.startswith("bm_") for k in cookies)
    print(
        f"UA: page mint → {len(cookies)} cookies "
        f"(_abck={'y' if abck else 'n'}, bm_*={mint_attempt['has_bm_cookies']}) "
        f"target_status={mint_diag.get('target_status')}",
        flush=True,
    )
    LAST_RUN_DIAG["attempts"].append(mint_attempt)

    if not cookies:
        print("UA: page mint returned no cookies — aborting", flush=True)
        LAST_RUN_DIAG["last_verdict"] = "no_cookies"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    # --- Step 2: mint an anonymous bearer token ---------------------------
    token, token_diag = await _mint_token(cookies)
    LAST_RUN_DIAG["attempts"].append(token_diag)
    print(
        f"UA: token mint → status={token_diag.get('wu_status')} "
        f"obtained={token_diag.get('token_obtained')}",
        flush=True,
    )
    if not token:
        print("UA: no anonymous token — aborting", flush=True)
        LAST_RUN_DIAG["last_verdict"] = "no_token"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    # --- Step 3: POST FetchFlights with the bearer token + cookie jar -----
    # Two WU transports tried in order, each recorded as its own attempts[]
    # entry. `format=json` (full unlocker engine) is known to hit
    # `ub_bad_endpoint_robots` for `/api/flight/FetchFlights`; `format=raw`
    # (proxy pass-through) is the untested transport. First success wins.
    body = _build_body(origin, dest, date, 1, _united_cabin(cabin_filter))
    headers = _api_headers(token, cookies)

    for transport in ("json", "raw"):
        results, verdict = await _call_award_api(transport, body, headers, origin, dest, date)
        if verdict == "ok":
            LAST_RUN_DIAG["last_verdict"] = "ok"
            LAST_RUN_DIAG["winning_transport"] = transport
            LAST_RUN_DIAG["row_count"] = len(results)
            print(f"UA: SUCCESS ({len(results)} rows via format={transport})", flush=True)
            return results
        LAST_RUN_DIAG["last_verdict"] = verdict

    LAST_RUN_DIAG["row_count"] = 0
    print(
        f"UA: exhausted both WU transports — final verdict "
        f"{LAST_RUN_DIAG.get('last_verdict')}",
        flush=True,
    )
    return []


search = _scrape_real
