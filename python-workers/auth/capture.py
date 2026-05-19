"""Worker endpoints for the Phase 2.5 user-initiated auth-capture flow.

User journey (cockpit-side, owned by another agent — see plan §"Phase 2.5"):
  1. User clicks **Connect <Airline>** in `/airlines`.
  2. Cockpit POSTs `/auth/start?program=AC_AEROPLAN` to this worker.
  3. Worker spins up a fresh Bright Data Browser API session, navigates
     to the airline's login page, returns `{ session_id, live_view_url }`.
  4. Cockpit iframes `live_view_url`. User types creds + MFA with their
     own keyboard.
  5. Cockpit polls `/auth/status?session_id=...` every 2s.
  6. Worker watches the page for a "logged in" signal (URL substring +
     positive DOM marker). On detection, captures cookies, stores
     encrypted in `program_auth_sessions`, transitions state to `captured`.
  7. Cockpit closes the modal and POSTs `/auth/finalize?session_id=...`
     (also called on timeout / explicit cancel) — tears down the BD
     session.

The hard part is the live-view URL — see `_get_live_view_url()` and
`tasks/scraper-research/phase-2-5-live-view-research.md`.

This module holds live BD browser handles in process memory across HTTP
requests. **Do not run multiple worker replicas without sticky routing**
— `/auth/start` and `/auth/status`/`/auth/finalize` for the same
session_id MUST land on the same instance. For Fly.io: pin via session-
affinity headers or run a single machine for the auth router. (Phase 2.5
only needs one user at a time per program; this is fine.)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from common.auth_session import cookies_meta, save_session

log = logging.getLogger(__name__)

router = APIRouter()


# ----------------------------------------------------------------------
# Per-program config
#
# Sourced from Phase 0 Agent 5's `agent-5-auth-viability.md`. For each
# airline we record:
#   - login_url:          where to land the user (post-warmup)
#   - success_url_match:  substring that, when present in page URL,
#                          indicates a successful login
#   - success_dom_check:  optional CSS selector to confirm via DOM
#                          (positive marker: account-summary widget,
#                          sign-out link, etc.)
#   - cookie_ttl_hours:   how long to consider the captured cookies
#                          "fresh" — feeds program_auth_sessions.expires_at
#
# Programs marked anon-OK in the agent report are intentionally excluded
# (AS Mileage Plan, AM Aeromexico, EY Etihad Guest) — they don't need
# T5'. The user shouldn't see Connect buttons for those.
# ----------------------------------------------------------------------
@dataclass(frozen=True)
class ProgramAuthConfig:
    label: str
    login_url: str
    success_url_match: tuple[str, ...]
    success_dom_check: str | None = None
    cookie_ttl_hours: int = 24
    # Optional warmup before login_url to mint sensor cookies (Akamai
    # programs).
    warmup_url: str | None = None


PROGRAM_AUTH: dict[str, ProgramAuthConfig] = {
    "AC_AEROPLAN": ProgramAuthConfig(
        label="Air Canada Aeroplan",
        login_url="https://www.aircanada.com/ca/en/aco/home/aeroplan.html",
        success_url_match=("/aco/home/aeroplan/your-aeroplan", "/account.html"),
        cookie_ttl_hours=24,
        warmup_url="https://www.aircanada.com/",
    ),
    "UA_MP": ProgramAuthConfig(
        label="United MileagePlus",
        login_url="https://www.united.com/en/us/account-page",
        success_url_match=("/en/us/mileageplus/account-summary", "/account-page"),
        cookie_ttl_hours=24,
        warmup_url="https://www.united.com/",
    ),
    "LH_MILES_MORE": ProgramAuthConfig(
        label="Lufthansa Miles & More",
        login_url="https://www.miles-and-more.com/row/en/login.html",
        success_url_match=("/row/en/profile.html", "/account.html"),
        cookie_ttl_hours=24,
        warmup_url="https://www.miles-and-more.com/",
    ),
    "SK_EUROBONUS": ProgramAuthConfig(
        label="SAS EuroBonus",
        login_url="https://www.flysas.com/en/eurobonus/account/",
        success_url_match=("/en/eurobonus/account",),
        cookie_ttl_hours=24,
    ),
    "BA_AVIOS": ProgramAuthConfig(
        label="British Airways Executive Club",
        login_url="https://www.britishairways.com/travel/loggedinhome/execclub/_gf/en_us",
        success_url_match=("/travel/loggedinhome/execclub", "/executive-club"),
        cookie_ttl_hours=24,
        warmup_url="https://www.britishairways.com/",
    ),
    "AF_FLYINGBLUE": ProgramAuthConfig(
        label="Air France / KLM Flying Blue",
        login_url="https://www.flyingblue.com/en/account.html",
        success_url_match=("/account.html", "/account/dashboard"),
        cookie_ttl_hours=24,
    ),
    "DL_SKYMILES": ProgramAuthConfig(
        label="Delta SkyMiles",
        login_url="https://www.delta.com/login",
        success_url_match=("/skymiles/profile", "/login-redirect"),
        cookie_ttl_hours=24,
    ),
    "CX_CATHAY": ProgramAuthConfig(
        label="Cathay Pacific Asia Miles",
        login_url="https://www.cathaypacific.com/cx/en_US/sign-in.html",
        success_url_match=("/membership.html", "/cx/en_US/cathay-account"),
        cookie_ttl_hours=24,
    ),
    "TK_MILES_SMILES": ProgramAuthConfig(
        label="Turkish Miles&Smiles",
        login_url="https://www.turkishairlines.com/en-us/miles-and-smiles/",
        success_url_match=("/miles-and-smiles/",),
        cookie_ttl_hours=24,
    ),
    "NH_ANA": ProgramAuthConfig(
        label="ANA Mileage Club",
        login_url="https://www.ana.co.jp/en/us/amc/",
        success_url_match=("/asw/", "/amc/"),
        cookie_ttl_hours=24,
    ),
    "AV_LIFEMILES": ProgramAuthConfig(
        label="Avianca LifeMiles",
        login_url="https://www.lifemiles.com/Account/Login",
        success_url_match=("/Plan/MyAccount", "/Account/"),
        cookie_ttl_hours=24,
    ),
    "VS_FLYING_CLUB": ProgramAuthConfig(
        label="Virgin Atlantic Flying Club",
        login_url="https://flywith.virginatlantic.com/account/",
        success_url_match=("/flying-club/dashboard", "/account/"),
        cookie_ttl_hours=24,
    ),
    "AA_AADVANTAGE": ProgramAuthConfig(
        label="American AAdvantage",
        login_url="https://www.aa.com/login.do",
        success_url_match=("/aadvantage-program/profile/", "/account-summary"),
        cookie_ttl_hours=24,
        warmup_url="https://www.aa.com/",
    ),
}


# ----------------------------------------------------------------------
# In-memory session registry
#
# `ACTIVE_SESSIONS[session_id]` keeps the live Patchright/Camoufox handles
# alive across HTTP requests. Keyed by a server-generated UUID; the
# session_id is opaque to the cockpit (it's just a token to correlate
# /start ↔ /status ↔ /finalize).
#
# State machine:
#   awaiting_login -> captured     (good outcome)
#   awaiting_login -> failed       (per-program signal not seen)
#   awaiting_login -> expired      (TTL elapsed; user walked away)
#   *              -> torn_down    (after /auth/finalize cleanup)
#
# We don't garbage-collect dead sessions on a timer (the watcher coroutine
# transitions to `expired`); /auth/finalize is responsible for the actual
# browser teardown so we don't accidentally pay for BD bandwidth on
# orphaned sessions.
# ----------------------------------------------------------------------
@dataclass
class AuthSessionState:
    session_id: str
    user_id: str
    program_id: str
    state: str  # "awaiting_login" | "captured" | "failed" | "expired" | "torn_down"
    started_at: float
    expires_at_unix: float
    live_view_url: str | None = None
    error: str | None = None
    # Live browser objects (Patchright/Camoufox). None after torn_down.
    # `pw` is the playwright handle returned by `async_playwright().start()`;
    # we call `pw.stop()` during teardown.
    pw: Any = None
    browser: Any = None
    context: Any = None
    page: Any = None
    # Background coroutine that watches the page for login signal.
    watcher_task: asyncio.Task | None = field(default=None, repr=False)
    # On success, populated with the row id in program_auth_sessions.
    stored_row_id: str | None = None


ACTIVE_SESSIONS: dict[str, AuthSessionState] = {}

# How long to leave a `/auth/start` session alive before auto-expiring.
SESSION_MAX_TTL_SEC = 5 * 60

# How long the captured cookies are considered "fresh" before we ask the
# user to reconnect. Per-program override via ProgramAuthConfig.
DEFAULT_COOKIE_TTL_HOURS = 24


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def _now() -> float:
    return time.time()


def _gen_session_id() -> str:
    """Server-side opaque ID. UUID4 for collision resistance."""
    return str(uuid.uuid4())


def _redact_for_log(d: dict) -> dict:
    """Hide cookie values when logging — names are fine, values aren't."""
    out = dict(d)
    if "cookies" in out:
        out["cookies"] = f"<{len(out['cookies'])} cookies redacted>"
    return out


