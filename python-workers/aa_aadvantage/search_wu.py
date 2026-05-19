"""AA AAdvantage award-search variant — Bright Data Web Unlocker transport.

The Sekinal cookie-mint + curl_cffi pattern in `search.py` failed Phase 1
because BD Residential US IPs are Akamai-flagged for aa.com (`_abck` never
reaches `~0~`). WU is the lowest-friction next experiment: instead of
trying to mint a valid browser session and replay, we just hand the entire
request to BD's WU API and let them handle the bot defense.

Session 5 Phase C (scraper-log.md L289-305) already confirmed:
  * WU POST to `/booking/api/search/itinerary` succeeds at the network
    layer — HTTP 200, AA's response JSON shape returned.
  * Whether AA's *app* layer accepts the request is a separate matter. In
    Session 5, anonymous WU POSTs got `{"error":"309", ...}` (session
    state missing). This variant exists to see whether the answer has
    changed in 2026-05 — and to provide a clean substrate if/when we
    figure out how to forge a session that AA accepts.

Architecture:
  * Build the exact AA payload `search.py:_search_via_curl_cffi` uses.
  * Hand it to `bd_wu.wu_post`; let BD handle proxy + sensor.js.
  * Capture status + parsed body + raw text into `LAST_RUN_DIAG` (mirrors
    `search.py:LAST_RUN_DIAG` so the existing `/diag/aa_last` style
    surface works once the parent wires `/diag/aa_wu_last`).
  * Parse via the existing `_parse_xhr` from `aa_aadvantage.search` —
    response shape is identical regardless of how we got it.

No new env vars beyond `BRIGHTDATA_WU_TOKEN` and `BRIGHTDATA_WU_ZONE`
(both read by `common/bd_wu.py`).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from aa_aadvantage.search import (
    PROGRAM_ID,
    PROGRAM_NAME,
    _parse_xhr,
)
from common.bd_wu import wu_post
from common.types import NormalizedResult

log = logging.getLogger(__name__)

AA_API_ENDPOINT = "https://www.aa.com/booking/api/search/itinerary"

# Module-level diagnostic state — last scrape's request + WU response,
# exposed via `/diag/aa_wu_last` (the parent wires the route after this
# module lands). Forensic-detail by design (per CLAUDE.md scraper log
# discipline): callers should never have to grep Fly logs for what
# happened — `LAST_RUN_DIAG` should answer it.
LAST_RUN_DIAG: dict[str, Any] = {"attempts": []}


def _build_aa_payload(origin: str, dest: str, date: str) -> dict[str, Any]:
    """Construct the JSON body AA's `/booking/api/search/itinerary` accepts.

    Shape mirrors `search.py:_search_via_curl_cffi` verbatim — see Phase 0
    Agent 6 community-intel report for confirmation that this is the
    exact shape Sekinal/aa_contest and other working OSS scrapers submit.

    Tweaking any field here without verifying against a known-good capture
    will silently regress to AA returning `error: 309` (session/payload
    rejected) — so keep this in sync with `search.py` and don't drift.
    """
    return {
        "metadata": {"selectedProducts": [], "tripType": "OneWay", "udo": {}},
        "passengers": [{"type": "adult", "count": 1}],
        "requestHeader": {"clientId": "AAcom"},
        "slices": [
            {
                "allCarriers": True,
                "cabin": "",
                "connectionCity": None,
                "departureDate": date,
                "destination": dest,
                "destinationNearbyAirports": False,
                "maxStops": None,
                "origin": origin,
                "originNearbyAirports": False,
            }
        ],
        "tripOptions": {
            "corporateBooking": False,
            "fareType": "Lowest",
            "locale": "en_US",
            "pointOfSale": "",
            "searchType": "Award",
        },
        "loyaltyInfo": None,
        "version": "",
        "queryParams": {
            "sliceIndex": 0,
            "sessionId": "",
            "solutionSet": "",
            "solutionId": "",
            "sort": "CARRIER",
        },
    }


async def search_via_wu(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity with search.search
) -> list[NormalizedResult]:
    """Search AA awards via Bright Data Web Unlocker.

    Verdict codes captured in LAST_RUN_DIAG.last_verdict:
      ok          — WU returned 200 with parseable AA response containing slices
      no_results  — WU returned 200 with valid JSON but zero rows parsed
      no_slices   — WU returned 200 with JSON but no `slices` key (likely error 309)
      api_error   — WU returned 200 but body is not JSON (HTML / blank / unexpected)
      wu_error    — WU itself returned non-200 (BD validation error, no credit, …)
      http_error  — Network / timeout error reaching `api.brightdata.com`
      crash       — Unhandled exception inside the variant (programmer error)
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "bd_web_unlocker",
        "origin": origin,
        "dest": dest,
        "date": date,
        "endpoint": AA_API_ENDPOINT,
        "attempts": [],
    }

    payload = _build_aa_payload(origin, dest, date)
    attempt_diag: dict[str, Any] = {
        "attempt": 1,
        "endpoint": AA_API_ENDPOINT,
        "payload_size": len(str(payload)),
    }

    print(
        f"AA_WU: ===== search start {origin}->{dest} {date} via Web Unlocker =====",
        flush=True,
    )

    try:
        status, parsed, raw_text = await wu_post(
            url=AA_API_ENDPOINT,
            body=payload,
            headers={
                # Forwarded to AA. Match what a browser session would send so
                # AA's API doesn't reject for missing Origin / Referer. (These
                # don't fix session state — `error: 309` from Session 5 came
                # back the same with and without them — but they're cheap
                # and won't hurt.)
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.5",
                "Content-Type": "application/json",
                "Referer": "https://www.aa.com/",
                "Origin": "https://www.aa.com",
            },
            timeout_s=90.0,  # WU can be slow on cold sessions (30-60s typical)
        )
    except httpx.HTTPError as exc:
        err_str = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"AA_WU: httpx error talking to BD: {err_str}", flush=True)
        attempt_diag["stage"] = "wu_http_error"
        attempt_diag["error"] = err_str
        LAST_RUN_DIAG["attempts"].append(attempt_diag)
        LAST_RUN_DIAG["last_verdict"] = "http_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []
    except Exception as exc:  # noqa: BLE001 — defensive; surface anything else
        err_str = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"AA_WU: crash before parse: {err_str}", flush=True)
        attempt_diag["stage"] = "outer_crash"
        attempt_diag["error"] = err_str
        LAST_RUN_DIAG["attempts"].append(attempt_diag)
        LAST_RUN_DIAG["last_verdict"] = "crash"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    attempt_diag["wu_status"] = status
    attempt_diag["raw_text_len"] = len(raw_text)
    attempt_diag["raw_text_head"] = raw_text[:400]  # forensic preview
    attempt_diag["json_parsed"] = parsed is not None
    if parsed is not None:
        # Capture which top-level keys came back so we can spot shape drift
        # (e.g. AA introducing new error envelopes) without bloating diag.
        attempt_diag["json_keys"] = sorted(parsed.keys())[:30]
        # Common AA error envelope: {"error":"309", ...}. Surface it.
        if "error" in parsed:
            attempt_diag["aa_error"] = str(parsed.get("error"))[:60]
        attempt_diag["has_slices"] = bool(parsed.get("slices"))
        attempt_diag["slice_count"] = len(parsed.get("slices") or [])

    print(
        f"AA_WU: wu_post returned status={status} len={len(raw_text)} "
        f"parsed={parsed is not None} "
        f"slices={attempt_diag.get('slice_count', 0)}",
        flush=True,
    )

    # Categorize verdict. We treat WU's status as the truth: with format=raw,
    # 200 means AA replied 200 (whether or not the body is what we want).
    if status != 200:
        attempt_diag["stage"] = "wu_non_200"
        LAST_RUN_DIAG["attempts"].append(attempt_diag)
        LAST_RUN_DIAG["last_verdict"] = "wu_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    if parsed is None:
        attempt_diag["stage"] = "api_non_json"
        LAST_RUN_DIAG["attempts"].append(attempt_diag)
        LAST_RUN_DIAG["last_verdict"] = "api_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    if not parsed.get("slices"):
        # Either the `error: 309` shape (session missing) or a different
        # empty-result shape AA invented since. raw_text_head + json_keys
        # in diag will tell us which.
        attempt_diag["stage"] = "api_no_slices"
        LAST_RUN_DIAG["attempts"].append(attempt_diag)
        LAST_RUN_DIAG["last_verdict"] = "no_slices"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    results = _parse_xhr(parsed, origin, dest, date)
    attempt_diag["stage"] = "parsed"
    attempt_diag["row_count"] = len(results)
    LAST_RUN_DIAG["attempts"].append(attempt_diag)

    if not results:
        LAST_RUN_DIAG["last_verdict"] = "no_results"
        LAST_RUN_DIAG["row_count"] = 0
        print(f"AA_WU: parsed JSON had slices but _parse_xhr returned 0 rows", flush=True)
        return []

    LAST_RUN_DIAG["last_verdict"] = "ok"
    LAST_RUN_DIAG["row_count"] = len(results)
    print(
        f"AA_WU: SUCCESS ({len(results)} rows) — program_id={PROGRAM_ID} "
        f"program_name={PROGRAM_NAME}",
        flush=True,
    )
    return results


# Public name to mirror search.search — parent wires
#   PLUGINS["AA_AADVANTAGE_WU"] = search_wu.search
search = search_via_wu
