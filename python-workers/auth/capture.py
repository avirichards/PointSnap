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

The live-view question is RESOLVED — see `_bd_inspector_url()` and the
big comment block above it. BD's hosted DevTools inspector is not
iframe-embeddable (`X-Frame-Options: DENY`), so the cockpit live view is
a worker-side screenshot stream: `/auth/stream` (SSE of base64 JPEG
frames) + `/auth/input` (CDP input replay).

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

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from common.auth_session import cookies_meta, list_sessions, save_session

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
    # BD's hosted DevTools inspector URL — operator debug escape hatch
    # only (NOT iframe-embeddable; see _bd_inspector_url docstring).
    bd_inspector_url: str | None = None
    error: str | None = None
    # Live browser objects (Patchright/Camoufox). None after torn_down.
    # `pw` is the playwright handle returned by `async_playwright().start()`;
    # we call `pw.stop()` during teardown.
    pw: Any = None
    browser: Any = None
    context: Any = None
    page: Any = None
    # CDP session reused by the screenshot stream + input replay. Lazily
    # created on the first /auth/stream or /auth/input call.
    cdp: Any = None
    # Serializes CDP access so a screenshot capture and an input dispatch
    # don't interleave on the same CDP session.
    cdp_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
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

    # Detach the streaming CDP session before closing the context.
    try:
        if state.cdp:
            await state.cdp.detach()
    except Exception:  # noqa: BLE001
        pass
    state.cdp = None

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


# ----------------------------------------------------------------------
# Live-view — RESOLVED (see phase-2-5-live-view-research.md, Session 11+)
#
# We probed all three candidate approaches against the live BD WSS:
#
#   1. BD's `Page.inspect` CDP method. RESULT: it works, but ONLY with the
#      required `{frameId}` arg (the no-arg form returns `{url: null}`).
#      The returned URL is BD's hosted Chrome DevTools inspector at
#      `https://cdn.brightdata.com/static/devtools/<rev>/inspector.html`.
#      FATAL for embedding: that page responds with `X-Frame-Options: DENY`
#      and `Content-Security-Policy: frame-ancestors 'self'` — it CANNOT
#      be embedded in a cross-origin iframe from the cockpit. Verified via
#      `curl -IL https://cdn.brightdata.com/static/devtools/146/inspector.html`.
#   2. Raw wss via `Target.getTargetInfo` → Google's hosted DevTools.
#      RESULT: BD does not expose `webSocketDebuggerUrl` on
#      `Target.getTargetInfo` at all (`target_ws_url_present: false`), so
#      this approach has no input to work with.
#   3. Worker-side screenshot streaming + input replay. BUILT — see
#      `/auth/stream` (SSE of base64 JPEG frames captured via CDP
#      `Page.captureScreenshot`) and `/auth/input` (mouse/keyboard events
#      dispatched via CDP `Input.*`). Same-origin, full UX control, zero
#      dependency on BD's framing policy.
#
# So the cockpit live view uses approach 3. `/auth/start` no longer
# returns a BD URL — `live_view_available` is True whenever the BD page
# spun up, and the cockpit builds its own (same-origin) stream URL from
# the session_id.
# ----------------------------------------------------------------------

# Screenshot stream tuning. ~3 fps is enough for a login form (the user
# is reading + typing, not watching video); JPEG q55 keeps each frame
# ~40-90 KB at 1366×768, so ~120-270 KB/s — acceptable for a single
# one-at-a-time auth session.
STREAM_FPS = 3.0
STREAM_JPEG_QUALITY = 55
# Viewport the BD context renders at — see common/browser.py (1366×768).
# The cockpit canvas uses these to map click coordinates 1:1.
STREAM_VIEWPORT_W = 1366
STREAM_VIEWPORT_H = 768


async def _bd_inspector_url(page: Any) -> str | None:
    """Resolve Bright Data's hosted Chrome DevTools inspector URL for this
    page via the `Page.inspect` CDP method.

    NOTE: this URL is NOT iframe-embeddable (BD serves the inspector with
    `X-Frame-Options: DENY`). We keep this helper because the URL is still
    useful as a developer-debug escape hatch — surfaced in `/auth/status`
    as `bd_inspector_url` so an operator can open the raw BD DevTools in a
    browser tab to debug a stuck session. The user-facing flow uses the
    `/auth/stream` screenshot stream instead.

    BD's API requires the `frameId` arg — the no-arg form returns
    `{url: null}`. We fetch it via `Page.getFrameTree` first.
    """
    try:
        cdp = await page.context.new_cdp_session(page)
        ftree = await cdp.send("Page.getFrameTree")
        frame = ((ftree or {}).get("frameTree") or {}).get("frame") or {}
        frame_id = frame.get("id")
        if not frame_id:
            return None
        result = await cdp.send("Page.inspect", {"frameId": frame_id})
        if isinstance(result, dict):
            url = result.get("url") or result.get("inspectorUrl")
            if url and isinstance(url, str) and url.startswith("http"):
                return url
    except Exception as exc:  # noqa: BLE001
        log.info("auth_capture: BD Page.inspect lookup failed: %s", exc)
    return None


