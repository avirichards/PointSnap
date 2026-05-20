"""Worker endpoints for the user-initiated auth-capture flow.

User journey (cockpit-side, owned by another agent — built against the
SAME contract documented below):
  1. User clicks **Connect <Airline>** in `/airlines`.
  2. Cockpit collects the user's airline email + password in PointSnap's
     own form and POSTs `/auth/start?program=AC_AEROPLAN&user_id=...`
     with `{"username","password"}` in the JSON body.
  3. Worker creates an in-memory session and launches a background task
     that opens a Bright Data Browser API session, navigates to the
     airline login page, and **fills the login form itself** (typing the
     credentials with a human-like per-character delay). It returns the
     opaque `session_id` immediately, state `working`.
  4. Cockpit polls `/auth/status?session_id=...` every ~2s. The status
     payload carries the current state plus a SINGLE JPEG still
     (`screenshot_b64`) refreshed at each decision point — NOT a video
     stream. The user never types into a remote browser.
  5. If the airline challenges MFA, the worker pauses at state
     `mfa_required` and scrapes any human prompt text. The cockpit shows
     the still + prompt, collects a code, and POSTs `/auth/mfa`.
  6. The worker fills the code, submits, and resumes outcome detection.
  7. On a verified login the worker captures all cookies, stores them
     encrypted in `program_auth_sessions` (along with the password,
     encrypted into Vault), and transitions to `captured`.
  8. Cockpit closes the modal and POSTs `/auth/finalize?session_id=...`
     (also on timeout / explicit cancel) — tears down the BD session.

State machine:
    working -> (mfa_required -> working)* -> captured
                                          |  invalid_credentials
                                          |  failed
                                          |  expired

This module holds live BD browser handles in process memory across HTTP
requests. **Do not run multiple worker replicas without sticky routing**
— `/auth/start`, `/auth/status`, `/auth/mfa`, `/auth/finalize` for the
same session_id MUST land on the same instance. For Fly.io: pin via
session-affinity or run a single machine for the auth router. (This flow
only needs one user at a time per program; this is fine.)

SECURITY: the user's password lives ONLY in the in-memory session state
for the lifetime of the login attempt. It is encrypted into Supabase
Vault on a successful capture and is NEVER written to logs or to any
non-Vault column. The username is likewise never logged.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from common.auth_session import cookies_meta, list_sessions, save_session

log = logging.getLogger(__name__)

router = APIRouter()


# ----------------------------------------------------------------------
# Per-program config
#
# For each airline we record:
#   - login_url:          where the worker navigates to log in
#   - success_url_match:  substrings that, when present in page URL,
#                          indicate a successful login
#   - success_dom_check:  optional CSS selector to confirm via DOM
#                          (positive marker: account widget, sign-out
#                          link, etc.)
#   - cookie_ttl_hours:   how long to consider the captured cookies
#                          "fresh" — feeds program_auth_sessions.expires_at
#   - warmup_url:         optional warmup before login_url to mint sensor
#                          cookies (Akamai-fronted programs)
#   - *_selector:         the form selectors the worker fills. The worker
#                          tries each selector in the (comma-joined) list
#                          and uses the first that resolves to a visible
#                          element — robustness against framework-
#                          generated IDs that drift between deploys.
#   - error_selector:     selectors whose visible presence (with text)
#                          means an authentication error (wrong password).
#   - mfa_marker_selector: selectors whose presence means the page is on
#                          an MFA / one-time-code step.
#   - mfa_prompt_selector: selectors to scrape human MFA prompt text from.
#
# Programs marked anon-OK upstream are intentionally excluded — they
# don't need a login and the cockpit shouldn't show Connect buttons.
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
    # --- Login-form selectors (comma-joined fallback lists) -----------
    username_selector: str = ""
    password_selector: str = ""
    submit_selector: str = ""
    # --- Outcome-detection selectors ----------------------------------
    error_selector: str = ""
    mfa_marker_selector: str = ""
    mfa_prompt_selector: str = ""
    # --- MFA verification-page selectors ------------------------------
    mfa_code_selector: str = ""
    mfa_submit_selector: str = ""


# Generic auth-error selectors appended to every program's error_selector.
# Most airline login forms render a role="alert" / aria-live region on a
# bad password; these catch the common shapes so a per-program list only
# needs the airline-specific extras.
_GENERIC_ERROR_SELECTORS = (
    '[role="alert"]',
    '[aria-live="assertive"]',
    ".error-message",
    ".form-error",
    ".alert-danger",
    ".validation-error",
)

# Generic MFA-page markers — inputs/labels that strongly indicate a
# one-time-code step. Appended to every program's mfa_marker_selector.
_GENERIC_MFA_MARKERS = (
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[name*="verification" i]',
    'input[id*="otp" i]',
    'input[id*="verification" i]',
    'input[name*="securityCode" i]',
)


def _selectors(*lists: str) -> list[str]:
    """Flatten one or more comma-joined selector strings into a de-duped,
    order-preserving list. Empty pieces are dropped."""
    out: list[str] = []
    seen: set[str] = set()
    for piece in lists:
        if not piece:
            continue
        for sel in piece.split(","):
            sel = sel.strip()
            if sel and sel not in seen:
                seen.add(sel)
                out.append(sel)
    return out


PROGRAM_AUTH: dict[str, ProgramAuthConfig] = {
    "AC_AEROPLAN": ProgramAuthConfig(
        label="Air Canada Aeroplan",
        login_url="https://www.aircanada.com/signin",
        # NB: AC puts `isAuth=true` on the *pre-login* sign-in page too, so
        # it is NOT a success marker — only genuinely post-login paths here.
        success_url_match=(
            "/aco/home/aeroplan/your-aeroplan",
            "/customer-profile",
        ),
        cookie_ttl_hours=24,
        warmup_url="https://www.aircanada.com/",
        # NEEDS-VERIFICATION selectors — see module-level note in the
        # accompanying report. Air Canada's sign-in is a JS-rendered
        # Angular widget; the available /diag/inputs harness snapshots the
        # page before that widget renders, so these were inferred from Air
        # Canada's known login-form structure ("Aeroplan number or email"
        # text field, "Password" field, "Sign in" button). They are
        # deliberately broad — robust label/placeholder/autocomplete-based
        # locators plus likely id/name fallbacks — and the fill logic
        # tries each in turn and uses the first visible match.
        username_selector=(
            "input#enrollmentNumber,"
            "input[name='enrollmentNumber'],"
            "input#emailAddress,"
            "input[name='emailAddress'],"
            "input[name='username'],"
            "input[autocomplete='username'],"
            "input[placeholder*='Aeroplan' i],"
            "input[placeholder*='email' i],"
            "input[aria-label*='Aeroplan' i],"
            "input[aria-label*='email' i]"
        ),
        password_selector=(
            "input#password,"
            "input[name='password'],"
            "input[type='password'],"
            "input[autocomplete='current-password'],"
            "input[aria-label*='password' i]"
        ),
        submit_selector=(
            "button#login-button,"
            "button[name='signin'],"
            "button[type='submit'],"
            "button[aria-label*='Sign in' i],"
            "input[type='submit']"
        ),
        error_selector=(
            ".acsi-error,"
            ".signin-error,"
            "[class*='error'][class*='message']"
        ),
        mfa_marker_selector=(
            "input[name*='code' i],"
            "input[id*='code' i],"
            "input[name*='otp' i]"
        ),
        mfa_prompt_selector=(
            "[class*='verification'],"
            "[class*='mfa'],"
            "main h1,"
            "main h2,"
            "[role='dialog'] h1,"
            "[role='dialog'] h2"
        ),
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],"
            "input[name*='code' i],"
            "input[id*='code' i],"
            "input[name*='otp' i],"
            "input[type='tel']"
        ),
        mfa_submit_selector=(
            "button[type='submit'],"
            "button[aria-label*='Verify' i],"
            "button[aria-label*='Submit' i],"
            "input[type='submit']"
        ),
    ),
    "UA_MP": ProgramAuthConfig(
        label="United MileagePlus",
        login_url="https://www.united.com/en/us/account-page",
        success_url_match=("/en/us/mileageplus/account-summary", "/account-page"),
        cookie_ttl_hours=24,
        warmup_url="https://www.united.com/",
        username_selector=(
            "input#username,input[name='username'],"
            "input[autocomplete='username'],input[type='email']"
        ),
        password_selector=(
            "input#password,input[name='password'],"
            "input[type='password'],input[autocomplete='current-password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "LH_MILES_MORE": ProgramAuthConfig(
        label="Lufthansa Miles & More",
        login_url="https://www.miles-and-more.com/row/en/login.html",
        success_url_match=("/row/en/profile.html", "/account.html"),
        cookie_ttl_hours=24,
        warmup_url="https://www.miles-and-more.com/",
        username_selector=(
            "input#username,input[name='username'],"
            "input[autocomplete='username'],input[type='text']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "SK_EUROBONUS": ProgramAuthConfig(
        label="SAS EuroBonus",
        login_url="https://www.flysas.com/en/eurobonus/account/",
        success_url_match=("/en/eurobonus/account",),
        cookie_ttl_hours=24,
        username_selector=(
            "input#username,input[name='username'],input[type='email']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "BA_AVIOS": ProgramAuthConfig(
        label="British Airways Executive Club",
        login_url="https://www.britishairways.com/travel/loggedinhome/execclub/_gf/en_us",
        success_url_match=("/travel/loggedinhome/execclub", "/executive-club"),
        cookie_ttl_hours=24,
        warmup_url="https://www.britishairways.com/",
        username_selector=(
            "input#membership-number,input[name='membershipNumber'],"
            "input[name='username'],input[type='text']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "AF_FLYINGBLUE": ProgramAuthConfig(
        label="Air France / KLM Flying Blue",
        login_url="https://www.flyingblue.com/en/account.html",
        success_url_match=("/account.html", "/account/dashboard"),
        cookie_ttl_hours=24,
        username_selector=(
            "input#username,input[name='username'],input[type='email']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "DL_SKYMILES": ProgramAuthConfig(
        label="Delta SkyMiles",
        login_url="https://www.delta.com/login",
        success_url_match=("/skymiles/profile", "/login-redirect"),
        cookie_ttl_hours=24,
        username_selector=(
            "input#username,input[name='userId'],input[name='username'],"
            "input[type='text']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "CX_CATHAY": ProgramAuthConfig(
        label="Cathay Pacific Asia Miles",
        login_url="https://www.cathaypacific.com/cx/en_US/sign-in.html",
        success_url_match=("/membership.html", "/cx/en_US/cathay-account"),
        cookie_ttl_hours=24,
        username_selector=(
            "input#username,input[name='username'],input[type='email']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "TK_MILES_SMILES": ProgramAuthConfig(
        label="Turkish Miles&Smiles",
        login_url="https://www.turkishairlines.com/en-us/miles-and-smiles/",
        success_url_match=("/miles-and-smiles/",),
        cookie_ttl_hours=24,
        username_selector=(
            "input#username,input[name='username'],input[type='text']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "NH_ANA": ProgramAuthConfig(
        label="ANA Mileage Club",
        login_url="https://www.ana.co.jp/en/us/amc/",
        success_url_match=("/asw/", "/amc/"),
        cookie_ttl_hours=24,
        username_selector=(
            "input#username,input[name='username'],input[type='text']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "AV_LIFEMILES": ProgramAuthConfig(
        label="Avianca LifeMiles",
        login_url="https://www.lifemiles.com/Account/Login",
        success_url_match=("/Plan/MyAccount", "/Account/"),
        cookie_ttl_hours=24,
        username_selector=(
            "input#username,input[name='username'],input[type='text']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "VS_FLYING_CLUB": ProgramAuthConfig(
        label="Virgin Atlantic Flying Club",
        login_url="https://flywith.virginatlantic.com/account/",
        success_url_match=("/flying-club/dashboard", "/account/"),
        cookie_ttl_hours=24,
        username_selector=(
            "input#username,input[name='username'],input[type='email']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
    "AA_AADVANTAGE": ProgramAuthConfig(
        label="American AAdvantage",
        login_url="https://www.aa.com/login.do",
        success_url_match=("/aadvantage-program/profile/", "/account-summary"),
        cookie_ttl_hours=24,
        warmup_url="https://www.aa.com/",
        username_selector=(
            "input#cidEnrollment,input[name='loginId'],"
            "input[name='username'],input[type='text']"
        ),
        password_selector=(
            "input#password,input[name='password'],input[type='password']"
        ),
        submit_selector="button[type='submit'],input[type='submit']",
        mfa_marker_selector="input[name*='code' i],input[id*='code' i]",
        mfa_prompt_selector="main h1,main h2,[role='dialog'] h1,[role='dialog'] h2",
        mfa_code_selector=(
            "input[autocomplete='one-time-code'],input[name*='code' i],"
            "input[id*='code' i],input[type='tel']"
        ),
        mfa_submit_selector="button[type='submit'],input[type='submit']",
    ),
}


# ----------------------------------------------------------------------
# Session state
# ----------------------------------------------------------------------
# Public state values surfaced to the cockpit (see contract):
#   working              login in progress / resuming after MFA
#   mfa_required         airline asked for a one-time code; awaiting /auth/mfa
#   captured             verified login; cookies + password stored
#   invalid_credentials  airline rejected the username/password
#   failed               an error prevented capture (error field set)
#   expired              session TTL elapsed before completion
#
# Internal-only: `torn_down` after /auth/finalize cleanup. /auth/status
# maps `torn_down` back to the last meaningful public state where it can,
# but a finalize that runs after `captured` keeps reporting `captured`.
STATE_WORKING = "working"
STATE_MFA_REQUIRED = "mfa_required"
STATE_CAPTURED = "captured"
STATE_INVALID = "invalid_credentials"
STATE_FAILED = "failed"
STATE_EXPIRED = "expired"
STATE_TORN_DOWN = "torn_down"

# Terminal states — the login task has finished, nothing more will change
# the outcome.
_TERMINAL_STATES = frozenset(
    {STATE_CAPTURED, STATE_INVALID, STATE_FAILED, STATE_EXPIRED}
)


@dataclass
class AuthSessionState:
    """In-memory record for one auth-capture attempt.

    Keyed by a server-generated UUID in `ACTIVE_SESSIONS`. Holds the live
    Patchright/Bright-Data handles plus the public-facing state the
    cockpit polls. The user's `password` lives here and ONLY here until it
    is encrypted into Vault on a successful capture — it is never logged
    and never written to a non-Vault column.
    """

    session_id: str
    user_id: str
    program_id: str
    state: str
    started_at: float
    expires_at_unix: float
    # Credentials supplied by the user. Secret — never log these.
    username: str = ""
    password: str = ""
    # Human MFA prompt text scraped from the airline page, when available.
    mfa_prompt: str | None = None
    # Single JPEG still (base64, no data: prefix) of the current page,
    # refreshed at each decision point. NOT a stream.
    screenshot_b64: str | None = None
    # Best-effort current page URL for cockpit display.
    current_url: str | None = None
    # Error string when state == "failed".
    error: str | None = None
    # Live browser objects (Patchright over Bright Data). None after
    # teardown. `pw` is the playwright handle from
    # `async_playwright().start()`; we call `pw.stop()` during teardown.
    pw: Any = None
    browser: Any = None
    context: Any = None
    page: Any = None
    # Background coroutine running the login + outcome-detection flow.
    login_task: asyncio.Task | None = field(default=None, repr=False)
    # Set by /auth/mfa: the code the user submitted. The login task picks
    # this up, fills it, and clears the event for any subsequent round.
    mfa_code: str | None = field(default=None, repr=False)
    mfa_code_event: asyncio.Event = field(
        default_factory=asyncio.Event, repr=False
    )
    # On success, the row id in program_auth_sessions.
    stored_row_id: str | None = None


ACTIVE_SESSIONS: dict[str, AuthSessionState] = {}

# How long to leave a `/auth/start` session alive before auto-expiring.
# Generous enough to cover a slow BD-browser open + a real login + the
# user fetching an MFA code from their phone or email.
SESSION_MAX_TTL_SEC = 10 * 60

# Fallback cookie freshness when a program omits an override.
DEFAULT_COOKIE_TTL_HOURS = 24

# Screenshot tuning — a single still captured at each decision point.
SCREENSHOT_WIDTH = 1280
SCREENSHOT_JPEG_QUALITY = 70

# Outcome-detection polling.
_DETECT_POLL_SEC = 1.0
# How long to watch for an outcome after submitting credentials before
# giving up. Bounded by SESSION_MAX_TTL_SEC anyway; this just caps a
# single detection round.
_DETECT_TIMEOUT_SEC = 75.0


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def _now() -> float:
    return time.time()


def _gen_session_id() -> str:
    """Server-side opaque ID. UUID4 for collision resistance."""
    return str(uuid.uuid4())


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

    # For auth-capture we do NOT block stylesheets/images — the login form
    # needs full CSS layout so the screenshot still is legible to the user
    # if we need to surface it. Bandwidth cost is acceptable: one
    # search-equivalent per session at most.

    return pw, browser, context, page


async def _close_bd_browser(state: AuthSessionState) -> None:
    """Tear down the BD browser handles in `state`. Safe to call twice."""
    # Cancel the login task first so it doesn't fire after teardown.
    if state.login_task and not state.login_task.done():
        state.login_task.cancel()
        try:
            await state.login_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    state.login_task = None

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
    # Preserve a meaningful terminal state — once captured/failed/etc. the
    # finalize teardown shouldn't erase the outcome the cockpit may still
    # poll for. Only a session torn down mid-flight reports `torn_down`.
    if state.state not in _TERMINAL_STATES:
        state.state = STATE_TORN_DOWN


def _frames(page: Any) -> list:
    """Every frame of a page — top document first, then any iframes.
    Login widgets (Gigya, Auth0, etc.) are frequently rendered inside an
    iframe, so all form interaction searches frames, not just the top
    document. Falls back to [page] if the frame list can't be read."""
    try:
        return list(page.frames)
    except Exception:  # noqa: BLE001
        return [page]