async def _open_bd_browser(session_label: str, timeout_ms: int = 60_000):
    """Open a fresh BD Browser API session and return (pw, browser, ctx,
    page). Mirrors `common/browser.py`'s BD branch but doesn't wrap in an
    async-context-manager — we hold handles across HTTP requests.

    Caller MUST eventually call `_close_bd_browser(state)` to free BD
    bandwidth.
    """
    wss_url = os.environ.get("BRIGHTDATA_WSS_URL")
    if not wss_url:
        raise RuntimeError("BRIGHTDATA_WSS_URL env var not configured")

    # Inject a sticky session id so the same exit IP is held for ~10min
    # idle. Lets sensor.js fingerprint stay stable across the login flow.
    sticky = re.sub(r"[^A-Za-z0-9]", "", session_label)[:24]
    wss_url_sticky = re.sub(
        r"(brd-customer-[^:@/]+):",
        rf"\1-session-{sticky}:",
        wss_url,
        count=1,
    )

    from patchright.async_api import async_playwright

    # Use the start/stop API rather than async-with because we hold the
    # handles across HTTP requests. `start()` returns the same `pw` object
    # that the `async with` form yields; `stop()` shuts it down cleanly.
    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(wss_url_sticky, timeout=timeout_ms)

    # Reuse the default BD context — BD pre-warms a single browser context
    # with their stealth tuning. Creating a fresh one drops that, which
    # increases sensor-detection risk.
    ctxs = browser.contexts
    if ctxs:
        context = ctxs[0]
    else:
        context = await browser.new_context()

    pages = context.pages
    if pages:
        page = pages[0]
    else:
        page = await context.new_page()

    page.set_default_timeout(timeout_ms)

    # For auth-capture we do NOT block stylesheets/images. The login form
    # needs the full CSS layout for the user to see what they're typing
    # into. Bandwidth cost is acceptable — one search-equivalent per
    # session at most.

    return pw, browser, context, page