async def _get_stream_cdp(state: AuthSessionState) -> Any:
    """Lazily create (and cache) the CDP session used by the screenshot
    stream + input replay. Returns None when the page is gone."""
    if state.cdp is not None:
        return state.cdp
    page = state.page
    if not page:
        return None
    try:
        state.cdp = await page.context.new_cdp_session(page)
    except Exception as exc:  # noqa: BLE001
        log.warning("auth_capture: stream CDP session create failed: %s", exc)
        return None
    return state.cdp


async def _capture_frame(state: AuthSessionState) -> str | None:
    """Capture one JPEG screenshot of the live page, base64-encoded.

    Uses CDP `Page.captureScreenshot` rather than Playwright's
    `page.screenshot()` because the BD page is reached over CDP and the
    raw CDP call is lower-overhead for a tight ~3 fps loop. Returns the
    base64 string (no data-URI prefix) or None on failure.
    """
    cdp = await _get_stream_cdp(state)
    if cdp is None:
        return None
    try:
        async with state.cdp_lock:
            result = await cdp.send(
                "Page.captureScreenshot",
                {
                    "format": "jpeg",
                    "quality": STREAM_JPEG_QUALITY,
                    "captureBeyondViewport": False,
                },
            )
        data = result.get("data") if isinstance(result, dict) else None
        return data if isinstance(data, str) and data else None
    except Exception as exc:  # noqa: BLE001
        log.debug("auth_capture: frame capture failed: %s", exc)
        return None


# Cockpit input-event "type" → CDP dispatch. Mouse buttons follow the CDP
# enum ("none"|"left"|"middle"|"right").
_KEY_EVENT_TYPES = {"keyDown", "keyUp", "rawKeyDown", "char"}
_MOUSE_EVENT_TYPES = {"mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"}


async def _dispatch_input(state: AuthSessionState, ev: dict) -> bool:
    """Forward one cockpit input event to the BD page via CDP `Input.*`.

    Event shapes the cockpit sends (see LiveSessionView):
      mouse:  {kind:"mouse", type:"mousePressed"|"mouseReleased"|
               "mouseMoved"|"mouseWheel", x, y, button?, deltaX?, deltaY?,
               clickCount?, modifiers?}
      key:    {kind:"key", type:"keyDown"|"keyUp"|"char", key?, code?,
               text?, keyCode?, modifiers?}
      text:   {kind:"text", text:"..."}  — bulk paste / IME commit

    Returns True if the event dispatched cleanly.
    """
    cdp = await _get_stream_cdp(state)
    if cdp is None:
        return False
    kind = ev.get("kind")
    try:
        async with state.cdp_lock:
            if kind == "mouse":
                etype = ev.get("type")
                if etype not in _MOUSE_EVENT_TYPES:
                    return False
                params: dict = {
                    "type": etype,
                    "x": float(ev.get("x") or 0),
                    "y": float(ev.get("y") or 0),
                    "modifiers": int(ev.get("modifiers") or 0),
                }
                if etype == "mouseWheel":
                    params["deltaX"] = float(ev.get("deltaX") or 0)
                    params["deltaY"] = float(ev.get("deltaY") or 0)
                else:
                    params["button"] = ev.get("button") or "left"
                    params["clickCount"] = int(ev.get("clickCount") or 1)
                await cdp.send("Input.dispatchMouseEvent", params)
                return True
            if kind == "key":
                etype = ev.get("type")
                if etype not in _KEY_EVENT_TYPES:
                    return False
                params = {
                    "type": etype,
                    "modifiers": int(ev.get("modifiers") or 0),
                }
                if ev.get("key"):
                    params["key"] = str(ev["key"])
                if ev.get("code"):
                    params["code"] = str(ev["code"])
                if ev.get("keyCode") is not None:
                    kc = int(ev["keyCode"])
                    params["windowsVirtualKeyCode"] = kc
                    params["nativeVirtualKeyCode"] = kc
                if ev.get("text"):
                    params["text"] = str(ev["text"])
                await cdp.send("Input.dispatchKeyEvent", params)
                return True
            if kind == "text":
                text = ev.get("text")
                if not text:
                    return False
                await cdp.send("Input.insertText", {"text": str(text)})
                return True
    except Exception as exc:  # noqa: BLE001
        log.debug("auth_capture: input dispatch failed (%s): %s", kind, exc)
        return False
    return False


