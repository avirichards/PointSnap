"""AA AAdvantage award-search variant — Bright Data Web Unlocker transport.

The Sekinal cookie-mint + curl_cffi pattern in `search.py` failed Phase 1
because BD Residential US IPs are Akamai-flagged for aa.com (`_abck` never
reaches `~0~`). WU is the lowest-friction next experiment: instead of
trying to mint a valid browser session and replay, we hand the entire
request to BD's WU API and let them handle the bot defense.

Session 5 Phase C (scraper-log.md L289-305) confirmed WU POST to AA's
`/booking/api/search/itinerary` succeeds at the network layer (HTTP 200,
AA's JSON shape) but AA's app returns `{"error":"309", ...}` — error 309
means "no session": AA's API needs a valid *application* session
(`XSRF-TOKEN`, optionally `spa_session_id`/`JSESSIONID`).

Two-step flow this module implements
------------------------------------
Step 1 — mint a session. WU GET an aa.com page that renders, then read the
`Set-Cookie` headers off WU's `format=json` envelope. The catch: WU applies
a stale per-site render-readiness rule to `www.aa.com/*` — it waits for a
`#weeklyCarousel` selector that AA's Akamai challenge prevents rendering,
so every `www.aa.com` GET 502s with `x-brd-error-code: expect_element`.

We work around that two ways, tried in order (`_MINT_STRATEGIES`):
  1. `mobile.aa.com/booking` — confirmed (scraper-log L309, re-confirmed
     2026-05-20) to render cleanly via WU: HTTP 200, full cookie jar with
     `XSRF-TOKEN` + `JSESSIONID` + Akamai `bm_*` cookies. mobile.aa.com is
     the same `.aa.com` cookie domain. It's a legacy server-rendered page
     so it does NOT mint `spa_session_id`.
  2. `www.aa.com/*` SPA pages with an `x-unblock-expect` *override* header
     — we send our own expect target so WU stops waiting for the dead
     `#weeklyCarousel` selector. If WU honours the override and renders,
     the SPA bootstrap mints `spa_session_id` too.

We stop at the first strategy whose jar has `XSRF-TOKEN` (AA's load-bearing
session cookie per Sekinal).

Step 2 — POST the award API. `wu_post` hands the request to WU again (WU
re-solves Akamai for the POST, so the jar's `_abck` is not needed here);
we forward the minted session cookies plus `X-XSRF-TOKEN` + `X-CID`
headers AA's API derives from them (Sekinal recipe — see
`tasks/scraper-research/agent-1-aa-oss-deep-dive.md` and
`search.py:_search_via_curl_cffi`).

`_parse_xhr` from `aa_aadvantage.search` parses the response — shape is
identical regardless of how the request was made.

Env vars: `BRIGHTDATA_WU_TOKEN` + `BRIGHTDATA_WU_ZONE` (both read here and
by `common/bd_wu.py`). Set as Fly secrets — never commit a value.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from aa_aadvantage.search import (
    PROGRAM_ID,
    PROGRAM_NAME,
    _parse_xhr,
)
from common.bd_wu import cookies_to_header, parse_set_cookie, wu_post
from common.types import NormalizedResult

log = logging.getLogger(__name__)

AA_API_ENDPOINT = "https://www.aa.com/booking/api/search/itinerary"
WU_ENDPOINT = "https://api.brightdata.com/request"

# Session-mint strategies, ALL tried, then the best jar is selected (see
# `_mint_aa_session`). Each is `(label, url, expect_override)`:
#   * `url` — the aa.com page WU GETs to mint cookies.
#   * `expect_override` — value for the `x-unblock-expect` header, or None.
#     When None, WU uses its own (stale, for aa.com) per-site render rule.
#     When set, we override that rule so WU stops waiting for the dead
#     `#weeklyCarousel` selector and returns once our target is present.
#
# Why every strategy runs instead of stopping at the first XSRF-TOKEN:
# `mobile.aa.com/booking` reliably renders via WU and mints `XSRF-TOKEN` +
# `JSESSIONID` + the Akamai jar — but it's the *legacy server-rendered*
# mobile page, so it never mints `spa_session_id`. A 2026-05-20 deployed
# run proved that jar still gets AA error 309 ("no session") on the award
# POST: `XSRF-TOKEN` alone is not a session. Sekinal's research
# (`agent-1-aa-oss-deep-dive.md`) names `spa_session_id` the *other*
# critical cookie — minted only by the www.aa.com booking SPA's bootstrap.
#
# So the `www.aa.com` strategies (which target the booking SPA, sent with
# an `x-unblock-expect` override so WU stops waiting for the dead
# `#weeklyCarousel` selector) are what can mint `spa_session_id`. We run
# them all and prefer a jar that has `spa_session_id`; `mobile.aa.com` is
# the floor we fall back to if none of the SPA renders succeed. Note BD's
# docs are ambiguous on whether the REST API honours an `x-unblock-expect`
# in the `headers` field — `LAST_RUN_DIAG.mint.strategies[]` records each
# strategy's `target_status` + `x_brd_error_code` so a run shows definitively
# whether the override unblocked www.aa.com.
_MINT_STRATEGIES: list[tuple[str, str, str | None]] = [
    # Floor: confirmed-rendering legacy page. XSRF-TOKEN + Akamai jar, no SPA sid.
    ("mobile_booking", "https://mobile.aa.com/booking", None),
    # The booking SPA — what mints `spa_session_id`. find-flights is the SPA's
    # search entry; choose-flights is its results route. Both depend on the
    # `x-unblock-expect` override defeating WU's stale `#weeklyCarousel` wait.
    (
        "www_findflights",
        "https://www.aa.com/booking/find-flights",
        '{"body": true}',
    ),
    (
        "www_choose_flights",
        "https://www.aa.com/booking/choose-flights/1",
        '{"body": true}',
    ),
]

# Cookie that proves a real booking-SPA session (vs a stateless page hit).
# AA's award API rejects jars without it as error 309.
_SPA_SESSION_COOKIE = "spa_session_id"
# Cookie present on any rendered aa.com page — the floor for a usable jar.
_BASE_SESSION_COOKIE = "XSRF-TOKEN"

# Module-level diagnostic state — last scrape's request + WU response,
# exposed via `/diag/aa_wu_last`. Forensic-detail by design (CLAUDE.md
# scraper-log discipline): callers should never have to grep Fly logs.
LAST_RUN_DIAG: dict[str, Any] = {"attempts": []}


def _build_aa_payload(origin: str, dest: str, date: str) -> dict[str, Any]:
    """Construct the JSON body AA's `/booking/api/search/itinerary` accepts.

    Shape mirrors `search.py:_search_via_curl_cffi` verbatim — see Phase 0
    Agent 6 community-intel report for confirmation that this is the exact
    shape Sekinal/aa_contest and other working OSS scrapers submit.

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