async def _first_visible(page: Any, selectors: list[str], timeout_ms: int):
    """Return the first locator from `selectors` that becomes visible
    within `timeout_ms` (shared budget across the whole list), or None.
    Searches the top document AND every child frame.

    We poll each selector cheaply rather than `wait_for` on each (a
    `wait_for` per selector would multiply the timeout). This is the
    robustness primitive behind every form interaction: framework-
    generated IDs drift, so we always carry a fallback list.
    """
    deadline = _now() + (timeout_ms / 1000.0)
    while _now() < deadline:
        for frame in _frames(page):
            loc = await _frame_first_visible(frame, selectors)
            if loc is not None:
                return loc
        await asyncio.sleep(0.25)
    return None


async def _any_visible_with_text(page: Any, selectors: list[str]) -> str | None:
    """If any selector resolves — on the top document or any child frame
    — to a visible element with non-empty text, return that text (trimmed,
    collapsed). Used for error detection — an empty `role=alert` container
    doesn't count as an error."""
    for frame in _frames(page):
        for sel in selectors:
            try:
                loc = frame.locator(sel)
                n = await loc.count()
            except Exception:  # noqa: BLE001
                continue
            for i in range(min(n, 20)):
                try:
                    cand = loc.nth(i)
                    if not await cand.is_visible():
                        continue
                    txt = (await cand.inner_text()) or ""
                    txt = re.sub(r"\s+", " ", txt).strip()
                    if txt:
                        return txt
                except Exception:  # noqa: BLE001
                    continue
    return None