def _sse(obj: dict) -> str:
    """Format one dict as an SSE `data:` frame."""
    return f"data: {json.dumps(obj, separators=(',', ':'))}\n\n"


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
@router.get("/_diag/live_view_probe")
async def auth_diag_live_view_probe() -> JSONResponse:
    """TEMPORARY diagnostic — open a BD browser, navigate to a trivial page,
    and dump exactly what BD's CDP returns for the live-view methods so we
    can wire the right call. Tries:
      1. Page.getFrameTree -> Page.inspect{frameId}
      2. Page.inspect with no args
      3. Target.getTargetInfo (raw wss)
    REMOVE once the live-view approach is finalized."""
    import traceback

    out: dict = {}
    state = AuthSessionState(
        session_id=_gen_session_id(),
        user_id="00000000-0000-0000-0000-000000000000",
        program_id="_diag",
        state="awaiting_login",
        started_at=_now(),
        expires_at_unix=_now() + 120,
    )
    try:
        pw, browser, context, page = await _open_bd_browser(
            session_label=state.session_id, timeout_ms=60_000
        )
        state.pw, state.browser, state.context, state.page = pw, browser, context, page
        try:
            await page.goto("https://example.com", wait_until="domcontentloaded", timeout=30_000)
        except Exception as exc:  # noqa: BLE001
            out["goto_error"] = str(exc)[:200]

        # Method A: getFrameTree -> inspect{frameId}
        try:
            cdp = await context.new_cdp_session(page)
            ftree = await cdp.send("Page.getFrameTree")
            frame = ((ftree or {}).get("frameTree") or {}).get("frame") or {}
            frame_id = frame.get("id")
            out["frame_id"] = frame_id
            insp = await cdp.send("Page.inspect", {"frameId": frame_id})
            out["inspect_with_frameid"] = {
                "keys": list(insp.keys()) if isinstance(insp, dict) else None,
                "raw": insp,
            }
        except Exception as exc:  # noqa: BLE001
            out["inspect_with_frameid_error"] = f"{type(exc).__name__}: {str(exc)[:300]}"

        # Method B: inspect with no args
        try:
            cdp2 = await context.new_cdp_session(page)
            insp2 = await cdp2.send("Page.inspect")
            out["inspect_no_args"] = insp2
        except Exception as exc:  # noqa: BLE001
            out["inspect_no_args_error"] = f"{type(exc).__name__}: {str(exc)[:300]}"

        # Method C: Target.getTargetInfo (raw wss)
        try:
            cdp3 = await context.new_cdp_session(page)
            tinfo = await cdp3.send("Target.getTargetInfo")
            ti = (tinfo or {}).get("targetInfo") or {}
            out["target_info_keys"] = list(ti.keys())
            out["target_ws_url_present"] = bool(ti.get("webSocketDebuggerUrl"))
        except Exception as exc:  # noqa: BLE001
            out["target_info_error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
    except Exception as exc:  # noqa: BLE001
        out["fatal"] = f"{type(exc).__name__}: {str(exc)[:300]}"
        out["tb"] = traceback.format_exc()[-800:]
    finally:
        await _close_bd_browser(state)
    return JSONResponse(out)


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

    # Live view is the worker's own screenshot stream (approach 3 — the
    # BD inspector URL is not iframe-embeddable). The cockpit builds the
    # actual stream URL itself from session_id; `live_view_available` is
    # True whenever we have a live page to stream. We also resolve BD's
    # hosted DevTools inspector URL purely as an operator debug aid (it's
    # surfaced in /status, never shown to the user).
    state.bd_inspector_url = await _bd_inspector_url(page)
    try:
        live_view_available = page is not None and not page.is_closed()
    except Exception:  # noqa: BLE001
        live_view_available = page is not None
    # Relative path the cockpit proxies — its own /api/auth/airline/stream
    # forwards to the worker /auth/stream. Kept relative so it works for
    # any cockpit origin (preview deploys included).
    state.live_view_url = (
        f"/api/auth/airline/stream?sessionId={session_id}"
        if live_view_available
        else None
    )

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
            "live_view_url": state.live_view_url or "TBD",
            "live_view_available": live_view_available,
            "live_view_kind": "stream",
            "viewport": {"w": STREAM_VIEWPORT_W, "h": STREAM_VIEWPORT_H},
            "bd_inspector_url": state.bd_inspector_url,
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
        "bd_inspector_url": state.bd_inspector_url,
        "expires_at_unix": state.expires_at_unix,
        "started_at_unix": state.started_at,
    }
    if state.error:
        payload["error"] = state.error
    if state.stored_row_id:
        payload["stored_row_id"] = state.stored_row_id

    return JSONResponse(payload)