async def _wu_get_json(
    url: str,
    expect_override: str | None = None,
    timeout_s: float = 210.0,
) -> tuple[int, dict[str, Any] | None]:
    """WU GET `url` with `format=json` so BD wraps the target's response in
    an envelope that includes the response headers (`set-cookie` etc).

    This is a local sibling of `bd_wu.wu_request_json`. We can't use that
    helper because it has no way to pass an `x-unblock-expect` override —
    and overriding WU's stale `#weeklyCarousel` per-site wait for aa.com is
    the whole point of this function. `bd_wu.py` is shared infrastructure
    we deliberately don't modify for an AA-specific need.

    `x-unblock-expect` is placed in the WU envelope's `headers` object —
    BD's REST API reads `x-unblock-*` / `x-brd-*` prefixed headers there as
    control directives rather than forwarding them to the target (per BD's
    own `brightdata/skills` web-unlocker reference). If a given BD API
    version forwards it to AA instead, AA simply ignores an unknown header
    and we fall through to the next mint strategy — no harm.

    Returns `(wu_http_status, envelope_or_None)`. WU's envelope is roughly
    `{"status_code": int, "headers": {...}, "body": "..."}` — key names
    vary by BD API version so callers probe defensively.
    """
    token = os.environ.get("BRIGHTDATA_WU_TOKEN")
    zone = os.environ.get("BRIGHTDATA_WU_ZONE")
    if not token or not zone:
        raise RuntimeError(
            "BRIGHTDATA_WU_TOKEN and BRIGHTDATA_WU_ZONE env vars are "
            "required for the AA WU variant. Set them as Fly secrets."
        )

    wu_envelope: dict[str, Any] = {
        "zone": zone,
        "url": url,
        "method": "GET",
        "format": "json",
    }
    if expect_override:
        # WU control directive — see docstring. Kept out of the request when
        # None so WU's default behaviour is unchanged for strategies that
        # don't need the override.
        wu_envelope["headers"] = {"x-unblock-expect": expect_override}

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_s, connect=10.0)
    ) as client:
        resp = await client.post(
            WU_ENDPOINT,
            json=wu_envelope,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    try:
        return resp.status_code, resp.json()
    except (json.JSONDecodeError, ValueError):
        return resp.status_code, None


def _read_envelope(envelope: dict[str, Any] | None) -> dict[str, Any]:
    """Pull cookies + diagnostics out of a WU `format=json` envelope.

    Returns a dict: `{cookies, target_status, x_brd_error, x_brd_error_code,
    cookie_names, body_len}`. `cookies` is a `{name: value}` jar (empty if
    WU failed). Shape-tolerant — BD varies envelope key casing by version.
    """
    out: dict[str, Any] = {
        "cookies": {},
        "target_status": None,
        "x_brd_error": None,
        "x_brd_error_code": None,
        "cookie_names": [],
        "body_len": 0,
    }
    if not isinstance(envelope, dict):
        return out
    out["target_status"] = envelope.get("status_code") or envelope.get("status")
    hdrs = envelope.get("headers") or envelope.get("response_headers") or {}
    if isinstance(hdrs, dict):
        out["x_brd_error"] = hdrs.get("x-brd-error") or hdrs.get("X-Brd-Error")
        out["x_brd_error_code"] = hdrs.get("x-brd-error-code") or hdrs.get(
            "X-Brd-Error-Code"
        )
        cookies = parse_set_cookie(
            hdrs.get("set-cookie") or hdrs.get("Set-Cookie")
        )
        out["cookies"] = cookies
        out["cookie_names"] = sorted(cookies.keys())
    body = envelope.get("body")
    if isinstance(body, str):
        out["body_len"] = len(body)
    return out


async def _mint_aa_session() -> tuple[dict[str, str], dict[str, Any]]:
    """Step 1 of the WU two-step flow: WU-GET aa.com pages that render and
    harvest the best session cookie jar.

    Runs *every* `_MINT_STRATEGIES` entry (not first-match) because the only
    AA URL that reliably renders via WU — `mobile.aa.com/booking` — mints
    `XSRF-TOKEN` but NOT `spa_session_id`, and a 2026-05-20 deployed run
    proved that jar still gets AA error 309 on the award POST. We must also
    try the www.aa.com booking-SPA pages (which can mint `spa_session_id`),
    then pick the best jar:

      1. First jar containing `spa_session_id` — a real booking-SPA session.
      2. Else first jar containing `XSRF-TOKEN` — the `mobile.aa.com` floor;
         lets the POST run so its error 309 is recorded as evidence rather
         than the run dying at "mint failed".
      3. Else empty — no AA URL rendered via WU at all.

    Each strategy attempt is logged into `diag["strategies"]` so
    `/diag/aa_wu_last` shows exactly which AA URLs rendered, which cookies
    each minted, and why any failed (`#weeklyCarousel` timeout, captcha
    block, rate-limit, …).

    Returns `(cookies, diag)` — `cookies` empty only if every strategy
    failed to render.
    """
    diag: dict[str, Any] = {"strategies": [], "minted_via": None}
    # Successful jars, in strategy order: (label, cookies).
    jars: list[tuple[str, dict[str, str]]] = []

    for label, url, expect_override in _MINT_STRATEGIES:
        print(
            f"AA_WU: mint attempt '{label}' → WU GET {url} "
            f"(expect_override={expect_override!r})",
            flush=True,
        )
        strat: dict[str, Any] = {
            "label": label,
            "url": url,
            "expect_override": expect_override,
        }
        try:
            wu_status, envelope = await _wu_get_json(url, expect_override)
        except httpx.HTTPError as exc:
            strat["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            diag["strategies"].append(strat)
            print(f"AA_WU: mint '{label}' httpx error: {strat['error']}", flush=True)
            continue

        info = _read_envelope(envelope)
        strat["wu_http_status"] = wu_status
        strat["target_status"] = info["target_status"]
        strat["x_brd_error"] = info["x_brd_error"]
        strat["x_brd_error_code"] = info["x_brd_error_code"]
        strat["cookie_names"] = info["cookie_names"]
        strat["body_len"] = info["body_len"]
        cookies = info["cookies"]
        strat["has_xsrf"] = _BASE_SESSION_COOKIE in cookies
        strat["has_spa_sid"] = _SPA_SESSION_COOKIE in cookies
        strat["has_jsessionid"] = "JSESSIONID" in cookies
        diag["strategies"].append(strat)

        print(
            f"AA_WU: mint '{label}' wu={wu_status} target={info['target_status']} "
            f"cookies={len(cookies)} xsrf={_BASE_SESSION_COOKIE in cookies} "
            f"spa_sid={_SPA_SESSION_COOKIE in cookies} "
            f"brd_err={info['x_brd_error_code']!r}",
            flush=True,
        )

        if _BASE_SESSION_COOKIE in cookies:
            jars.append((label, cookies))

    # --- select the best jar ------------------------------------------
    chosen_label: str | None = None
    chosen: dict[str, str] = {}
    for label, cookies in jars:
        if _SPA_SESSION_COOKIE in cookies:
            chosen_label, chosen = label, cookies
            break
    if not chosen and jars:
        # No SPA session anywhere — fall back to the first usable jar so the
        # POST still runs (its error 309, if any, is the evidence we want).
        chosen_label, chosen = jars[0]

    diag["minted_via"] = chosen_label
    diag["jar_count"] = len(jars)
    if chosen:
        diag["cookie_names"] = sorted(chosen.keys())
        diag["has_spa_sid"] = _SPA_SESSION_COOKIE in chosen
        print(
            f"AA_WU: session minted via '{chosen_label}' "
            f"({len(chosen)} cookies, spa_sid={_SPA_SESSION_COOKIE in chosen})",
            flush=True,
        )
    else:
        print("AA_WU: all mint strategies failed — no usable jar", flush=True)
    return chosen, diag


def _build_api_headers(cookies: dict[str, str]) -> dict[str, str]:
    """Headers WU forwards to AA's API on the award-search POST.

    Beyond a browser-shaped `Accept`/`Referer`/`Origin` set, AA's API wants
    two headers derived from the session (Sekinal recipe, verified in
    `search.py:_search_via_curl_cffi`):
      * `X-XSRF-TOKEN` ← the `XSRF-TOKEN` cookie (CSRF double-submit).
      * `X-CID`        ← the `spa_session_id` cookie. The legacy
        `mobile.aa.com` mint path doesn't set `spa_session_id`, so when
        it's absent we fall back to a fresh UUID — `X-CID` reads as a
        client-generated correlation id, so a syntactically valid UUID
        keeps AA's API from rejecting the request for a missing header.
        (If AA strictly validates `X-CID` against server state, the
        `www.aa.com` mint strategies — which DO mint `spa_session_id` —
        are the path that satisfies it; `LAST_RUN_DIAG` shows which mint
        strategy a given run used.)
    """
    headers: dict[str, str] = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.5",
        "Content-Type": "application/json",
        "Referer": "https://www.aa.com/booking/choose-flights/1",
        "Origin": "https://www.aa.com",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Cookie": cookies_to_header(cookies),
    }
    xsrf = cookies.get("XSRF-TOKEN")
    if xsrf:
        headers["X-XSRF-TOKEN"] = xsrf
    headers["X-CID"] = cookies.get("spa_session_id") or str(uuid.uuid4())
    return headers


async def search_via_wu(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity with search.search
) -> list[NormalizedResult]:
    """Search AA awards via Bright Data Web Unlocker, two-step.

    Step 1 mints an AA session (`_mint_aa_session`); Step 2 POSTs the award
    API through WU with that session.

    Verdict codes captured in LAST_RUN_DIAG.last_verdict:
      ok           — WU 200 with parseable AA response containing slices
      no_results   — WU 200, valid JSON, but zero rows parsed
      no_slices    — WU 200, JSON, no `slices` key (still error 309 / empty)
      api_error    — WU 200 but body is not JSON (HTML / blank / unexpected)
      wu_error     — WU itself returned non-200 (BD validation, no credit, …)
      mint_failed  — Step 1 minted no session (no AA URL rendered via WU)
      http_error   — Network / timeout error reaching `api.brightdata.com`
      crash        — Unhandled exception inside the variant (programmer error)
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "bd_web_unlocker_2step",
        "origin": origin,
        "dest": dest,
        "date": date,
        "endpoint": AA_API_ENDPOINT,
        "attempts": [],
    }

    print(
        f"AA_WU: ===== search start {origin}->{dest} {date} via Web Unlocker =====",
        flush=True,
    )

    # --- Step 1: mint an AA session -----------------------------------
    try:
        cookies, mint_diag = await _mint_aa_session()
    except httpx.HTTPError as exc:
        err_str = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"AA_WU: httpx error during session mint: {err_str}", flush=True)
        LAST_RUN_DIAG["mint"] = {"error": err_str}
        LAST_RUN_DIAG["last_verdict"] = "http_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []
    except Exception as exc:  # noqa: BLE001 — defensive; surface anything else
        err_str = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"AA_WU: crash during session mint: {err_str}", flush=True)
        LAST_RUN_DIAG["mint"] = {"error": err_str}
        LAST_RUN_DIAG["last_verdict"] = "crash"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    LAST_RUN_DIAG["mint"] = mint_diag

    if not cookies:
        print("AA_WU: session mint failed — cannot POST AA API", flush=True)
        LAST_RUN_DIAG["last_verdict"] = "mint_failed"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    # --- Step 2: POST the award API with the minted session -----------
    payload = _build_aa_payload(origin, dest, date)
    api_headers = _build_api_headers(cookies)
    attempt_diag: dict[str, Any] = {
        "attempt": 1,
        "endpoint": AA_API_ENDPOINT,
        "payload_size": len(str(payload)),
        "minted_via": mint_diag.get("minted_via"),
        "cookie_count": len(cookies),
        "sent_xsrf": "X-XSRF-TOKEN" in api_headers,
        "spa_sid_present": "spa_session_id" in cookies,
    }

    try:
        status, parsed, raw_text = await wu_post(
            url=AA_API_ENDPOINT,
            body=payload,
            headers=api_headers,
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
        f"aa_error={attempt_diag.get('aa_error')!r} "
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
        # Either the `error: 309` shape (session still rejected) or a
        # different empty-result shape. raw_text_head + aa_error + json_keys
        # in diag tell us which.
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
        print("AA_WU: parsed JSON had slices but _parse_xhr returned 0 rows", flush=True)
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
