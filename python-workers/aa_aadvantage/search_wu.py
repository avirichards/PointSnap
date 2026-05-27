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

We run every strategy and pick the best jar — prefer one with
`spa_session_id`, else fall back to the `mobile.aa.com` jar (just
`XSRF-TOKEN` + Akamai cookies). NOTE the `www.aa.com` override depends on
the WU zone having "Manual expect" enabled; a 2026-05-20 run showed the
`pointsnap_webunlock` zone returns `feature_not_active`, so today only the
`mobile.aa.com` jar is obtainable. The `www.aa.com` strategy is kept as a
canary that flips to a real jar once the zone setting is enabled.

Step 2 — POST the award API. Done via `_wu_post_json` (`format=json`, so
WU returns AA's response headers — `bd_wu.wu_post` is `format=raw` and
discards them). WU re-solves Akamai for the POST, so the jar's `_abck` is
not needed here; we forward the minted session cookies plus `X-XSRF-TOKEN`
+ `X-CID` headers AA's API derives from them (Sekinal recipe — see
`tasks/scraper-research/agent-1-aa-oss-deep-dive.md` and
`search.py:_search_via_curl_cffi`). If AA returns error 309 ("no session")
but the response *issues* fresh session cookies, we fold them into the jar
and retry — covering AA's API bootstrapping the session on the first call.

`_parse_xhr` from `aa_aadvantage.search` parses the response — shape is
identical regardless of how the request was made.