async def _any_present(page: Any, selectors: list[str]) -> bool:
    """True if any selector resolves to a visible element on the top
    document or any child frame."""
    for frame in _frames(page):
        if await _frame_first_visible(frame, selectors) is not None:
            return True
    return False


def _looks_like_auth_error(text: str) -> bool:
    """Heuristic: does this alert/banner text describe a credential
    rejection (as opposed to an unrelated cookie/marketing banner)?"""
    t = text.lower()
    needles = (
        "incorrect",
        "invalid",
        "not recognized",
        "not recognised",
        "wrong",
        "does not match",
        "doesn't match",
        "no account",
        "could not sign",
        "couldn't sign",
        "unable to sign",
        "try again",
        "password",
        "credentials",
        "locked",
    )
    return any(n in t for n in needles)


async def _capture_screenshot(state: AuthSessionState) -> None:
    """Capture a single JPEG still of the current page into
    `state.screenshot_b64` (base64, no data: prefix). Best-effort —
    failures are swallowed (the cockpit just shows no still).

    Called at every decision point: after the form loads, after submit,
    when MFA is detected, on terminal outcomes.
    """
    page = state.page
    if not page:
        return
    try:
        raw = await page.screenshot(type="jpeg", quality=SCREENSHOT_JPEG_QUALITY)
        state.screenshot_b64 = base64.b64encode(raw).decode("ascii")
    except Exception as exc:  # noqa: BLE001
        log.debug("auth_capture: screenshot capture failed: %s", exc)