async def _close_bd_browser(state: AuthSessionState) -> None:
    """Tear down the BD browser handles in `state`. Safe to call twice."""
    # Cancel watcher first so it doesn't fire after teardown.
    if state.watcher_task and not state.watcher_task.done():
        state.watcher_task.cancel()
        try:
            await state.watcher_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    state.watcher_task = None

    try:
        if state.context:
            await state.context.close()
    except Exception:  # noqa: BLE001
        pass
    state.context = None

    try:
        if state.browser:
            await state.browser.close()
    except Exception:  # noqa: BLE001
        pass
    state.browser = None

    try:
        if state.pw:
            await state.pw.stop()
    except Exception:  # noqa: BLE001
        pass
    state.pw = None

    state.page = None
    state.state = "torn_down"


async def _get_live_view_url(page: Any) -> str | None:
    """Try to resolve a user-embeddable live-view URL for a BD CDP page.

    Bright Data exposes the live-view in (at least) two documented ways:

      1. CDP `Page.inspect` method returns `{inspectorUrl: "..."}` — a
         pre-baked Chrome DevTools URL that proxies through BD's frontend
         (`https://api.brightdata.com/...?devtoolsId=...`). Embeddable in
         an iframe directly.

      2. CDP `Target.getTargetInfo` returns `webSocketDebuggerUrl` (the
         raw wss endpoint). We can construct the DevTools URL ourselves:
         `https://chrome-devtools-frontend.appspot.com/serve_file/<rev>/inspector.html?ws=<wss-url>`
         — but this hits Google's hosted devtools and won't bypass BD's
         IP whitelist if they enforce one.

    We try (1) first. On any failure, we fall back to (2). On total
    failure, return None — the cockpit will display "TBD" and the user
    can still log in via a popup window if we surface the wss_url
    separately. See `tasks/scraper-research/phase-2-5-live-view-research.md`
    for the longer-term answer.
    """
    # Method 1: BD's `Page.inspect` extension to CDP.
    try:
        cdp = await page.context.new_cdp_session(page)
        result = await cdp.send("Page.inspect")
        if isinstance(result, dict):
            url = (
                result.get("inspectorUrl")
                or result.get("url")
                or result.get("inspector_url")
            )
            if url and isinstance(url, str) and url.startswith("http"):
                log.info(
                    "auth_capture: live-view URL via Page.inspect: %s",
                    url[:80],
                )
                return url
    except Exception as exc:  # noqa: BLE001
        log.info("auth_capture: Page.inspect failed: %s", exc)

    # Method 2: Construct from Target.getTargetInfo.
    try:
        cdp = await page.context.new_cdp_session(page)
        info = await cdp.send("Target.getTargetInfo")
        target_info = info.get("targetInfo") or {}
        ws_url = target_info.get("webSocketDebuggerUrl")
        if ws_url:
            # We don't have the devtools-frontend revision pinned; use
            # the public hosted version. Note: this depends on BD allowing
            # cross-origin iframes from chrome-devtools-frontend.appspot.com.
            # If they block it, the cockpit will see a blank iframe and
            # we'll need to switch to streaming screenshots (the WebRTC
            # approach noted in the research doc).
            frontend = (
                "https://chrome-devtools-frontend.appspot.com"
                f"/serve_internal_file/@latest/inspector.html?wss={ws_url.replace('wss://', '')}"
            )
            log.info(
                "auth_capture: live-view URL via constructed DevTools: %s",
                frontend[:120],
            )
            return frontend
    except Exception as exc:  # noqa: BLE001
        log.info("auth_capture: Target.getTargetInfo fallback failed: %s", exc)

    log.warning(
        "auth_capture: no live-view URL available — both Page.inspect "
        "and Target.getTargetInfo failed. See "
        "tasks/scraper-research/phase-2-5-live-view-research.md"
    )
    return None