Env vars: `BRIGHTDATA_WU_TOKEN` + `BRIGHTDATA_WU_ZONE` (both read here and
by `common/bd_wu.py`). Set as Fly secrets — never commit a value.
"""

from __future__ import annotations

import asyncio
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
from common.bd_wu import cookies_to_header, parse_set_cookie
from common.browser import browser_page
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
    # Canary for the www.aa.com booking SPA (what would mint `spa_session_id`).
    # WU applies a stale `#weeklyCarousel` render-wait to EVERY www.aa.com URL;
    # the only way past it is an `x-unblock-expect` override — and a deployed
    # run (2026-05-20) showed the `pointsnap_webunlock` zone returns
    # `feature_not_active` ("Manual expect is not enabled for this zone").
    # Kept as a single cheap canary: when the user enables Manual Expect on
    # the WU zone, this strategy will start minting `spa_session_id` and the
    # diag flips from `feature_not_active` to a real cookie jar.
    (
        "www_findflights",
        "https://www.aa.com/booking/find-flights",
        '{"body": true}',
    ),
]

# Cookie that proves a real booking-SPA session (vs a stateless page hit).
# AA's award API rejects jars without it as error 309.
_SPA_SESSION_COOKIE = "spa_session_id"
# Cookie present on any rendered aa.com page — the floor for a usable jar.
_BASE_SESSION_COOKIE = "XSRF-TOKEN"

# --- BD Browser API mint rung ----------------------------------------------
# The www.aa.com booking-SPA URL a real browser loads to mint the full
# session jar. The 2026-05-20 probe proved this page (a) clears Akamai on a
# meaningful share of BD's rotating exit pool, returning HTTP 200 with the
# real "Book flights" form (not "Access Denied"), and (b) the SPA's bootstrap
# sets `spa_session_id` into `page.context.cookies()`. AA redirects it to
# `/booking/search/find-flights`; the jar is identical either way.
_BROWSER_MINT_URL = "https://www.aa.com/booking/find-flights"
# Per-attempt seconds to wait for the SPA bootstrap after navigation settles.
# The probe saw `spa_session_id` land within ~30 s; we poll so a fast mint
# returns early instead of always paying the full wait.
_BROWSER_MINT_SETTLE_S = 40.0
# How many fresh BD Browser API sessions to try. Each `browser_page(
# use_brightdata=True)` context gets a new exit IP from BD's pool; Akamai
# hard-denies a chunk of that pool (the BMP taxonomy in scraper-log.md), so a
# retry on a denied IP often lands a clean one. Capped low — BD Browser API
# is bandwidth-billed and a successful mint usually lands on attempt 1-2.
_BROWSER_MINT_MAX_TRIES = 3

# Max award-API POSTs per search. The first POST may get error 309 but
# *issue* the session AA was missing; a retry with that folded-in jar can
# then succeed. Capped low — WU bills per request and AA's Akamai escalates
# under load. We stop early anyway if a 309 issued no new cookies (a retry
# would be byte-identical).
_MAX_API_ATTEMPTS = 3

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


async def _wu_post_json(
    url: str,
    body: dict[str, Any] | str,
    headers: dict[str, str],
    timeout_s: float = 120.0,
) -> tuple[int, dict[str, Any] | None]:
    """POST `body` to `url` via WU with `format=json`.

    `bd_wu.wu_post` uses `format=raw`, which passes the target's body through
    but DISCARDS the target's response headers — including `Set-Cookie`. AA's
    award API, called without a session, returns error 309 ("no session");
    the open question this function exists to answer is whether that 309
    response *also issues* the session (a `Set-Cookie: spa_session_id` /
    refreshed `XSRF-TOKEN`), the standard "bootstrap session on first call"
    SPA-backend pattern. `format=json` is the only way to see those headers,
    so we can fold them into the jar and retry.

    Returns `(wu_http_status, envelope_or_None)`; envelope shape matches
    `_wu_get_json` (`status_code` / `headers` / `body`).
    """
    token = os.environ.get("BRIGHTDATA_WU_TOKEN")
    zone = os.environ.get("BRIGHTDATA_WU_ZONE")
    if not token or not zone:
        raise RuntimeError(
            "BRIGHTDATA_WU_TOKEN and BRIGHTDATA_WU_ZONE env vars are "
            "required for the AA WU variant. Set them as Fly secrets."
        )

    body_str = json.dumps(body) if isinstance(body, dict) else body
    # WU computes Host/Content-Length itself — drop them if a caller passes
    # them, same hygiene as `bd_wu.wu_post`.
    forwarded = {
        k: v
        for k, v in headers.items()
        if k.lower() not in ("host", "content-length")
    }
    wu_envelope: dict[str, Any] = {
        "zone": zone,
        "url": url,
        "method": "POST",
        "body": body_str,
        "format": "json",
        "headers": forwarded,
    }

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
    cookie_names, body_len, body_text, body_json}`. `cookies` is a
    `{name: value}` jar (empty if WU failed); `body_json` is the body parsed
    as a dict when it's JSON, else None. Shape-tolerant — BD varies envelope
    key casing by version.
    """
    out: dict[str, Any] = {
        "cookies": {},
        "target_status": None,
        "x_brd_error": None,
        "x_brd_error_code": None,
        "cookie_names": [],
        "body_len": 0,
        "body_text": "",
        "body_json": None,
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
        out["body_text"] = body
        stripped = body.lstrip()
        if stripped.startswith(("{", "[")):
            try:
                parsed = json.loads(body)
            except (json.JSONDecodeError, ValueError):
                parsed = None
            out["body_json"] = parsed if isinstance(parsed, dict) else None
    return out


async def _mint_browser_once(try_no: int) -> tuple[dict[str, str], dict[str, Any]]:
    """One BD Browser API mint attempt: open a real headless Chromium on BD's
    farm, load the AA booking SPA, poll for `spa_session_id`, export the jar.

    A real browser (vs WU's `format=json` Set-Cookie capture) runs the SPA's
    bootstrap JS, so a client-side-set `spa_session_id` lands in
    `page.context.cookies()`. Akamai hard-denies a share of BD's exit pool,
    so the caller retries this with fresh sessions.

    Returns `(cookies, attempt_diag)` — `cookies` empty if this attempt was
    Akamai-blocked or the SPA never minted the session. `attempt_diag` is
    forensic: it records the HTTP status, final URL, full cookie-name list,
    and a body snippet so `/diag/aa_wu_last` shows exactly what happened.
    """
    attempt: dict[str, Any] = {"try": try_no, "url": _BROWSER_MINT_URL}
    cookies: dict[str, str] = {}
    try:
        async with browser_page(
            timeout_ms=120_000, use_brightdata=True
        ) as page:
            resp = await page.goto(
                _BROWSER_MINT_URL, wait_until="domcontentloaded"
            )
            attempt["http_status"] = resp.status if resp else None

            # Poll `page.context.cookies()` until BOTH `XSRF-TOKEN` and
            # `spa_session_id` are present — the SPA bootstrap sets them a
            # few seconds after DOMContentLoaded, and NOT necessarily at the
            # same instant. Breaking the moment only `spa_session_id` lands
            # would export a jar missing `XSRF-TOKEN` (AA's award POST needs
            # both — the CSRF double-submit AND the session id). Polling for
            # both lets a fast mint return early without losing a cookie.
            deadline = asyncio.get_event_loop().time() + _BROWSER_MINT_SETTLE_S
            while asyncio.get_event_loop().time() < deadline:
                try:
                    cks = await asyncio.wait_for(
                        page.context.cookies(), timeout=5.0
                    )
                    cookies = {c["name"]: c["value"] for c in cks}
                except Exception:  # noqa: BLE001 — transient CDP hiccup; retry
                    cookies = {}
                if (
                    _SPA_SESSION_COOKIE in cookies
                    and _BASE_SESSION_COOKIE in cookies
                ):
                    break
                await asyncio.sleep(2.0)

            attempt["final_url"] = page.url
            attempt["cookie_names"] = sorted(cookies.keys())
            attempt["has_xsrf"] = _BASE_SESSION_COOKIE in cookies
            attempt["has_spa_sid"] = _SPA_SESSION_COOKIE in cookies
            attempt["has_jsessionid"] = "JSESSIONID" in cookies
            try:
                body_text = await asyncio.wait_for(
                    page.locator("body").inner_text(), timeout=5.0
                )
            except Exception:  # noqa: BLE001
                body_text = ""
            # "Access Denied" is Akamai's hard-deny page — record it so a
            # run's diag distinguishes "blocked" from "rendered, no sid".
            attempt["body_head"] = body_text[:200]
            attempt["akamai_denied"] = "Access Denied" in body_text
    except Exception as exc:  # noqa: BLE001 — surface CDP/connect failures
        attempt["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        cookies = {}

    print(
        f"AA_WU: browser_api mint try #{try_no} "
        f"status={attempt.get('http_status')} cookies={len(cookies)} "
        f"xsrf={_BASE_SESSION_COOKIE in cookies} "
        f"spa_sid={_SPA_SESSION_COOKIE in cookies} "
        f"denied={attempt.get('akamai_denied')} err={attempt.get('error')!r}",
        flush=True,
    )
    return cookies, attempt


async def _mint_via_browser_api() -> tuple[dict[str, str], dict[str, Any]]:
    """BD Browser API mint rung — retries `_mint_browser_once` with fresh
    BD sessions until one mints a COMPLETE jar (both `XSRF-TOKEN` and
    `spa_session_id`), or the try budget runs out.

    Each retry gets a new exit IP from BD's pool; Akamai hard-denies a chunk
    of that pool, so a retry on a denied IP often lands a clean one. We stop
    early the moment a jar has BOTH session cookies — that's a complete
    booking-SPA session, what AA's award POST needs. A jar with only one of
    the two is kept as a fallback (`best`) but does NOT end the retry loop,
    so a later try still gets a chance at the full pair.

    Returns `(cookies, strat_diag)`. `strat_diag` mirrors a WU-GET strategy's
    diag shape (`label`, `cookie_names`, `has_spa_sid`, …) plus a `tries`
    list of per-attempt forensics, so `_mint_aa_session` can append it to
    `diag["strategies"]` uniformly.
    """
    strat: dict[str, Any] = {
        "label": "browser_api_findflights",
        "url": _BROWSER_MINT_URL,
        "transport": "bd_browser_api",
        "tries": [],
    }

    def _jar_rank(c: dict[str, str]) -> int:
        """Rank a jar for the `best`-so-far comparison: a complete session
        (both cookies) beats spa_session_id-only beats XSRF-only beats the
        rest; `len` breaks ties so a richer jar wins within a tier."""
        score = 0
        if _SPA_SESSION_COOKIE in c:
            score += 1000
        if _BASE_SESSION_COOKIE in c:
            score += 1000
        return score + len(c)

    best: dict[str, str] = {}
    for try_no in range(1, _BROWSER_MINT_MAX_TRIES + 1):
        print(
            f"AA_WU: mint attempt 'browser_api_findflights' try {try_no}/"
            f"{_BROWSER_MINT_MAX_TRIES} → BD Browser API {_BROWSER_MINT_URL}",
            flush=True,
        )
        cookies, attempt = await _mint_browser_once(try_no)
        strat["tries"].append(attempt)
        # Keep the highest-ranked jar seen so far — a partial result (only
        # one session cookie) still feeds the POST if no try mints both.
        if _jar_rank(cookies) > _jar_rank(best):
            best = cookies
        # Stop only on a COMPLETE jar; a partial keeps the loop going so a
        # later try can still land the full XSRF-TOKEN + spa_session_id pair.
        if (
            _SPA_SESSION_COOKIE in cookies
            and _BASE_SESSION_COOKIE in cookies
        ):
            break

    strat["cookie_names"] = sorted(best.keys())
    strat["has_xsrf"] = _BASE_SESSION_COOKIE in best
    strat["has_spa_sid"] = _SPA_SESSION_COOKIE in best
    strat["has_jsessionid"] = "JSESSIONID" in best
    strat["tries_used"] = len(strat["tries"])
    return best, strat


async def _mint_aa_session() -> tuple[dict[str, str], dict[str, Any]]:
    """Step 1 of the WU two-step flow: mint the best AA session cookie jar.

    The mint ladder, tried in order:

      A. Every `_MINT_STRATEGIES` entry (WU-GET, not first-match). The only
         AA URL that reliably renders via WU — `mobile.aa.com/booking` —
         mints `XSRF-TOKEN` but NOT `spa_session_id`, and a 2026-05-20
         deployed run proved that jar still gets AA error 309 on the award
         POST. The `www.aa.com` WU-GET strategy *could* mint `spa_session_id`
         but is blocked on a disabled WU zone feature (Manual Expect).
      B. BD Browser API rung (`_mint_via_browser_api`). Run ONLY when rung A
         minted no `spa_session_id` — a real headless Chromium runs the
         booking SPA's bootstrap JS, so `spa_session_id` lands in the jar.
         The 2026-05-20 probe confirmed BD Browser API renders
         `www.aa.com/booking/find-flights` and mints the full session jar.
         Gated behind rung A to avoid burning BD Browser API bandwidth when
         WU already produced a complete session.

    After both rungs, pick the best jar:

      1. First jar containing `spa_session_id` — a real booking-SPA session.
      2. Else first jar containing `XSRF-TOKEN` — the `mobile.aa.com` floor;
         lets the POST run so its error 309 is recorded as evidence rather
         than the run dying at "mint failed".
      3. Else empty — no rung minted a usable jar at all.

    Each rung's attempt is logged into `diag["strategies"]` so
    `/diag/aa_wu_last` shows exactly which AA URLs rendered, which cookies
    each minted, and why any failed (`#weeklyCarousel` timeout, captcha
    block, Akamai Access Denied, …).

    Returns `(cookies, diag)` — `cookies` empty only if every rung failed.
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

    # --- rung B: BD Browser API mint ----------------------------------
    # Run only when no WU-GET jar minted `spa_session_id` — a real headless
    # Chromium runs the booking SPA's bootstrap, which is the only way to
    # mint the SPA session (WU's `format=json` Set-Cookie capture misses a
    # client-side-set cookie, and the `www.aa.com` WU-GET strategy is blocked
    # on a disabled zone feature). Gated so a complete WU jar — if one ever
    # appears — skips the bandwidth-billed Browser API call.
    wu_has_spa = any(_SPA_SESSION_COOKIE in c for _, c in jars)
    if not wu_has_spa:
        print(
            "AA_WU: no WU-GET jar has spa_session_id — "
            "trying BD Browser API mint rung",
            flush=True,
        )
        try:
            br_cookies, br_strat = await _mint_via_browser_api()
        except Exception as exc:  # noqa: BLE001 — never let the rung crash mint
            br_cookies = {}
            br_strat = {
                "label": "browser_api_findflights",
                "transport": "bd_browser_api",
                "error": f"{type(exc).__name__}: {str(exc)[:200]}",
            }
            print(f"AA_WU: browser_api mint rung crashed: {br_strat['error']}", flush=True)
        diag["strategies"].append(br_strat)
        # Accept the Browser API jar if it carries EITHER session cookie.
        # `spa_session_id` is the cookie this rung exists to mint, so a jar
        # with it is usable even if the bootstrap hadn't set `XSRF-TOKEN`
        # yet — unlike a WU-GET jar, which is only floored on `XSRF-TOKEN`.
        if (
            _SPA_SESSION_COOKIE in br_cookies
            or _BASE_SESSION_COOKIE in br_cookies
        ):
            jars.append(("browser_api_findflights", br_cookies))
    else:
        print(
            "AA_WU: WU-GET already minted spa_session_id — "
            "skipping BD Browser API rung",
            flush=True,
        )

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
    API through WU with that session, folding in any session cookies AA
    issues on an error-309 response and retrying up to `_MAX_API_ATTEMPTS`.

    Verdict codes captured in LAST_RUN_DIAG.last_verdict:
      ok           — WU 200 with parseable AA response containing slices
      no_results   — WU 200, valid JSON, but zero rows parsed
      no_slices    — every POST got error 309 / no `slices` (session never
                     satisfied — see `attempts[].api_new_cookie_names` for
                     whether AA ever issued bootstrap cookies)
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

    # --- Step 2: POST the award API, folding in any session AA mints ---
    #
    # The minted jar (`mobile.aa.com`, lacking `spa_session_id`) gets error
    # 309 on its own. But AA's API may *issue* the missing session on that
    # first 309 response (bootstrap-on-first-call). We POST with `format=json`
    # so WU returns AA's `Set-Cookie`, fold any fresh cookies into the jar,
    # and retry — up to `_MAX_API_ATTEMPTS` POSTs. Each POST is a separate
    # `attempts[]` entry in the diag.
    payload = _build_aa_payload(origin, dest, date)
    jar = dict(cookies)  # mutable working jar — AA-minted cookies fold in here
    results: list[NormalizedResult] = []
    final_verdict = "no_slices"

    for attempt_no in range(1, _MAX_API_ATTEMPTS + 1):
        api_headers = _build_api_headers(jar)
        attempt_diag: dict[str, Any] = {
            "attempt": attempt_no,
            "endpoint": AA_API_ENDPOINT,
            "payload_size": len(str(payload)),
            "minted_via": mint_diag.get("minted_via"),
            "cookie_count": len(jar),
            "sent_xsrf": "X-XSRF-TOKEN" in api_headers,
            "spa_sid_present": _SPA_SESSION_COOKIE in jar,
        }

        try:
            wu_status, envelope = await _wu_post_json(
                url=AA_API_ENDPOINT,
                body=payload,
                headers=api_headers,
                timeout_s=120.0,  # WU can be slow on cold sessions
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

        info = _read_envelope(envelope)
        parsed = info["body_json"]
        raw_text = info["body_text"]
        # Cookies AA issued on THIS response — the prize if 309 bootstraps.
        api_cookies = info["cookies"]
        new_cookie_names = sorted(set(api_cookies) - set(jar))

        attempt_diag["wu_status"] = wu_status
        attempt_diag["target_status"] = info["target_status"]
        attempt_diag["x_brd_error_code"] = info["x_brd_error_code"]
        attempt_diag["raw_text_len"] = info["body_len"]
        attempt_diag["raw_text_head"] = raw_text[:400]  # forensic preview
        attempt_diag["json_parsed"] = parsed is not None
        attempt_diag["api_set_cookie_names"] = info["cookie_names"]
        attempt_diag["api_new_cookie_names"] = new_cookie_names
        if parsed is not None:
            attempt_diag["json_keys"] = sorted(parsed.keys())[:30]
            if "error" in parsed:
                attempt_diag["aa_error"] = str(parsed.get("error"))[:60]
            attempt_diag["has_slices"] = bool(parsed.get("slices"))
            attempt_diag["slice_count"] = len(parsed.get("slices") or [])

        print(
            f"AA_WU: POST #{attempt_no} wu={wu_status} "
            f"target={info['target_status']} parsed={parsed is not None} "
            f"aa_error={attempt_diag.get('aa_error')!r} "
            f"slices={attempt_diag.get('slice_count', 0)} "
            f"api_new_cookies={new_cookie_names}",
            flush=True,
        )

        # WU itself failed (4xx/5xx from BD, or no envelope) — abort.
        if wu_status != 200 or envelope is None:
            attempt_diag["stage"] = "wu_non_200"
            LAST_RUN_DIAG["attempts"].append(attempt_diag)
            LAST_RUN_DIAG["last_verdict"] = "wu_error"
            LAST_RUN_DIAG["row_count"] = 0
            return []

        if parsed is None:
            attempt_diag["stage"] = "api_non_json"
            LAST_RUN_DIAG["attempts"].append(attempt_diag)
            final_verdict = "api_error"
            LAST_RUN_DIAG["last_verdict"] = final_verdict
            LAST_RUN_DIAG["row_count"] = 0
            return []

        # Success — AA returned slices.
        if parsed.get("slices"):
            results = _parse_xhr(parsed, origin, dest, date)
            attempt_diag["stage"] = "parsed"
            attempt_diag["row_count"] = len(results)
            LAST_RUN_DIAG["attempts"].append(attempt_diag)
            final_verdict = "ok" if results else "no_results"
            break

        # No slices (error 309 or empty). Fold any AA-minted session cookies
        # into the jar; if AA gave us something new, the next POST may clear
        # 309. If it gave us nothing new, retrying is pointless — stop.
        attempt_diag["stage"] = "api_no_slices"
        LAST_RUN_DIAG["attempts"].append(attempt_diag)
        final_verdict = "no_slices"
        if api_cookies:
            jar.update(api_cookies)
        if not new_cookie_names:
            print(
                f"AA_WU: POST #{attempt_no} error-309 issued no new cookies "
                f"— retry would be identical, stopping",
                flush=True,
            )
            break
        print(
            f"AA_WU: POST #{attempt_no} folded {len(new_cookie_names)} "
            f"AA-minted cookie(s) into jar — retrying",
            flush=True,
        )

    LAST_RUN_DIAG["last_verdict"] = final_verdict
    LAST_RUN_DIAG["row_count"] = len(results)

    if final_verdict == "ok":
        print(
            f"AA_WU: SUCCESS ({len(results)} rows) — program_id={PROGRAM_ID} "
            f"program_name={PROGRAM_NAME}",
            flush=True,
        )
        return results

    if final_verdict == "no_results":
        print("AA_WU: parsed JSON had slices but _parse_xhr returned 0 rows", flush=True)
    return []


# Public name to mirror search.search — parent wires
#   PLUGINS["AA_AADVANTAGE_WU"] = search_wu.search
search = search_via_wu