def _update_current_url(state: AuthSessionState) -> None:
    """Refresh `state.current_url` from the live page (best-effort)."""
    page = state.page
    if not page:
        return
    try:
        state.current_url = page.url or state.current_url
    except Exception:  # noqa: BLE001
        pass


def _rand_int(lo: int, hi: int) -> int:
    """Inclusive uniform int in [lo, hi] using the `secrets` module —
    avoids importing `random` just for human-interaction jitter."""
    import secrets as _secrets

    return lo + _secrets.randbelow(hi - lo + 1)


def _human_type_delay() -> float:
    """A per-character typing delay in ms — humans don't type at a fixed
    rate. ~60-140ms range; passed to Patchright `locator.type(delay=)`."""
    return float(_rand_int(60, 140))


async def _is_success(page: Any, cfg: ProgramAuthConfig) -> bool:
    """True if the page is at a verified post-login state: URL matches one
    of `success_url_match` AND (if set) the `success_dom_check` selector is
    visible."""
    try:
        cur_url = page.url or ""
    except Exception:  # noqa: BLE001
        return False
    if not any(sub in cur_url for sub in cfg.success_url_match):
        return False
    if cfg.success_dom_check:
        try:
            loc = page.locator(cfg.success_dom_check).first
            await loc.wait_for(state="visible", timeout=5_000)
        except Exception:  # noqa: BLE001
            return False
    return True


async def _save_capture(
    state: AuthSessionState, cfg: ProgramAuthConfig, cur_url: str
) -> bool:
    """Dump cookies, persist the encrypted session (cookies + password),
    and move `state` to `captured`. Returns True on success; on failure
    sets `state` to `failed` and returns False.
    """
    page = state.page
    if not page:
        state.state = STATE_FAILED
        state.error = "page_gone_before_capture"
        return False

    try:
        raw_cookies = await page.context.cookies()
    except Exception as exc:  # noqa: BLE001
        log.warning("auth_capture: cookie dump failed: %s", exc)
        state.state = STATE_FAILED
        state.error = f"cookie_dump:{exc}"
        return False

    expires_dt = datetime.now(timezone.utc) + timedelta(
        hours=cfg.cookie_ttl_hours or DEFAULT_COOKIE_TTL_HOURS
    )
    meta = cookies_meta(raw_cookies)
    meta["login_url_seen"] = cur_url
    meta["program_label"] = cfg.label

    # Persist cookies AND the password (encrypted into Vault). The password
    # is passed straight through to save_session — it never touches a log
    # line or a non-Vault column.
    row_id = await save_session(
        user_id=state.user_id,
        program_id=state.program_id,
        cookies=raw_cookies,
        expires_at=expires_dt.isoformat(),
        meta=meta,
        password=state.password or None,
    )
    if not row_id:
        state.state = STATE_FAILED
        state.error = "db_save_failed"
        return False

    state.stored_row_id = row_id
    state.state = STATE_CAPTURED
    log.info(
        "auth_capture: session %s captured (program=%s, cookies=%d, row=%s)",
        state.session_id,
        state.program_id,
        len(raw_cookies),
        row_id,
    )
    return True


async def _scrape_mfa_prompt(page: Any, cfg: ProgramAuthConfig) -> str | None:
    """Best-effort scrape of the human-readable MFA prompt text from the
    airline verification page, e.g. "Enter the code sent to •••1234".
    Returns the first reasonably-short, non-empty match, or None."""
    selectors = _selectors(cfg.mfa_prompt_selector)
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if not await loc.is_visible():
                continue
            txt = (await loc.inner_text()) or ""
            txt = re.sub(r"\s+", " ", txt).strip()
            # Skip empty / huge blobs — we want the actual prompt line.
            if txt and 4 <= len(txt) <= 300:
                return txt
        except Exception:  # noqa: BLE001
            continue
    return None