async def _watcher(state: AuthSessionState, cfg: ProgramAuthConfig) -> None:
    """Background coroutine: poll the page URL every 1s for a success
    match. On detection, dump cookies, save to DB, transition state to
    `captured`. On overall TTL expiry, transition to `expired`.

    Runs until either:
      - the page is torn down (page becomes None / closed)
      - the session_id is dropped from ACTIVE_SESSIONS (defensive)
      - state.state moves out of `awaiting_login`
    """
    POLL_INTERVAL_SEC = 1.0
    try:
        while True:
            await asyncio.sleep(POLL_INTERVAL_SEC)

            if state.session_id not in ACTIVE_SESSIONS:
                log.info(
                    "auth_capture watcher: session %s gone from registry, exiting",
                    state.session_id,
                )
                return

            if state.state != "awaiting_login":
                return  # someone else moved us out of the watch state

            # TTL check
            if _now() >= state.expires_at_unix:
                state.state = "expired"
                state.error = "session_max_ttl"
                log.info(
                    "auth_capture watcher: session %s expired (ttl=%ds)",
                    state.session_id,
                    SESSION_MAX_TTL_SEC,
                )
                return

            page = state.page
            if not page:
                return

            try:
                cur_url = page.url or ""
            except Exception:  # noqa: BLE001
                # Page closed under us — treat as failure.
                state.state = "failed"
                state.error = "page_closed"
                return

            # Match any of the success substrings.
            if any(sub in cur_url for sub in cfg.success_url_match):
                # Optional positive DOM check.
                if cfg.success_dom_check:
                    try:
                        loc = page.locator(cfg.success_dom_check)
                        await loc.first.wait_for(state="visible", timeout=5_000)
                    except Exception:  # noqa: BLE001
                        # Selector miss — not yet logged in despite URL
                        # match (e.g. session-timeout intermediate page).
                        continue

                # Capture cookies.
                try:
                    raw_cookies = await page.context.cookies()
                except Exception as exc:  # noqa: BLE001
                    log.warning(
                        "auth_capture watcher: cookie dump failed: %s",
                        exc,
                    )
                    state.state = "failed"
                    state.error = f"cookie_dump:{exc}"
                    return

                expires_dt = datetime.now(timezone.utc) + timedelta(
                    hours=cfg.cookie_ttl_hours or DEFAULT_COOKIE_TTL_HOURS
                )
                meta = cookies_meta(raw_cookies)
                meta["login_url_seen"] = cur_url
                meta["program_label"] = cfg.label

                row_id = await save_session(
                    user_id=state.user_id,
                    program_id=state.program_id,
                    cookies=raw_cookies,
                    expires_at=expires_dt.isoformat(),
                    meta=meta,
                )
                if not row_id:
                    state.state = "failed"
                    state.error = "db_save_failed"
                    return

                state.stored_row_id = row_id
                state.state = "captured"
                log.info(
                    "auth_capture watcher: session %s captured (program=%s, "
                    "cookies=%d, row=%s)",
                    state.session_id,
                    state.program_id,
                    len(raw_cookies),
                    row_id,
                )
                return
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("auth_capture watcher: unexpected error: %s", exc)
        state.state = "failed"
        state.error = f"watcher_crash:{exc!r}"


