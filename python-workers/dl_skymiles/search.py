"""Delta SkyMiles award search plugin — Bright Data Web Unlocker transport.

=============================================================================
STATUS (2026-05-21): NO WORKING WU TRANSPORT FOR DELTA. Both WU patterns were
characterized and both fail. The plugin returns `[]` cleanly and records a
full forensic trace in `LAST_RUN_DIAG` (exposed via `/diag/dl_last`).

This is NOT a login problem — Delta award search has an anonymous path. It is
a *transport* wall: Delta's Akamai BMP policy defeats every WU shape we can
send. Findings, all verified via `/diag/wu_probe` (Session 12 + re-confirmed
2026-05-21):

  PATTERN A — WU 2-step (mint homepage cookies, POST the award API):
    * `GET https://www.delta.com/` via WU → 200, ~10-11 Set-Cookie (the `bm_*`
      set + `AKA_A2`/`Homepage`/`location`/`akaalb_*`). `_abck` comes back
      *unvalidated* (`~-1~`) or absent — WU's stateless homepage GET never
      advances `_abck` to `~0~`.
    * `POST https://www.delta.com/shop/ow/search` via WU → **Akamai 444
      "Access Denied"** (188-byte edge-reject HTML with a `Reference#`).
      Re-confirmed 2026-05-21: `target_status:444`. Identical for:
        - no body / full JSON body
        - WU `format=raw` AND `format=json`
        - with / without the minted cookie jar forwarded
    * `POST https://httpbin.org/post` via WU → 200 (echoes request) — proves
      WU's POST capability is fine; the 444 is Delta's Akamai edge, not WU.
    Delta's Akamai policy rejects POST to `/shop/ow/*` at the edge while
    permitting GET. A homepage-render cookie jar does not satisfy it; the
    award POST needs a sensor.js-VALIDATED `_abck` (`~0~`) issued to the same
    IP that sends the POST, which a stateless WU GET cannot produce.

  PATTERN B — WU in-page render (GET the search-results SPA URL, let the SPA
  fire its own award POST from inside WU's Akamai-cleared session):
    * `GET https://www.delta.com/flight-search/book-a-flight` via WU → 200 but
      only a **15 KB static Angular shell** (`<base href="/flightsearch">`,
      `data-critters-container`). No award data — WU's HTTP API returns the
      server's HTML response; it does NOT run the Angular SPA to completion
      and serialize the post-XHR DOM.
    * `GET https://www.delta.com/flightsearch/search-results` (bare) via WU →
      `x-brd-error: captcha or protection page found` / `reject_block`.
    * `GET .../flightsearch/search-results?<full award params>` via WU →
      `x-brd-error: response is shorter than expected` / `min_size`.
    WU's per-domain render-readiness rules (`expect_element` / `min_size`)
    are not tuned for Delta's search-results path, so WU either rejects it as
    a protection page or as too-short. Even when a Delta page DOES render, WU
    returns the empty Angular shell — WU is a single-shot unlocker, not a
    hydrating headless browser that waits for SPA data XHRs.

CONCLUSION: neither WU pattern yields Delta award rows. Delta needs a real
browser that (a) loads the booking SPA, (b) lets sensor.js validate `_abck`
to `~0~`, and (c) lets the SPA fire `/shop/ow/search` from inside the page —
i.e. the Camoufox / BD Browser API in-page XHR-capture transport (the T5/T6
path), NOT WU. That is out of scope for this WU-grind plugin.

The plugin is left wired so `/diag/dl_last` captures a live forensic trace on
every run (the WU 2-step is still executed — its 444 is the evidence). It
returns `[]` (verdict `api_error`) cleanly until the transport above is built.
=============================================================================

Defensive contract: `search()` never raises — every failure path returns
`[]` and records a verdict in `LAST_RUN_DIAG`.

No new env vars beyond `BRIGHTDATA_WU_TOKEN` / `BRIGHTDATA_WU_ZONE`
(both read by `common/bd_wu.py`).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from common.bd_wu import (
    cookies_to_header,
    wu_mint_cookies,
    wu_request_json,
)
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "DL_SKYMILES"
PROGRAM_NAME = "Delta SkyMiles"

HOMEPAGE_URL = "https://www.delta.com/"
SEARCH_API = "https://www.delta.com/shop/ow/search"

# Module-level diagnostic state — last scrape's mint diag + API response,
# exposed via `/diag/dl_last`. Forensic-detail by design (CLAUDE.md scraper
# log discipline): a caller should never have to grep Fly logs to learn
# what happened — LAST_RUN_DIAG should answer it.
LAST_RUN_DIAG: dict[str, Any] = {"attempts": []}


def _cabin_from_cos(code: str) -> str | None:
    """Map a Delta class-of-service letter to our cabin enum.

    Delta award offers expose a `cos` (class of service) array per leg.
    O/I/Z/U are Delta One / business award buckets; everything else we
    treat as economy (Y). Premium Select (W) is not reliably exposed in
    the `cos` field, so it folds into Y here — acceptable for a first cut.
    """
    return {"O": "J", "I": "J", "Z": "J", "U": "J"}.get((code or "").upper(), "Y")


def _build_search_body(origin: str, dest: str, date: str, pax: int) -> dict[str, Any]:
    """Construct the JSON body Delta's `/shop/ow/search` award endpoint accepts.

    Shape mirrors the modern delta.com `flightsearch` SPA's POST payload for
    a one-way SkyMiles (award) search. The body shape is only exercised if
    Delta's Akamai edge ever stops 444-rejecting the POST — until then the
    request never reaches the AWS API Gateway behind it.
    """
    return {
        "selectTripType": "OW",
        "awardTravel": True,
        "passengerInfo": [{"count": pax, "type": "ADT"}],
        "tripOriginAirportCode": origin,
        "tripDestinationAirportCode": dest,
        "departureDate": date,
        "cabinFareClass": "BE",
        "shopType": "MILES",
        "searchByCabin": True,
        "flexAirportRadius": "nonStop",
        "numberOfResults": 50,
        "deltaOnlySearch": False,
        "meetingEventCode": "",
        "refundableFlightsOnly": False,
        "nonstopFlightsOnly": False,
        "priceSchedule": "Schedule",
        "actionType": "findFlights",
    }


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse Delta's `/shop/ow/search` award response into NormalizedResult[].

    Delta returns `{"itinerary": [ { "trip": [...], "fareOffer": [...] } ]}`.
    Each itinerary's `trip[].flightSegment[]` are the legs; `fareOffer[]`
    carries per-cabin miles + cash pricing. Robust to missing keys: any
    itinerary that fails to parse is skipped, not fatal.

    Kept intact and correct so that the moment a working transport is wired,
    real responses parse without further work.
    """
    results: list[NormalizedResult] = []
    for it in (payload.get("itinerary") or [])[:6]:
        try:
            trips = it.get("trip") or []
            segments_raw: list[dict[str, Any]] = []
            for t in trips:
                segments_raw.extend(t.get("flightSegment") or [])

            segments: list[ResultSegment] = []
            for i, seg in enumerate(segments_raw):
                mc = (seg.get("marketingCarrier") or {}).get("code") or "DL"
                op = (seg.get("operatingCarrier") or {}).get("code") or mc
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=op,
                        marketing_airline_iata=mc,
                        flight_number=str(seg.get("flightNumber") or ""),
                        origin_iata=(seg.get("originAirport") or {}).get("code") or origin,
                        dest_iata=(seg.get("destAirport") or {}).get("code") or dest,
                        depart_at=seg.get("departureDateTime") or f"{date}T00:00:00Z",
                        arrive_at=seg.get("arrivalDateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=(seg.get("equipment") or {}).get("model"),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )
            if not segments:
                continue

            cabin_prices_by_code: dict[str, CabinPrice] = {}
            for offer in it.get("fareOffer") or []:
                if offer.get("soldOut"):
                    continue
                cos = ((offer.get("brandInfoByFlightLegs") or [{}])[0].get("cos") or [None])[0]
                cabin = _cabin_from_cos(cos or "")
                if not cabin:
                    continue
                miles = ((offer.get("totalPrice") or {}).get("miles") or {}).get("miles") or 0
                cash = ((offer.get("totalPrice") or {}).get("currency") or {}).get("amount") or 0
                if not miles:
                    continue
                existing = cabin_prices_by_code.get(cabin)
                if existing and existing.miles_per_pax <= int(miles):
                    continue
                cabin_prices_by_code[cabin] = CabinPrice(
                    cabin=cabin,  # type: ignore[arg-type]
                    seats_remaining=0,
                    miles_per_pax=int(miles),
                    surcharge_usd_per_pax=0,
                    taxes_usd_per_pax=int(round(float(cash))),
                )
            if not cabin_prices_by_code:
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
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=list(cabin_prices_by_code.values()),
                    confidence_score=80,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("DL itinerary parse error: %s", exc)
            continue
    return results


def _api_headers(cookies: dict[str, str]) -> dict[str, str]:
    """Browser-shaped headers for the `/shop/ow/search` POST.

    The cookie jar is forwarded as a `Cookie:` header (WU's `headers` field
    forwards verbatim to the target). Origin / Referer / Sec-Fetch-* mirror
    what the delta.com `flightsearch` SPA sends so the AWS API Gateway and
    Akamai treat the request as same-origin XHR.
    """
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        "Origin": "https://www.delta.com",
        "Referer": "https://www.delta.com/flightsearch/book-a-flight",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Cookie": cookies_to_header(cookies),
    }


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
) -> list[NormalizedResult]:
    """Search Delta SkyMiles awards via the Bright Data Web Unlocker 2-step.

    Executes the WU 2-step (mint homepage cookies → POST the award API) so
    `/diag/dl_last` records a live forensic trace. The award POST is known to
    return Akamai 444 (see module docstring) — the run will end with verdict
    `api_error` and `[]`. The function never raises.

    Verdict codes recorded in `LAST_RUN_DIAG["last_verdict"]`:
      ok            — WU POST returned 200 with parseable award rows
      no_results    — WU POST returned 200 + valid JSON but 0 rows parsed
      no_itinerary  — WU POST returned 200 + JSON but no `itinerary` key
      api_non_json  — WU POST returned 200 but body is not JSON (HTML block)
      api_error     — WU POST returned non-200 (Akamai 444 edge-reject — the
                      expected, currently-unavoidable outcome for Delta)
      no_cookies    — homepage mint returned an empty cookie jar
      http_error    — network/timeout error reaching api.brightdata.com
      crash         — unhandled exception (programmer error)
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "bd_web_unlocker_2step",
        "pattern": "A (2-step) — disproven; award POST is Akamai 444-walled",
        "origin": origin,
        "dest": dest,
        "date": date,
        "homepage_url": HOMEPAGE_URL,
        "endpoint": SEARCH_API,
        "attempts": [],
    }
    print(
        f"DL: ===== search start {origin}->{dest} {date} via WU 2-step =====",
        flush=True,
    )

    attempt: dict[str, Any] = {"stage": "homepage_mint"}

    # --- Step 1: mint a session by rendering the homepage via WU ----------
    try:
        cookies, mint_diag = await wu_mint_cookies(HOMEPAGE_URL)
    except httpx.HTTPError as exc:
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"DL: homepage mint httpx error: {err}", flush=True)
        attempt.update(stage="mint_http_error", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "http_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"DL: homepage mint crash: {err}", flush=True)
        attempt.update(stage="mint_crash", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "crash"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    attempt["mint_diag"] = mint_diag
    attempt["cookie_names"] = sorted(cookies.keys())
    attempt["cookie_count"] = len(cookies)
    # Forensic: did Akamai's key cookies come back, and is _abck "validated"?
    abck = cookies.get("_abck", "")
    attempt["has_abck"] = bool(abck)
    attempt["abck_validated"] = "~0~" in abck  # ~0~ = passed; ~-1~ = unvalidated
    attempt["has_bm_cookies"] = any(k.startswith("bm_") for k in cookies)

    print(
        f"DL: mint -> {len(cookies)} cookies "
        f"(_abck={'y' if abck else 'n'}, validated={'~0~' in abck}, "
        f"bm_*={any(k.startswith('bm_') for k in cookies)}) "
        f"target_status={mint_diag.get('target_status')}",
        flush=True,
    )

    if not cookies:
        print("DL: homepage mint returned no cookies — aborting", flush=True)
        attempt["stage"] = "no_cookies"
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "no_cookies"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    LAST_RUN_DIAG["attempts"].append(attempt)

    # --- Step 2: POST the award API with the minted cookie jar ------------
    # WU `format=json` carries the target's status + headers in the envelope
    # (vs `format=raw` which discards them). The award POST is known to come
    # back Akamai 444; we still fire it so /diag/dl_last has the live trace.
    body = _build_search_body(origin, dest, date, 1)
    headers = _api_headers(cookies)
    results, verdict = await _call_award_api(body, headers, origin, dest, date)
    LAST_RUN_DIAG["last_verdict"] = verdict
    LAST_RUN_DIAG["row_count"] = len(results)
    if verdict == "ok":
        print(f"DL: SUCCESS ({len(results)} rows)", flush=True)
        return results

    print(
        f"DL: WU 2-step did not yield rows — verdict {verdict} "
        f"(Delta award POST is Akamai-walled; see module docstring)",
        flush=True,
    )
    return results if verdict == "ok" else []


async def _call_award_api(
    body: dict[str, Any],
    headers: dict[str, str],
    origin: str,
    dest: str,
    date: str,
) -> tuple[list[NormalizedResult], str]:
    """One WU `format=json` POST to `/shop/ow/search`.

    Appends an `attempts[]` entry to `LAST_RUN_DIAG` capturing the WU status,
    the target status (Akamai 444 expected), raw body head, parsed-JSON
    shape, Delta's `shoppingError` envelope if present, and itinerary count.
    Returns `(rows, verdict)`.
    """
    attempt: dict[str, Any] = {
        "stage": "award_post",
        "transport": "format_json",
        "endpoint": SEARCH_API,
        "payload_keys": sorted(body.keys()),
    }

    status: int = 0
    parsed: dict[str, Any] | None = None
    raw_text: str = ""
    try:
        wu_status, envelope = await wu_request_json(
            SEARCH_API, method="POST", body=body, headers=headers, timeout_s=120.0
        )
        attempt["wu_http_status"] = wu_status
        if isinstance(envelope, dict):
            attempt["target_status"] = (
                envelope.get("status_code") or envelope.get("status")
            )
            env_hdrs = envelope.get("headers") or envelope.get("response_headers") or {}
            if isinstance(env_hdrs, dict):
                attempt["x_brd_error"] = (
                    env_hdrs.get("x-brd-error") or env_hdrs.get("X-Brd-Error")
                )
            env_body = envelope.get("body")
            if isinstance(env_body, str):
                raw_text = env_body
                try:
                    loaded = httpx.Response(200, text=env_body).json()
                    parsed = loaded if isinstance(loaded, dict) else None
                except Exception:  # noqa: BLE001 — body not JSON (Akamai HTML)
                    parsed = None
            # Verdict status = the target's status. Coerce a stringified
            # status defensively so an Akamai 444 isn't treated as 200.
            tstat = attempt.get("target_status")
            if isinstance(tstat, int):
                status = tstat
            elif isinstance(tstat, str) and tstat.isdigit():
                status = int(tstat)
        else:
            attempt["envelope"] = "non-JSON WU response"
    except httpx.HTTPError as exc:
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"DL: award POST httpx error: {err}", flush=True)
        attempt["error"] = err
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "http_error"
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"DL: award POST crash: {err}", flush=True)
        attempt["error"] = err
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "crash"

    attempt["effective_status"] = status
    attempt["raw_text_len"] = len(raw_text)
    attempt["raw_text_head"] = raw_text[:600]  # forensic preview
    attempt["json_parsed"] = parsed is not None
    if parsed is not None:
        attempt["json_keys"] = sorted(parsed.keys())[:30]
        if "shoppingError" in parsed:
            err_obj = (
                ((parsed.get("shoppingError") or {}).get("error") or {}).get("message")
                or {}
            )
            attempt["dl_error_code"] = str(err_obj.get("code"))[:20]
            attempt["dl_error_message"] = str(err_obj.get("message"))[:200]
        attempt["itinerary_count"] = len(parsed.get("itinerary") or [])

    print(
        f"DL: award POST -> status={status} len={len(raw_text)} "
        f"parsed={parsed is not None} "
        f"itineraries={attempt.get('itinerary_count', 0)} "
        f"dl_error={attempt.get('dl_error_code')}",
        flush=True,
    )

    # --- Categorize ------------------------------------------------------
    if status and status != 200:
        # The expected outcome for Delta: Akamai 444 "Access Denied".
        attempt["verdict"] = "api_error"
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "api_error"

    if parsed is None:
        attempt["verdict"] = "api_non_json"
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "api_non_json"

    if not parsed.get("itinerary"):
        attempt["verdict"] = "no_itinerary"
        LAST_RUN_DIAG["attempts"].append(attempt)
        return [], "no_itinerary"

    results = _parse(parsed, origin, dest, date)
    attempt["row_count"] = len(results)
    if not results:
        attempt["verdict"] = "no_results"
        LAST_RUN_DIAG["attempts"].append(attempt)
        print("DL: parsed JSON had itineraries but _parse returned 0 rows", flush=True)
        return [], "no_results"

    attempt["verdict"] = "ok"
    LAST_RUN_DIAG["attempts"].append(attempt)
    return results, "ok"


search = _scrape_real