async def _detect_outcome(
    state: AuthSessionState, cfg: ProgramAuthConfig
) -> str:
    """Poll the page after a credential / MFA submit and classify the
    outcome. Returns one of:
      "success"  — verified post-login page reached
      "invalid"  — an authentication error is shown
      "mfa"      — the page is on an MFA / one-time-code step
      "timeout"  — none of the above within the detection window

    Does NOT mutate `state.state` for success/mfa/timeout — the caller
    decides. For "invalid" the caller likewise transitions; we keep this
    pure so the login loop stays readable.
    """
    error_selectors = _selectors(cfg.error_selector, *_GENERIC_ERROR_SELECTORS)
    mfa_selectors = _selectors(cfg.mfa_marker_selector, *_GENERIC_MFA_MARKERS)

    deadline = _now() + _DETECT_TIMEOUT_SEC
    while _now() < deadline:
        # Hard stop if the overall session TTL elapsed.
        if _now() >= state.expires_at_unix:
            return "timeout"

        page = state.page
        if not page:
            return "timeout"

        # 1. Success wins outright.
        if await _is_success(page, cfg):
            return "success"

        # 2. An MFA code field present (and no success) → MFA step.
        #    Checked before the error heuristic because some airlines
        #    render a benign info banner on the MFA page that the error
        #    heuristic could misread.
        if await _any_present(page, mfa_selectors):
            return "mfa"

        # 3. A visible error banner whose text reads like a credential
        #    rejection → invalid credentials.
        err_text = await _any_visible_with_text(page, error_selectors)
        if err_text and _looks_like_auth_error(err_text):
            return "invalid"

        await asyncio.sleep(_DETECT_POLL_SEC)

    return "timeout"


# Generic text-ish input selector for the username fallback — a username
# field is text / email / tel (or untyped); never password / hidden /
# checkbox. `:visible` on each part so a hidden pre-rendered duplicate is
# never matched. The password field is found separately and is the anchor.
_TEXTISH_INPUT = (
    "input[type='text']:visible, input[type='email']:visible, "
    "input[type='tel']:visible, input:not([type]):visible"
)


async def _frame_first_visible(frame: Any, selectors: list[str]):
    """A locator for the first VISIBLE element matching any of `selectors`
    in this frame. Uses Playwright's `:visible` pseudo so the returned
    locator RE-RESOLVES to a currently-visible element on every action —
    robust against a widget re-rendering (Gigya) between find and fill,
    and against pre-rendered hidden duplicate screens. None if no selector
    currently has a visible match."""
    for sel in selectors:
        try:
            loc = frame.locator(f"{sel}:visible")
            if await loc.count() > 0:
                return loc.first
        except Exception:  # noqa: BLE001
            continue
    return None


async def _frame_first_textish_input(frame: Any):
    """A locator for the first visible text / email / tel / untyped input
    in a frame — the generic username-field fallback used when no
    configured selector matches the login form."""
    try:
        loc = frame.locator(_TEXTISH_INPUT)
        if await loc.count() > 0:
            return loc.first
    except Exception:  # noqa: BLE001
        return None
    return None


async def _find_credential_inputs(
    page: Any, cfg: ProgramAuthConfig, timeout_ms: int
):
    """Locate (username, password, submit) for a login form, searching
    the top document and every child frame.

    The password input is the anchor: a login page has exactly one, and
    `input[type=password]` is unambiguous regardless of framework-drifted
    names / ids or an iframe wrapper. Once the password field's frame is
    known, the username is a configured selector OR the first visible
    text-ish input in that same frame, and submit is a configured
    selector OR a generic submit control.

    Returns (user_loc, pass_loc, submit_loc). submit_loc may be None —
    the caller falls back to pressing Enter. user/pass are None only when
    no login form surfaced within the timeout.
    """
    user_sels = _selectors(cfg.username_selector)
    pass_sels = _selectors(cfg.password_selector, "input[type='password']")
    submit_sels = _selectors(
        cfg.submit_selector, "button[type='submit']", "input[type='submit']"
    )
    deadline = _now() + (timeout_ms / 1000.0)
    while _now() < deadline:
        for frame in _frames(page):
            pass_loc = await _frame_first_visible(frame, pass_sels)
            if pass_loc is None:
                continue
            # The password field pins the form's frame. Resolve the
            # username from a configured hint, else the first text-ish
            # input in this same frame.
            user_loc = await _frame_first_visible(frame, user_sels)
            if user_loc is None:
                user_loc = await _frame_first_textish_input(frame)
            if user_loc is None:
                continue
            submit_loc = await _frame_first_visible(frame, submit_sels)
            return user_loc, pass_loc, submit_loc
        await asyncio.sleep(0.3)
    return None, None, None


async def _dump_frame_inputs(page: Any) -> str:
    """A short per-frame inventory of every input — recorded in the error
    payload when no login form was found, so the next debugging pass sees
    the real DOM (field names, and which frame they live in)."""
    parts: list[str] = []
    for fi, frame in enumerate(_frames(page)):
        try:
            inv = await frame.evaluate(
                """() => Array.from(document.querySelectorAll('input'))
                    .slice(0, 20)
                    .map(el => (el.type || 'text') + ':'
                        + (el.name || el.id || el.getAttribute('aria-label') || '?'))
                    .join(', ')"""
            )
            parts.append(f"f{fi}[{inv or 'no-inputs'}]")
        except Exception:  # noqa: BLE001
            parts.append(f"f{fi}[eval-failed]")
    return " ".join(parts)[:400]


async def _robust_fill(loc: Any, value: str) -> tuple[bool, str]:
    """Set `value` on an input. Tries Locator.fill() first; if that times
    out — a widget input can be briefly non-actionable, or re-render under
    us — falls back to a direct JS value-set + input/change events, which
    bypasses Playwright's actionability wait entirely. Returns
    (ok, detail); detail names the method used or the failure reason. The
    value itself is never logged."""
    try:
        await loc.fill(value, timeout=10_000)
        return True, "fill"
    except Exception as exc:  # noqa: BLE001
        fill_err = type(exc).__name__
    try:
        await loc.evaluate(
            "(el, v) => { el.focus(); el.value = v;"
            " el.dispatchEvent(new Event('input', { bubbles: true }));"
            " el.dispatchEvent(new Event('change', { bubbles: true })); }",
            value,
        )
        log.info(
            "auth_capture: fill() failed (%s) — JS value-set fallback used",
            fill_err,
        )
        return True, f"js(after {fill_err})"
    except Exception as exc:  # noqa: BLE001
        return False, f"fill={fill_err},js={type(exc).__name__}"