# ----------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------
@router.post("/start")
async def auth_start(
    program: str = Query(..., description="Program ID, e.g. AC_AEROPLAN"),
    user_id: str = Query(
        ...,
        description=(
            "Authenticated user UUID from the cockpit SSR session. The "
            "cockpit MUST pass this — the worker has no auth context of "
            "its own. We rely on the cockpit's network being internal."
        ),
    ),
) -> JSONResponse:
    """Open a fresh Bright Data Browser API session for the user to log
    in. Returns the opaque session_id + live-view URL for the cockpit to
    iframe.
    """
    cfg = PROGRAM_AUTH.get(program)
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail=f"program={program!r} is not registered for auth capture",
        )

    try:
        uuid.UUID(user_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="user_id must be a valid UUID",
        )

    session_id = _gen_session_id()
    state = AuthSessionState(
        session_id=session_id,
        user_id=user_id,
        program_id=program,
        state="awaiting_login",
        started_at=_now(),
        expires_at_unix=_now() + SESSION_MAX_TTL_SEC,
    )

    try:
        pw, browser, context, page = await _open_bd_browser(
            session_label=session_id,
            timeout_ms=60_000,
        )
        state.pw = pw
        state.browser = browser
        state.context = context
        state.page = page
    except Exception as exc:  # noqa: BLE001
        log.exception("auth_capture/start: BD browser open failed")
        raise HTTPException(
            status_code=502,
            detail=f"bd_browser_open_failed: {exc!s}"[:300],
        ) from exc

    ACTIVE_SESSIONS[session_id] = state

    # Optional warmup before the login page — Akamai-fronted sites need
    # the homepage to mint sensor cookies before the login form will
    # render correctly. We deliberately don't await long here so the
    # cockpit gets the live_view_url quickly.
    nav_url = cfg.login_url
    try:
        if cfg.warmup_url:
            try:
                await page.goto(
                    cfg.warmup_url,
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )
                await asyncio.sleep(2.0)
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "auth_capture/start: warmup nav failed (continuing): %s",
                    exc,
                )

        await page.goto(nav_url, wait_until="domcontentloaded", timeout=45_000)
    except Exception as exc:  # noqa: BLE001
        log.exception("auth_capture/start: nav to login page failed")
        # Don't kill the session here — the user can refresh in the iframe.
        state.error = f"initial_nav_failed:{exc!s}"[:200]

    # Resolve the live-view URL. If it fails we still keep the session
    # alive and let the cockpit display its "trouble loading live view"
    # state; the open question is captured in
    # tasks/scraper-research/phase-2-5-live-view-research.md.
    live_view_url = await _get_live_view_url(page)
    state.live_view_url = live_view_url

    # Kick off the watcher.
    state.watcher_task = asyncio.create_task(_watcher(state, cfg))

    expires_at_iso = datetime.fromtimestamp(
        state.expires_at_unix, tz=timezone.utc
    ).isoformat()

    return JSONResponse(
        {
            "session_id": session_id,
            "program_id": program,
            "program_label": cfg.label,
            "live_view_url": live_view_url or "TBD",
            "live_view_available": live_view_url is not None,
            "state": state.state,
            "expires_at": expires_at_iso,
            "current_url": (page.url if page else None),
        }
    )


