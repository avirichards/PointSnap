"""Delta SkyMiles award search plugin — Bright Data Web Unlocker 2-step.

Phase 1 transport rewrite (2026-05-20). The prior transport (Patchright /
Camoufox + BD Browser API) is Akamai-flagged for delta.com, so the search
silently returned `[]`. This module replaces it with the **WU two-step**
pattern proven for AA:

  Step 1 — mint a session:
      `wu_mint_cookies("https://www.delta.com/")` GETs the homepage via
      Bright Data Web Unlocker. WU renders the page (solving Akamai BMP),
      and the returned Set-Cookie jar carries Delta's Akamai cookies
      (`_abck`, `bm_ss`, `bm_mi`, `bm_s`, `bm_so`, `bm_sz`) plus app
      cookies (`AKA_A2`, `Homepage`, `location`, `akaalb_www_alb_homepage`).

  Step 2 — call the award API:
      WU POSTs `https://www.delta.com/shop/ow/search` with that cookie jar
      forwarded as a `Cookie:` header + browser-shaped request headers.
      The endpoint is an AWS API Gateway / Lambda (`x-amzn-requestid`,
      `shopAWSError` in error envelopes) — it returns award (SkyMiles)
      pricing JSON when handed a valid body.

Probe findings (2026-05-20, via `/diag/wu_probe`):
  * `GET  /shop/ow/search` (any params) → `{"shoppingError":{...100800...},
    "shopAWSError":"Y"}` — WU clears Akamai for this path; `100800` means
    "no valid request payload" (it's a POST-body endpoint, not GET).
  * `POST /shop/ow/search` with NO body → Akamai 444 "Access Denied"
    (Akamai flags an empty-bodied POST as a bot).
  * Homepage mint returns ~13 cookies including `_abck` + the `bm_*` set.

So the award call is a POST with a JSON body + the minted cookies. The
`100800`-vs-real-result distinction is captured verbatim in
`LAST_RUN_DIAG` so the request shape can be iterated from `/diag/dl_last`
without grepping Fly logs.

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

from common.bd_wu import cookies_to_header, wu_mint_cookies, wu_post
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
    a one-way SkyMiles (award) search:
      * `shopType: "MILES"` + `awardTravel: True` → award (SkyMiles) pricing
      * `cabinFareClass: "BE"` → "Best Experience" (all cabins; we filter
        cabins ourselves in `_parse` rather than constraining the search)
      * `searchByCabin: True` so the response carries per-cabin fare offers

    If Delta has renamed fields, the endpoint replies with the structured
    `{"shoppingError":{...100800...}}` envelope — `LAST_RUN_DIAG` captures
    that verbatim so the shape can be corrected from `/diag/dl_last`.
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
        "Referer": "https://www.delta.com/flight-search/book-a-flight",
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

    Verdict codes recorded in `LAST_RUN_DIAG["last_verdict"]`:
      ok            — WU POST returned 200 with parseable award JSON + rows
      no_results    — WU POST returned 200 + valid JSON but 0 rows parsed
      no_itinerary  — WU POST returned 200 + JSON but no `itinerary` key
                      (e.g. the `shoppingError`/100800 envelope, or empty)
      api_non_json  — WU POST returned 200 but body is not JSON (HTML block)
      api_error     — WU POST returned non-200 (target rejected, e.g. 444)
      no_cookies    — homepage mint returned an empty cookie jar
      http_error    — network/timeout error reaching api.brightdata.com
      crash         — unhandled exception (programmer error)
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "bd_web_unlocker_2step",
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

    attempt: dict[str, Any] = {"attempt": 1}

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
        f"DL: mint → {len(cookies)} cookies "
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

    # --- Step 2: POST the award API with the minted cookie jar ------------
    body = _build_search_body(origin, dest, date, 1)
    attempt["payload_keys"] = sorted(body.keys())
    try:
        status, parsed, raw_text = await wu_post(
            url=SEARCH_API,
            body=body,
            headers=_api_headers(cookies),
            timeout_s=90.0,  # WU can be slow on cold sessions
        )
    except httpx.HTTPError as exc:
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"DL: award POST httpx error: {err}", flush=True)
        attempt.update(stage="api_http_error", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "http_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"DL: award POST crash: {err}", flush=True)
        attempt.update(stage="api_crash", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "crash"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    attempt["api_status"] = status
    attempt["raw_text_len"] = len(raw_text)
    attempt["raw_text_head"] = raw_text[:600]  # forensic preview
    attempt["json_parsed"] = parsed is not None
    if parsed is not None:
        attempt["json_keys"] = sorted(parsed.keys())[:30]
        # Delta's structured error envelope: surface the code/message.
        if "shoppingError" in parsed:
            err_obj = (
                ((parsed.get("shoppingError") or {}).get("error") or {}).get("message")
                or {}
            )
            attempt["dl_error_code"] = str(err_obj.get("code"))[:20]
            attempt["dl_error_message"] = str(err_obj.get("message"))[:200]
        attempt["itinerary_count"] = len(parsed.get("itinerary") or [])

    print(
        f"DL: award POST → status={status} len={len(raw_text)} "
        f"parsed={parsed is not None} "
        f"itineraries={attempt.get('itinerary_count', 0)} "
        f"dl_error={attempt.get('dl_error_code')}",
        flush=True,
    )

    # --- Categorize the verdict ------------------------------------------
    if status != 200:
        attempt["stage"] = "api_non_200"
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "api_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    if parsed is None:
        attempt["stage"] = "api_non_json"
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "api_non_json"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    if not parsed.get("itinerary"):
        # Either the shoppingError/100800 envelope (request shape wrong /
        # session rejected) or a genuinely empty award result. raw_text_head
        # + dl_error_code in diag disambiguate.
        attempt["stage"] = "api_no_itinerary"
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "no_itinerary"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    results = _parse(parsed, origin, dest, date)
    attempt["stage"] = "parsed"
    attempt["row_count"] = len(results)
    LAST_RUN_DIAG["attempts"].append(attempt)

    if not results:
        LAST_RUN_DIAG["last_verdict"] = "no_results"
        LAST_RUN_DIAG["row_count"] = 0
        print("DL: parsed JSON had itineraries but _parse returned 0 rows", flush=True)
        return []

    LAST_RUN_DIAG["last_verdict"] = "ok"
    LAST_RUN_DIAG["row_count"] = len(results)
    print(f"DL: SUCCESS ({len(results)} rows)", flush=True)
    return results


search = _scrape_real