async def _fill_and_submit_credentials(
    state: AuthSessionState, cfg: ProgramAuthConfig
) -> bool:
    """Fill the username + password into the login form and submit.
    Returns True if the form was filled and submitted, False if the login
    form could not be located (caller transitions to a sensible state).

    The password is typed with a human-like per-character delay and is
    never logged.
    """
    page = state.page
    if not page:
        return False

    # Locate the form — anchored on the password field, searching every
    # frame. SPA login pages (Air Canada's Gigya widget included) render
    # the form only after their JS bundle boots, so allow a generous
    # window.
    user_loc, pass_loc, submit_loc = await _find_credential_inputs(
        page, cfg, timeout_ms=45_000
    )
    if user_loc is None or pass_loc is None:
        # No login form surfaced. Record the real DOM inventory so the
        # next debugging pass can see the actual field names / frames.
        inv = await _dump_frame_inputs(page)
        log.warning(
            "auth_capture: login form not found for %s — inputs: %s",
            state.program_id,
            inv,
        )
        state.error = f"login_form_not_found inputs={inv}"
        return False

    # Fill the fields. _robust_fill() tries Locator.fill() (focus + clear
    # + set + `input` event, no pointer hit-test so an overlapping
    # floating label is harmless) and, if that times out — a widget input
    # can be briefly non-actionable or re-render under us — falls back to
    # a direct JS value-set. The username / password value is never
    # logged.
    ok, detail = await _robust_fill(user_loc, state.username)
    if not ok:
        log.warning(
            "auth_capture: username fill failed for %s (%s)",
            state.program_id, detail,
        )
        state.error = f"username_fill_failed:{detail}"
        return False

    # Small human pause between fields.
    await asyncio.sleep(_rand_int(200, 600) / 1000.0)

    ok, detail = await _robust_fill(pass_loc, state.password)
    if not ok:
        log.warning(
            "auth_capture: password fill failed for %s (%s)",
            state.program_id, detail,
        )
        state.error = f"password_fill_failed:{detail}"
        return False

    await asyncio.sleep(_rand_int(200, 500) / 1000.0)

    # Submit — prefer the resolved submit control; on any failure fall
    # back to pressing Enter in the password field.
    submitted = False
    if submit_loc is not None:
        try:
            await submit_loc.click()
            submitted = True
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "auth_capture: submit click failed (%s) — trying Enter",
                type(exc).__name__,
            )
    if not submitted:
        try:
            await pass_loc.press("Enter")
        except Exception as exc:  # noqa: BLE001
            log.warning("auth_capture: submit via Enter failed: %s", exc)
            state.error = f"credential_submit_failed:{type(exc).__name__}"
            return False

    return True


async def _fill_and_submit_mfa(
    state: AuthSessionState, cfg: ProgramAuthConfig, code: str
) -> bool:
    """Fill the one-time code into the airline verification page and
    submit. Returns True on a clean fill+submit, False if the code field
    could not be found."""
    page = state.page
    if not page:
        return False

    code_loc = await _first_visible(
        page, _selectors(cfg.mfa_code_selector, *_GENERIC_MFA_MARKERS),
        timeout_ms=15_000,
    )
    if code_loc is None:
        return False

    ok, _detail = await _robust_fill(code_loc, code)
    if not ok:
        log.warning("auth_capture: MFA code fill failed for %s", state.program_id)
        return False

    await asyncio.sleep(_rand_int(200, 500) / 1000.0)

    submit_loc = await _first_visible(
        page, _selectors(cfg.mfa_submit_selector), timeout_ms=8_000
    )
    submitted = False
    if submit_loc is not None:
        try:
            await submit_loc.click()
            submitted = True
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "auth_capture: MFA submit click failed (%s) — trying Enter",
                type(exc).__name__,
            )
    if not submitted:
        try:
            await code_loc.press("Enter")
        except Exception as exc:  # noqa: BLE001
            log.warning("auth_capture: MFA submit via Enter failed: %s", exc)
            return False

    return True