@router.get("/status")
async def auth_status(
    session_id: str = Query(..., description="Returned by /auth/start"),
) -> JSONResponse:
    """Poll endpoint. Cockpit calls this every ~2s.

    Returns:
      state:        awaiting_login | captured | failed | expired | torn_down
      current_url:  best-effort page.url for cockpit debugging
      error:        optional error string when state in (failed, expired)
      stored_row_id: program_auth_sessions row UUID when state == captured
    """
    state = ACTIVE_SESSIONS.get(session_id)
    if not state:
        return JSONResponse(
            {"state": "unknown", "session_id": session_id}, status_code=404
        )

    cur_url = None
    try:
        if state.page:
            cur_url = state.page.url
    except Exception:  # noqa: BLE001
        cur_url = None

    payload: dict = {
        "session_id": session_id,
        "program_id": state.program_id,
        "state": state.state,
        "current_url": cur_url,
        "live_view_url": state.live_view_url,
        "expires_at_unix": state.expires_at_unix,
        "started_at_unix": state.started_at,
    }
    if state.error:
        payload["error"] = state.error
    if state.stored_row_id:
        payload["stored_row_id"] = state.stored_row_id

    return JSONResponse(payload)


@router.post("/finalize")
async def auth_finalize(
    session_id: str = Query(..., description="Returned by /auth/start"),
    force_capture: int = Query(
        0,
        description=(
            "1 = capture cookies even if watcher hasn't yet seen the "
            "success URL. Use when the user manually clicks 'I'm done' "
            "in the cockpit — sometimes the airline's post-login URL "
            "doesn't match any of our hardcoded substrings."
        ),
    ),
) -> JSONResponse:
    """Tear down the BD session. If `force_capture=1`, dump cookies first
    (last-chance capture even without a verified success signal)."""
    state = ACTIVE_SESSIONS.get(session_id)
    if not state:
        return JSONResponse(
            {"state": "unknown", "session_id": session_id}, status_code=404
        )

    cfg = PROGRAM_AUTH.get(state.program_id)
    force_result: dict | None = None
    if force_capture and state.state == "awaiting_login" and state.page:
        try:
            raw_cookies = await state.page.context.cookies()
            expires_dt = datetime.now(timezone.utc) + timedelta(
                hours=(cfg.cookie_ttl_hours if cfg else DEFAULT_COOKIE_TTL_HOURS)
            )
            meta = cookies_meta(raw_cookies)
            meta["program_label"] = cfg.label if cfg else state.program_id
            meta["forced"] = True
            meta["login_url_seen"] = state.page.url
            row_id = await save_session(
                user_id=state.user_id,
                program_id=state.program_id,
                cookies=raw_cookies,
                expires_at=expires_dt.isoformat(),
                meta=meta,
            )
            if row_id:
                state.stored_row_id = row_id
                state.state = "captured"
                force_result = {"ok": True, "row_id": row_id, "cookies": len(raw_cookies)}
            else:
                state.state = "failed"
                state.error = "force_capture_db_save_failed"
                force_result = {"ok": False, "reason": "db_save_failed"}
        except Exception as exc:  # noqa: BLE001
            log.warning("auth_capture/finalize: force_capture failed: %s", exc)
            state.state = "failed"
            state.error = f"force_capture_crash:{exc!s}"[:200]
            force_result = {"ok": False, "reason": str(exc)[:200]}

    # Always tear down (even if force_capture failed — keeping the BD
    # session alive would only waste bandwidth).
    final_state = state.state
    stored_row_id = state.stored_row_id
    await _close_bd_browser(state)

    # Keep the entry around in `torn_down` state for ~5min so a late
    # /auth/status poll returns a friendly result rather than 404.
    # (We could schedule deletion, but the registry stays small for our
    # one-user-at-a-time use case.)

    return JSONResponse(
        {
            "session_id": session_id,
            "state": state.state,
            "final_state_before_teardown": final_state,
            "stored_row_id": stored_row_id,
            "force_capture": force_result,
        }
    )
