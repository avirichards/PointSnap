"""Shared Patchright (stealth-Playwright fork) helpers for real scrapers.

Patchright defeats Akamai BMP sensor_data, Imperva JS challenges, and
DataDome cookie validation that pure HTTP clients can't handle. We use
it as the "primer" — render the page once, let the airline's JS run
to completion, then optionally export cookies to curl_cffi for warm
follow-up calls.

Configured to route through IPRoyal residential when the env vars
(IPROYAL_PROXY_*) are set on the Fly app — matches the same secrets
read by common.scrape_client.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

log = logging.getLogger(__name__)


def _proxy_kwargs(country: str | None = None, session: str | None = None) -> dict:
    # Diagnostic kill-switch: set SCRAPER_NO_PROXY=1 to bypass IPRoyal and
    # let Chromium use the Fly egress IP directly. Useful for confirming
    # whether ERR_TUNNEL_CONNECTION_FAILED is the proxy or the airline.
    if os.environ.get("SCRAPER_NO_PROXY") == "1":
        return {}
    host = os.environ.get("IPROYAL_PROXY_HOST")
    port = os.environ.get("IPROYAL_PROXY_PORT")
    user = os.environ.get("IPROYAL_PROXY_USER")
    pwd = os.environ.get("IPROYAL_PROXY_PASS")
    if not all([host, port, user, pwd]):
        return {}
    # IPRoyal username suffix syntax: `{user}_country-{cc}_session-{sid}`
    # Defaults: country=us (most target sites are US-based), sticky
    # session-id derived from country so repeated requests in the same
    # scrape land on the same residential exit (helps with Akamai
    # validation that ties cookies to IP).
    country = (country or os.environ.get("IPROYAL_COUNTRY") or "us").lower()
    user_suffixed = f"{user}_country-{country}"
    if session:
        user_suffixed = f"{user_suffixed}_session-{session}"
    return {
        "proxy": {
            "server": f"http://{host}:{port}",
            "username": user_suffixed,
            "password": pwd,
        }
    }


@asynccontextmanager
async def browser_page(
    *,
    timeout_ms: int = 30_000,
    user_data_dir: str | None = None,
    use_proxy: bool = True,
    proxy_country: str | None = None,
    proxy_session: str | None = None,
) -> AsyncIterator:
    """Yield a Patchright `page` ready to navigate. Closes browser on exit.

    Proxy handling: Chromium has a long-standing bug where launch-level
    proxy auth sends a blank Proxy-Authorization header (see Playwright
    #37444, #443, #34252). The fix — confirmed by IPRoyal docs and
    Playwright Network docs — is to set `proxy={"server": "per-context"}`
    at launch time as a sentinel, then attach the real proxy config
    at the context level via `browser.new_context(proxy=...)`.

    When `user_data_dir` is provided, uses persistent context (proxy goes
    on launch_persistent_context directly, since there's no separate
    context construction step).
    """
    # Lazy import — Patchright is heavy. Avoid loading at module import
    # time so the worker boots even if Chromium isn't installed yet.
    from patchright.async_api import async_playwright

    proxy_cfg = (
        _proxy_kwargs(country=proxy_country, session=proxy_session).get("proxy")
        if use_proxy
        else None
    )
    launch_args = [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        # united.com HTTP/2 frame negotiation fails under Chromium+proxy
        # in our environment; disabling HTTP/2 forces HTTP/1.1 which both
        # IPRoyal and direct egress reliably handle.
        "--disable-http2",
    ]

    async with async_playwright() as pw:
        if user_data_dir:
            # Persistent-context path: proxy goes directly on the call.
            ctx = await pw.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                headless=True,
                args=launch_args,
                proxy=proxy_cfg if proxy_cfg else None,
            )
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            browser = None
        else:
            launch_kwargs: dict = {
                "headless": True,
                "args": launch_args,
            }
            # Chromium bug workaround: launch with "per-context" sentinel
            # so context-level proxy auth actually fires.
            if proxy_cfg:
                launch_kwargs["proxy"] = {"server": "per-context"}
            browser = await pw.chromium.launch(**launch_kwargs)

            context_kwargs: dict = {
                "user_agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                "viewport": {"width": 1366, "height": 768},
                "locale": "en-US",
            }
            if proxy_cfg:
                context_kwargs["proxy"] = proxy_cfg
            ctx = await browser.new_context(**context_kwargs)
            page = await ctx.new_page()
        page.set_default_timeout(timeout_ms)
        try:
            yield page
        finally:
            try:
                await ctx.close()
            except Exception:  # noqa: BLE001
                pass
            if browser:
                try:
                    await browser.close()
                except Exception:  # noqa: BLE001
                    pass


def creds_for(program_id: str) -> tuple[str | None, str | None]:
    """Look up scraper account credentials for a program.

    Delegates to common.account_pool.acquire() which:
      - Picks the least-recently-used active account from the account_pool
        table in the DB (rotates across many warmed accounts).
      - Reads the actual credentials from Fly secrets via env vars named
        in the account row (env_user_var / env_pass_var).
      - Tracks searches_today / hourly_window_start for per-account rate
        limiting.

    Falls back to the single-account env-var convention when:
      - The DB isn't reachable (DATABASE_URL unset / connect error).
      - No accounts are configured in account_pool for this program.

    Single-account fallback env-var names (set via `fly secrets set`):
      BA_AVIOS      → BA_EXEC_CLUB_USER / BA_EXEC_CLUB_PASS
      AV_LIFEMILES  → LM_USER / LM_PASS
      AF_FLYINGBLUE → FB_USER / FB_PASS
      TK_MILES_SMILES → TK_MS_USER / TK_MS_PASS
      NH_ANA        → ANA_AMC_USER / ANA_AMC_PASS
      CX_CATHAY     → CX_USER / CX_PASS
      LH_MILES_MORE → MM_CARD_NUM / MM_PIN
      AA_AADVANTAGE → AA_USER / AA_PASS
      DL_SKYMILES   → DL_USER / DL_PASS
      AC_AEROPLAN   → AEROPLAN_USER / AEROPLAN_PASS
    """
    from common.account_pool import acquire
    creds = acquire(program_id)
    if not creds:
        return (None, None)
    return (creds.username, creds.password)