async def _login_task(state: AuthSessionState, cfg: ProgramAuthConfig) -> None:
    """Background coroutine that drives the whole login: open the browser,
    navigate, fill the form, detect the outcome, handle any MFA rounds,
    and persist on success.

    State transitions: working → (mfa_required → working)* → captured |
    invalid_credentials | failed | expired. Never raises out — every
    failure path sets a terminal `state` + (for `failed`) an `error`.

    The BD browser is opened HERE (not in /auth/start) so /auth/start can
    return immediately. On any terminal outcome the browser is torn down
    so we never burn BD bandwidth on a finished session.
    """
    try:
        # --- Open the browser --------------------------------------------
        try:
            pw, browser, context, page = await _open_bd_browser(
                session_label=state.session_id, timeout_ms=60_000
            )
            state.pw = pw
            state.browser = browser
            state.context = context
            state.page = page
        except Exception as exc:  # noqa: BLE001
            log.exception("auth_capture/login: BD browser open failed")
            state.state = STATE_FAILED
            state.error = f"bd_browser_open_failed:{exc!s}"[:200]
            return

        if _expired(state):
            return

        # --- Optional warmup, then navigate to the login page ------------
        if cfg.warmup_url:
            try:
                # `commit` (not domcontentloaded) — the warmup only needs
                # to reach the origin so Akamai's sensor.js starts; the
                # heavy page need not be fully parsed. The sleep gives
                # sensor.js room to mint cookies.
                await page.goto(
                    cfg.warmup_url,
                    wait_until="commit",
                    timeout=30_000,
                )
                await asyncio.sleep(3.0)
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "auth_capture/login: warmup nav failed (continuing): %s",
                    exc,
                )

        if _expired(state):
            return

        try:
            # `commit` resolves as soon as the response is received — AC's
            # /signin redirect-chains through heavy OIDC-style hops, and
            # waiting for `domcontentloaded` of the final page times out
            # intermittently. Resolve early; the form finder polls.
            await page.goto(
                cfg.login_url, wait_until="commit", timeout=45_000
            )
        except Exception as exc:  # noqa: BLE001
            # A goto interrupted by a redirect, or slow to commit, is NOT
            # treated as fatal — the browser is still navigating, and the
            # error alone can't tell us whether the page is usable. Let it
            # settle and continue: the form finder (which polls ~45s
            # across frames) is the real arbiter — if the page genuinely
            # never loaded it reports login_form_not_found with a DOM
            # inventory, a far more useful signal than a bare nav timeout.
            log.info(
                "auth_capture/login: login-page nav raised (%s) — "
                "continuing; the form finder will wait it out",
                type(exc).__name__,
            )
            try:
                await page.wait_for_load_state(
                    "domcontentloaded", timeout=20_000
                )
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(2.0)

        _update_current_url(state)
        # Decision point #1 — form loaded.
        await _capture_screenshot(state)

        if _expired(state):
            return

        # --- Fill + submit credentials -----------------------------------
        filled = await _fill_and_submit_credentials(state, cfg)
        _update_current_url(state)
        await _capture_screenshot(state)
        if not filled:
            # Could not find the form fields. Per the contract: when
            # genuinely unsure, prefer mfa_required WITH a screenshot so
            # the user can see the page and respond — but a missing
            # *login* form is a real failure, not an MFA step. We only
            # fall back to mfa_required if the page actually shows
            # something code-like; otherwise fail honestly.
            if await _any_present(
                state.page,
                _selectors(cfg.mfa_marker_selector, *_GENERIC_MFA_MARKERS),
            ):
                await _enter_mfa_required(state, cfg)
            else:
                state.state = STATE_FAILED
                # _fill_and_submit_credentials may have recorded a
                # detailed error (with the real DOM inventory) — keep it.
                if not state.error:
                    state.error = "login_form_not_found"
            return

        if _expired(state):
            return

        # --- Outcome-detection loop (handles repeated MFA rounds) --------
        while True:
            if _expired(state):
                return

            outcome = await _detect_outcome(state, cfg)
            _update_current_url(state)
            await _capture_screenshot(state)

            if outcome == "success":
                cur_url = state.current_url or ""
                await _save_capture(state, cfg, cur_url)
                return

            if outcome == "invalid":
                state.state = STATE_INVALID
                log.info(
                    "auth_capture/login: session %s — invalid credentials "
                    "(program=%s)",
                    state.session_id,
                    state.program_id,
                )
                return

            # Both "mfa" (a code field is present) and "timeout" (we could
            # not positively classify) resolve the same way: per the
            # contract, when genuinely unsure prefer mfa_required WITH a
            # screenshot so the user sees the still and can respond, rather
            # than guessing `failed`. `_run_mfa_round` pauses for the user,
            # fills + submits the code, and returns whether to keep
            # looping. A terminal state inside it ends the task.
            if outcome == "timeout":
                log.info(
                    "auth_capture/login: session %s — outcome undetermined, "
                    "surfacing as mfa_required with screenshot (program=%s)",
                    state.session_id,
                    state.program_id,
                )
            keep_looping = await _run_mfa_round(state, cfg)
            if not keep_looping:
                return
            # Loop again to detect the post-MFA outcome.
            continue
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("auth_capture/login: unexpected error: %s", exc)
        state.state = STATE_FAILED
        state.error = f"login_task_crash:{exc!r}"[:200]
    finally:
        # Always tear down the BD browser once the task ends — a finished
        # session must not keep burning BD bandwidth. _close_bd_browser
        # preserves a terminal `state`; if the task ended without one
        # (cancelled by /auth/finalize) it sets `torn_down`. Schedule it
        # as a separate task: _close_bd_browser cancels + awaits THIS
        # task, so calling it inline would deadlock.
        #
        # If /auth/finalize is already tearing us down, the handles are
        # being closed there — scheduling a second teardown is harmless
        # (it is idempotent) but we skip it when there's nothing left.
        if state.pw or state.browser or state.context:
            asyncio.create_task(_close_bd_browser(state))


def _expired(state: AuthSessionState) -> bool:
    """If the session TTL elapsed, transition to `expired` and return True.

    The login task calls this at each await-boundary so a user who walked
    away doesn't leave a BD browser burning bandwidth for the full idle
    life. The `finally` block in `_login_task` handles the actual
    teardown.
    """
    if state.state in _TERMINAL_STATES:
        return state.state == STATE_EXPIRED
    if _now() >= state.expires_at_unix:
        state.state = STATE_EXPIRED
        state.error = "session_max_ttl"
        log.info(
            "auth_capture: session %s expired (ttl=%ds)",
            state.session_id,
            SESSION_MAX_TTL_SEC,
        )
        return True
    return False


async def _enter_mfa_required(
    state: AuthSessionState, cfg: ProgramAuthConfig
) -> None:
    """Transition the session to `mfa_required`: scrape any human prompt
    text and capture a fresh still so /auth/status can surface both."""
    page = state.page
    if page is not None:
        try:
            state.mfa_prompt = await _scrape_mfa_prompt(page, cfg)
        except Exception:  # noqa: BLE001
            state.mfa_prompt = None
    _update_current_url(state)
    await _capture_screenshot(state)
    # Arm a fresh event for this round (a previous round may have set it).
    state.mfa_code_event = asyncio.Event()
    state.mfa_code = None
    state.state = STATE_MFA_REQUIRED
    log.info(
        "auth_capture: session %s — MFA required (program=%s)",
        state.session_id,
        state.program_id,
    )


async def _await_mfa_code(state: AuthSessionState) -> bool:
    """Block until /auth/mfa supplies a code, the session TTL elapses, or
    the session is torn down. Returns True if a code arrived, False
    otherwise (in which case `state` has already moved to a terminal
    state via `_expired`, or the session was torn down)."""
    while True:
        if state.state != STATE_MFA_REQUIRED:
            # Torn down, or already moved on by another path.
            return False
        # Bound the wait so we re-check TTL roughly every second.
        remaining = state.expires_at_unix - _now()
        if remaining <= 0:
            _expired(state)
            return False
        try:
            await asyncio.wait_for(
                state.mfa_code_event.wait(), timeout=min(remaining, 1.0)
            )
        except asyncio.TimeoutError:
            continue
        if state.mfa_code:
            return True
        # Event set without a code — defensive; re-arm and keep waiting.
        state.mfa_code_event = asyncio.Event()


