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
    # IPRoyal targeting suffix goes on the PASSWORD field (not username):
    # `{password}_country-{cc}_session-{sid}_lifetime-{dur}`
    # Defaults: country=us (most target sites are US-based) — without this
    # the residential pool returns random global exits (observed Vietnam IP)
    # which Akamai then geo-blocks or slow-rolls.
    country = (country or os.environ.get("IPROYAL_COUNTRY") or "us").lower()
    pwd_suffixed = f"{pwd}_country-{country}"
    if session:
        pwd_suffixed = f"{pwd_suffixed}_session-{session}_lifetime-10m"
    return {
        "proxy": {
            "server": f"http://{host}:{port}",
            "username": user,
            "password": pwd_suffixed,
        }
    }


def _scraperapi_proxy(
    country: str | None = None,
    render: bool = True,
    premium: bool = False,
) -> dict | None:
    """Return Patchright proxy config pointing at ScraperAPI's proxy port.

    ScraperAPI exposes their browser farm + clean residential IPs as a
    standard HTTP proxy. Options encode into the username:
      `scraperapi.render=true.country_code=us.premium=true`
    They handle Akamai/Imperva on their side — drop-in replacement for
    IPRoyal for sites IPRoyal blocks (aa.com, delta.com, aircanada.com)
    or that Akamai blocks via IPRoyal IPs (united, AF, KLM, TK, CX).

    Credit cost: 5/req for render=true, 25/req for premium=true, 75
    for both. Free tier 5k credits/mo. We default render=true (most
    airline pages are SPAs that need JS). Premium=true gets clean IPs
    (needed when the site detects ScraperAPI's shared pool, e.g. AA)."""
    key = os.environ.get("SCRAPERAPI_KEY")
    if not key:
        return None
    opts: list[str] = ["scraperapi"]
    if render:
        opts.append("render=true")
    if premium:
        opts.append("premium=true")
    cc = (country or os.environ.get("IPROYAL_COUNTRY") or "us").lower()
    opts.append(f"country_code={cc}")
    username = ".".join(opts)
    return {
        "server": "http://proxy-server.scraperapi.com:8001",
        "username": username,
        "password": key,
    }


@asynccontextmanager
async def browser_page(
    *,
    timeout_ms: int = 30_000,
    user_data_dir: str | None = None,
    use_proxy: bool = True,
    proxy_country: str | None = None,
    proxy_session: str | None = None,
    disable_http2: bool = True,
    use_scraperapi: bool = False,
    scraperapi_render: bool = True,
    scraperapi_premium: bool = False,
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

    if use_scraperapi:
        proxy_cfg = _scraperapi_proxy(
            country=proxy_country,
            render=scraperapi_render,
            premium=scraperapi_premium,
        )
    elif use_proxy:
        proxy_cfg = _proxy_kwargs(country=proxy_country, session=proxy_session).get("proxy")
    else:
        proxy_cfg = None
    launch_args = [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
    ]
    if disable_http2:
        # united.com HTTP/2 frame negotiation can fail under Chromium+proxy
        # in some configs; some sites (delta.com) require HTTP/2 ALPN to
        # negotiate. Toggle per call so we can pick the right stack per site.
        launch_args.append("--disable-http2")

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
            if use_scraperapi:
                # ScraperAPI terminates TLS at their proxy and re-presents
                # their own cert; trust it so HTTPS goto's don't hit
                # ERR_CERT_AUTHORITY_INVALID.
                context_kwargs["ignore_https_errors"] = True
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