@router.get("/stream")
async def auth_stream(
    request: Request,
    session_id: str = Query(..., description="Returned by /auth/start"),
) -> StreamingResponse:
    """Server-Sent-Events stream of the live BD page as base64 JPEG frames.

    The cockpit's `<LiveSessionView>` opens an EventSource on this (via the
    `/api/auth/airline/stream` proxy) and paints each frame onto a canvas.
    SSE is used over a raw WebSocket because it proxies cleanly through the
    Next.js API route without WS-upgrade handling, and the search route
    already establishes the SSE pattern in this codebase.

    Event types emitted (each an SSE `data:` line of JSON):
      {"t":"frame","b64":"<jpeg>","w":1366,"h":768}
      {"t":"url","url":"https://..."}            — page navigated
      {"t":"state","state":"captured"|...}        — terminal; cockpit stops
      {"t":"bye","reason":"..."}                  — stream closing

    The loop ends when: the session leaves `awaiting_login`, the session
    is torn down / gone, or the client disconnects.
    """
    state = ACTIVE_SESSIONS.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="unknown session_id")

    async def _gen():
        frame_interval = 1.0 / STREAM_FPS
        last_url: str | None = None
        last_state = state.state
        try:
            while True:
                if await request.is_disconnected():
                    break
                cur = ACTIVE_SESSIONS.get(session_id)
                if not cur or cur.state == "torn_down" or not cur.page:
                    yield _sse({"t": "bye", "reason": "session_gone"})
                    break

                # Surface a navigation change so the cockpit can update its
                # address chip.
                try:
                    page_url = cur.page.url
                except Exception:  # noqa: BLE001
                    page_url = None
                if page_url and page_url != last_url:
                    last_url = page_url
                    yield _sse({"t": "url", "url": page_url})

                # Surface a terminal state transition (login captured /
                # failed / expired) then stop streaming.
                if cur.state != last_state:
                    last_state = cur.state
                    yield _sse({"t": "state", "state": cur.state})
                if cur.state != "awaiting_login":
                    yield _sse({"t": "bye", "reason": f"state:{cur.state}"})
                    break

                frame = await _capture_frame(cur)
                if frame:
                    yield _sse(
                        {
                            "t": "frame",
                            "b64": frame,
                            "w": STREAM_VIEWPORT_W,
                            "h": STREAM_VIEWPORT_H,
                        }
                    )
                await asyncio.sleep(frame_interval)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("auth_capture/stream: generator error: %s", exc)
            yield _sse({"t": "bye", "reason": "error"})

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/input")
async def auth_input(
    request: Request,
    session_id: str = Query(..., description="Returned by /auth/start"),
) -> JSONResponse:
    """Forward a batch of cockpit input events to the live BD page.

    Body: {"events": [<event>, ...]} — see `_dispatch_input` for event
    shapes. Batched so the cockpit can coalesce rapid mousemoves into one
    request. Returns the count dispatched.
    """
    state = ACTIVE_SESSIONS.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="unknown session_id")
    if state.state != "awaiting_login" or not state.page:
        raise HTTPException(
            status_code=409,
            detail=f"session not interactive (state={state.state})",
        )

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid JSON body")

    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="body.events must be a list")

    dispatched = 0
    for ev in events[:200]:  # cap per request — defends against a flood
        if isinstance(ev, dict) and await _dispatch_input(state, ev):
            dispatched += 1

    return JSONResponse({"ok": True, "dispatched": dispatched})


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


@router.get("/connected")
async def auth_connected(
    user_id: str = Query(
        ...,
        description=(
            "Authenticated user UUID from the cockpit SSR session. The "
            "cockpit's /api/auth/airline/connected proxy forwards this."
        ),
    ),
) -> JSONResponse:
    """List the user's saved auth sessions — one row per connected program.

    The cockpit `/airlines` page renders each program's status (connected /
    expiring / expired) from this. We never decrypt cookies here; only
    non-secret metadata (program_id, expiry, last-use) leaves the DB.
    """
    try:
        uuid.UUID(user_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="user_id must be a valid UUID")

    rows = await list_sessions(user_id)
    return JSONResponse({"rows": rows})