async def _run_mfa_round(
    state: AuthSessionState, cfg: ProgramAuthConfig
) -> bool:
    """One MFA round: pause at `mfa_required` for the user, wait for the
    code from /auth/mfa, fill + submit it, then hand control back to the
    detection loop.

    Returns True to keep looping (the post-MFA outcome must be detected),
    False to end the login task — either because a terminal state was
    reached (TTL expiry, torn down, or a missing code field set `failed`)
    or because no code arrived.
    """
    await _enter_mfa_required(state, cfg)
    if not await _await_mfa_code(state):
        # TTL elapsed, torn down, or otherwise no code — `state` already
        # carries the terminal outcome (or is being torn down).
        return False

    # Resume — back to `working` while we submit the code + re-detect.
    state.state = STATE_WORKING
    state.mfa_prompt = None
    code = state.mfa_code or ""
    state.mfa_code = None

    submitted = await _fill_and_submit_mfa(state, cfg, code)
    _update_current_url(state)
    await _capture_screenshot(state)
    if not submitted:
        state.state = STATE_FAILED
        state.error = "mfa_code_field_not_found"
        return False
    return True


# ----------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------
@router.post("/start")
async def auth_start(
    request: Request,
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
    """Start a worker-driven login for the user.

    JSON body: {"username": "...", "password": "..."} — the airline login
    credentials the user typed into PointSnap's own form.

    Creates an in-memory session and launches a background task that opens
    a Bright Data browser, navigates to the airline login page, fills the
    form, and detects the outcome. Returns immediately with the opaque
    session_id; the cockpit polls /auth/status for progress.
    """
    cfg = PROGRAM_AUTH.get(program)
    if not cfg:
        return JSONResponse(
            {"error": f"program={program!r} is not registered for auth capture"},
            status_code=400,
        )

    try:
        uuid.UUID(user_id)
    except (ValueError, TypeError):
        return JSONResponse(
            {"error": "user_id must be a valid UUID"}, status_code=400
        )

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse(
            {"error": "request body must be JSON with username + password"},
            status_code=400,
        )

    username = (body.get("username") if isinstance(body, dict) else None) or ""
    password = (body.get("password") if isinstance(body, dict) else None) or ""
    username = username.strip() if isinstance(username, str) else ""
    # Do NOT strip the password — leading/trailing whitespace could be
    # meaningful. Just type-check it.
    if not isinstance(password, str):
        password = ""

    if not username or not password:
        return JSONResponse(
            {"error": "both username and password are required"},
            status_code=400,
        )

    session_id = _gen_session_id()
    now = _now()
    state = AuthSessionState(
        session_id=session_id,
        user_id=user_id,
        program_id=program,
        state=STATE_WORKING,
        started_at=now,
        expires_at_unix=now + SESSION_MAX_TTL_SEC,
        username=username,
        password=password,
    )
    ACTIVE_SESSIONS[session_id] = state

    # Launch the background login task. /auth/start returns immediately.
    state.login_task = asyncio.create_task(_login_task(state, cfg))

    expires_at_iso = datetime.fromtimestamp(
        state.expires_at_unix, tz=timezone.utc
    ).isoformat()

    return JSONResponse(
        {
            "session_id": session_id,
            "program_id": program,
            "program_label": cfg.label,
            "state": STATE_WORKING,
            "expires_at": expires_at_iso,
        }
    )


@router.get("/status")
async def auth_status(
    session_id: str = Query(..., description="Returned by /auth/start"),
) -> JSONResponse:
    """Poll endpoint — the cockpit calls this every ~2s.

    Surfaces the current state, a single refreshed JPEG still
    (`screenshot_b64`), any scraped MFA prompt text, and — on a successful
    capture — the stored program_auth_sessions row id.
    """
    state = ACTIVE_SESSIONS.get(session_id)
    if not state:
        return JSONResponse(
            {"error": "unknown session_id", "session_id": session_id},
            status_code=404,
        )

    # Refresh the current URL best-effort (the page may still be live).
    _update_current_url(state)

    # A `torn_down` session that never reached a terminal outcome is
    # reported as `failed` so the cockpit shows a clear end-state rather
    # than an internal token.
    public_state = state.state
    if public_state == STATE_TORN_DOWN:
        public_state = STATE_FAILED

    payload: dict = {
        "session_id": session_id,
        "program_id": state.program_id,
        "state": public_state,
        "current_url": state.current_url,
        "mfa_prompt": state.mfa_prompt if public_state == STATE_MFA_REQUIRED else None,
        "screenshot_b64": state.screenshot_b64,
        "stored_row_id": state.stored_row_id if public_state == STATE_CAPTURED else None,
        "error": state.error if public_state == STATE_FAILED else None,
        "expires_at_unix": state.expires_at_unix,
    }
    return JSONResponse(payload)


@router.post("/mfa")
async def auth_mfa(
    request: Request,
    session_id: str = Query(..., description="Returned by /auth/start"),
) -> JSONResponse:
    """Supply the one-time MFA code the user entered in the cockpit.

    JSON body: {"code": "123456"}. The login task fills the code into the
    airline verification page, submits, and resumes outcome detection.

    409 if the session is not currently `mfa_required`.
    """
    state = ACTIVE_SESSIONS.get(session_id)
    if not state:
        return JSONResponse(
            {"error": "unknown session_id", "session_id": session_id},
            status_code=404,
        )

    if state.state != STATE_MFA_REQUIRED:
        return JSONResponse(
            {"error": f"session is not awaiting MFA (state={state.state})"},
            status_code=409,
        )

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse(
            {"error": "request body must be JSON with a code"}, status_code=400
        )

    code = (body.get("code") if isinstance(body, dict) else None) or ""
    code = code.strip() if isinstance(code, str) else ""
    if not code:
        return JSONResponse({"error": "code is required"}, status_code=400)

    # Hand the code to the waiting login task and wake it.
    state.mfa_code = code
    state.mfa_code_event.set()

    return JSONResponse({"ok": True})


@router.post("/finalize")
async def auth_finalize(
    session_id: str = Query(..., description="Returned by /auth/start"),
) -> JSONResponse:
    """Tear down the BD browser for this session. Idempotent — safe to
    call after a terminal outcome, on cockpit modal close, or on cancel.
    """
    state = ACTIVE_SESSIONS.get(session_id)
    if not state:
        # Idempotent: an unknown / already-cleaned session is still "ok".
        return JSONResponse({"ok": True})

    await _close_bd_browser(state)

    # Keep the entry around (in its terminal / torn_down state) so a late
    # /auth/status poll returns a friendly result rather than 404. The
    # registry stays small for our one-user-at-a-time use case.
    return JSONResponse({"ok": True})


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
