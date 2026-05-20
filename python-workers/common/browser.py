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
import re
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


def _brightdata_residential_proxy(
    country: str | None = None,
    session: str | None = None,
) -> dict | None:
    """Parse BRIGHTDATA_RESIDENTIAL_URL env var into Camoufox/Playwright proxy kwargs.

    Expected env format:
      http://brd-customer-hl_XXX-zone-<zone>:PASSWORD@brd.superproxy.io:33335

    BD encodes per-request modifiers as username segments:
      -country-XX  → routes through that country's residential pool
      -session-YY  → sticky IP for ~10min idle (cookie continuity across retries)

    Returns None when BRIGHTDATA_RESIDENTIAL_URL is unset (callers should
    raise rather than silently fall through).
    """
    from urllib.parse import urlparse

    url = os.environ.get("BRIGHTDATA_RESIDENTIAL_URL")
    if not url:
        return None
    parsed = urlparse(url)
    username = parsed.username or ""
    if country and "-country-" not in username:
        username = f"{username}-country-{country.lower()}"
    if session and "-session-" not in username:
        username = f"{username}-session-{session}"
    return {
        "server": f"http://{parsed.hostname}:{parsed.port}",
        "username": username,
        "password": parsed.password or "",
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
    use_brightdata: bool = False,
    brightdata_session: str | None = None,
    use_brightdata_residential: bool = False,
    brightdata_country: str | None = None,
    use_camoufox: bool = False,
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
    # Camoufox path — Firefox-based stealth with fingerprints injected at
    # the C++ level before any JS can observe them. Defeats Akamai BMP's
    # sensor.js where Patchright fails (proven by Sekinal/aa_contest).
    # Uses headless="virtual" which spawns Xvfb internally so the session
    # looks headful to Akamai but doesn't need a real display.
    if use_camoufox:
        from camoufox.async_api import AsyncCamoufox

        camoufox_kwargs: dict = {
            "headless": "virtual",
            "humanize": True,
            "locale": "en-US",
            "window": (1366, 768),
            "block_webrtc": True,
            "geoip": False,  # only enable when using a residential proxy
        }
        # Proxy selection (in priority order): BD Residential > IPRoyal > none.
        # BD Residential is the 2026-canonical Akamai/Imperva bypass when paired
        # with Camoufox (per Sekinal/aa_contest + asadfix). IPRoyal is the
        # cheaper fallback for sites that don't have BMP-grade defenses.
        if use_brightdata_residential:
            bd_proxy = _brightdata_residential_proxy(
                country=brightdata_country or proxy_country,
                session=brightdata_session or proxy_session,
            )
            if not bd_proxy:
                raise RuntimeError(
                    "use_brightdata_residential=True but BRIGHTDATA_RESIDENTIAL_URL not set"
                )
            camoufox_kwargs["proxy"] = bd_proxy
            camoufox_kwargs["geoip"] = True
        elif use_proxy:
            ip_proxy = _proxy_kwargs(country=proxy_country, session=proxy_session).get("proxy")
            if ip_proxy:
                camoufox_kwargs["proxy"] = ip_proxy
                camoufox_kwargs["geoip"] = True  # auto-derive TZ/lat/long from exit IP

        async with AsyncCamoufox(**camoufox_kwargs) as browser:
            # Use explicit new_context so we can pass ignore_https_errors when
            # BD Residential MITMs HTTPS (BD intercepts TLS and presents its
            # own cert; Firefox throws SEC_ERROR_UNKNOWN_ISSUER without this).
            context_kwargs: dict = {}
            if use_brightdata_residential:
                context_kwargs["ignore_https_errors"] = True
            context = await browser.new_context(**context_kwargs)
            page = await context.new_page()
            page.set_default_timeout(timeout_ms)
            # NOTE: deliberately NOT blocking stylesheets/fonts in the Camoufox
            # branch — Firefox treats `display:none` differently than Chromium
            # when CSS isn't loaded, and elements can fail `offsetParent !==
            # null` visibility checks even though they're in the DOM. We pay
            # a small bandwidth cost in exchange for the page actually
            # rendering. Only block heavy media to keep load times sane.
            async def _block_heavy_camou(route):
                if route.request.resource_type in ("image", "media"):
                    await route.abort()
                else:
                    await route.continue_()
            await page.route("**/*", _block_heavy_camou)
            try:
                yield page
            finally:
                try:
                    await context.close()
                except Exception:  # noqa: BLE001
                    pass
        return

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
        if use_brightdata:
            # Bright Data Browser API: hosted Chromium reached over CDP.
            # BD handles the proxy + Akamai/Imperva/DataDome bypass on their
            # side. Bandwidth-billed (~$8/GB) so we block heavy resources by
            # default to keep monthly cost in the ~$5-15 range at personal
            # search volume. Leave the UA at whatever BD's curated Chromium
            # reports — overriding it would defeat their stealth tuning.
            wss_url = os.environ.get("BRIGHTDATA_WSS_URL")
            if not wss_url:
                raise RuntimeError(
                    "BRIGHTDATA_WSS_URL env var not configured"
                )
            # Sticky-session support: inject `-session-<id>` into the
            # `brd-customer-X-zone-Y` username so BD pins the same exit IP
            # for the session's lifetime (~10min idle). Lets callers (e.g.,
            # the AA plugin) reuse a known-good IP across retries.
            if brightdata_session:
                wss_url = re.sub(
                    r"(brd-customer-[^:@/]+):",
                    rf"\1-session-{brightdata_session}:",
                    wss_url,
                    count=1,
                )
            browser = await pw.chromium.connect_over_cdp(
                wss_url, timeout=timeout_ms
            )
            ctx = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                locale="en-US",
            )
            page = await ctx.new_page()
            page.set_default_timeout(timeout_ms)

            async def _block_heavy_brd(route):
                if route.request.resource_type in (
                    "image", "stylesheet", "font", "media", "manifest"
                ):
                    await route.abort()
                else:
                    await route.continue_()
            await page.route("**/*", _block_heavy_brd)

            try:
                yield page
            finally:
                try:
                    await ctx.close()
                except Exception:  # noqa: BLE001
                    pass
                try:
                    await browser.close()
                except Exception:  # noqa: BLE001
                    pass
            return
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
        if use_scraperapi:
            # ScraperAPI charges per resource. Block images/css/fonts/media
            # so we pay for HTML + JS + XHR only — typically 10-20x credit
            # savings per page.
            async def _block_heavy(route):
                if route.request.resource_type in (
                    "image", "stylesheet", "font", "media", "manifest"
                ):
                    await route.abort()
                else:
                    await route.continue_()
            await page.route("**/*", _block_heavy)
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
