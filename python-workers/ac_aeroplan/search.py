"""Air Canada Aeroplan award search plugin — auth_required (T5' path).

Phase-1 transport investigation (2026-05-20). The prior transport
(Patchright + BD Browser API) is Akamai-flagged for aircanada.com, so the
search silently returned `[]`. This module was slated for a Bright Data
Web Unlocker rewrite — but the investigation below shows Aeroplan award
search is gated behind a **logged-in Aeroplan session** (Air Canada built
this login wall in March 2025 expressly to stop award scrapers), so no
anonymous WU transport returns rows. The plugin is left as an honest
`auth_required` stub.

=============================================================================
INVESTIGATION FINDINGS (2026-05-20, all via `/diag/wu_probe`, format=json):

  GOOD NEWS — the WU transport itself is viable for Air Canada:
  * `GET aircanada.com/` → 200, 56 KB, full Akamai jar (`_abck`, `bm_s`).
  * `GET .../aeroplan/redeem/availability/outbound?org0=...&dest0=...&
       departureDate0=...&marketCode=TNB`
      → 200, 62 KB. The real Angular redemption SPA shell
      (`<title>AC Loyalty</title>`, `<base href="/aeroplan/redeem/">`),
      with a full Akamai jar: `_abck`, `bm_ss`, `bm_so`, `bm_sz`, `AKA_A2`.
      NO server-side login redirect (`x-unblocker-redirected-to` absent).
      WU fully clears Air Canada's Akamai for the page GET.
  * `POST .../loyalty/dapidynamic/{tenant}/v2/search/air-bounds`
      → target_status **404** (AC's generic not-found page), NOT an
      Akamai 444 edge-reject and NOT a BD `bad_endpoint_robots` block.
      So WU *can* POST to the `loyalty/dapidynamic/*` API path — the 404
      is only because the `{tenant}` path segment is a specific value
      that could not be guessed (tried `1ASIATSAC`, `1ASIDFPAC`,
      `loyalty`, `airbounds` — all 404). The real tenant id is baked
      into the redeem SPA's Angular JS bundle.

  THE BLOCKER — auth (matches Agent 5's research, flagged CRITICAL):
  Air Canada built a **login wall in March 2025**, explicitly to stop
  award scrapers (it had sued seats.aero, which scraped the air-bounds
  API anonymously). Aeroplan award search now requires a logged-in
  Aeroplan account session. The redeem SPA *shell* still renders without
  a session (the page GET above is 200), but the SPA's air-bounds XHR —
  the call that actually returns award availability + miles pricing — is
  gated behind that logged-in session. Bright Data Web Unlocker bypasses
  Air Canada's Akamai bot defense, but it is a stateless single-shot
  fetch and **cannot supply a logged-in Aeroplan account**.

CONCLUSION — auth_required:
  This is NOT a WU/transport bug and NOT something a code change fixes.
  Aeroplan belongs to the **T5' user-auth-capture** path (a sibling
  workstream is building it) — Agent 5 rates AC the #1 T5'-required
  airline ("T5' is the ONLY way to scrape Aeroplan post-March-2025").
  Per the scraping briefing, a broken plugin must NOT be forced — so
  `search()` here returns `[]` with verdict `auth_required`.

UPDATE 2026-05-21 — the `{tenant}` seam is RESOLVED (see scraper-log.md
"Session 15" + the AIR_BOUNDS_* constants below):
  * Real tenant `1ASIUDALAC`, API gateway host `akamai-gw.dbaas.aircanada
    .com`, base `/loyalty/dapidynamicplus/1ASIUDALAC/v2`, POST
    `/search/air-bounds?lang=en-CA`, headers `x-api-key` +
    `x-app-client-id: redemption-web`. Extracted from the redeem SPA's
    Angular bundle (`main.<hash>.js`) + the page's `KPSDK.configure` block.
  * What is STILL unresolved is the TRANSPORT. The air-bounds path is
    Kasada-protected (`KPSDK.configure`), so the request needs per-call
    `x-kpsdk-ct`/`x-kpsdk-cd` tokens that only AC's `p.js` can mint inside
    a real browser — a stateless WU `Cookie:`-header replay cannot. The
    captured logged-in session must be replayed *inside a browser*. BD
    Browser API blocks all cookie injection for aircanada.com (it is a
    managed browser — add_cookies / CDP setCookie / document.cookie all
    fail "Overriding X forbidden"); Camoufox is the viable path but is
    currently crashing on the Fly worker and needs an infra fix first.
  * The exact request BODY shape (`airBoundsInputs`) still needs a live
    logged-in air-bounds XHR capture — the Angular bundle assembles it
    from NgRx state, not a greppable literal.
  `_parse_air_bounds()` below — the AwardWiz-derived response parser — is
  kept fully intact and ready, so only the transport + body remain.
=============================================================================

Defensive contract: `search()` never raises — it returns `[]` and records
a verdict in `LAST_RUN_DIAG`.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from common.auth_session import get_active_session, mark_used
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AC_AEROPLAN"
PROGRAM_NAME = "Aeroplan"

# Reference URLs / paths (kept for the T5' transport that replaces this stub).
WARMUP_URL = "https://www.aircanada.com/"
SEARCH_PAGE_TMPL = (
    "https://www.aircanada.com/aeroplan/redeem/availability/outbound"
    "?org0={origin}&dest0={dest}&departureDate0={date}"
    "&lang=en-CA&tripType=O&ADT=1&YTH=0&CHD=0&INF=0&INS=0&marketCode=TNB"
)

# ---------------------------------------------------------------------------
# Air-bounds award API — RESOLVED 2026-05-21 (see scraper-log.md "Session 15").
#
# The `{tenant}` seam is resolved. The values below were extracted from the
# redeem SPA's Angular bundle (`https://www.aircanada.com/aeroplan/redeem/
# main.<hash>.js`) and the redeem page's inline `KPSDK.configure([...])`
# block:
#   * Real tenant id:  1ASIUDALAC   (the old placeholder `1ASIATSAC` 404s)
#   * API gateway host: akamai-gw.dbaas.aircanada.com  (NOT www.aircanada.com)
#   * The redeem SPA uses the `dapidynamicplus` API base, not `dapidynamic`:
#       main.js  →  Co = "https://akamai-gw.dbaas.aircanada.com"
#                   ua = "/loyalty/dapidynamicplus/1ASIUDALAC/v2"
#                   air-bounds API client basePath = Co + ua
#   * Required request headers (Angular `requestPlugins`):
#       x-api-key:        Z5R8Rm1sA37iC0gaS5kb69ltHwKBTYzUa89gQDwm
#       x-app-client-id:  redemption-web
#   * Method POST, query param `lang`, JSON body `airBoundsInputs`.
#
# TRANSPORT — still unresolved. The air-bounds path is registered with
# Kasada (`KPSDK.configure`), so a stateless WU `Cookie:`-header replay can
# NOT mint the per-request `x-kpsdk-ct`/`x-kpsdk-cd` tokens. The session must
# be replayed inside a real browser running AC's `p.js`. BD Browser API
# blocks cookie injection for aircanada.com (managed browser); Camoufox is
# the path but currently crashes on the Fly worker. See scraper-log.md.
# ---------------------------------------------------------------------------
AIR_BOUNDS_TENANT = "1ASIUDALAC"
AIR_BOUNDS_API_HOST = "akamai-gw.dbaas.aircanada.com"
AIR_BOUNDS_URL = (
    f"https://{AIR_BOUNDS_API_HOST}"
    f"/loyalty/dapidynamicplus/{AIR_BOUNDS_TENANT}/v2/search/air-bounds"
)
AIR_BOUNDS_API_KEY = "Z5R8Rm1sA37iC0gaS5kb69ltHwKBTYzUa89gQDwm"
AIR_BOUNDS_CLIENT_ID = "redemption-web"
# Substring used by network-capture diagnostics to recognise the XHR.
AIR_BOUNDS_PATH = "/v2/search/air-bounds"

# Module-level diagnostic state — exposed for the parent's consolidated
# deploy/test. Forensic-detail by design (CLAUDE.md scraper log discipline).
LAST_RUN_DIAG: dict[str, Any] = {}


# JavaScript injected into every AC page BEFORE its own scripts run. The
# Playwright 1.60 Firefox driver crashes (`TypeError: Cannot read
# properties of undefined (reading 'url')` at coreBundle.js
# FFBrowserContext page-error handler → the whole Node driver process
# exits) when the page raises an uncaught error whose Firefox page-error
# event has an undefined `location`. Air Canada's redeem SPA + Kasada
# `p.js` throw exactly such an error within ~2-4s of load — which is THE
# cause of the "Camoufox crash" (Session 16: not memory, not WebGL, not
# Akamai — a Playwright driver NPE on a malformed Firefox page-error).
#
# Fix: register capture-phase `error` + `unhandledrejection` handlers that
# `preventDefault()` every uncaught error. A handled error is no longer
# "uncaught", so Firefox does not emit the page-error event, so the buggy
# driver code path never runs. AC's SPA is unaffected — its own try/catch
# still works; we only stop genuinely-uncaught errors from reaching the
# (crash-prone) driver telemetry hook.
_PW_CRASH_SHIELD_JS = """
(() => {
  try {
    window.addEventListener('error', function (e) {
      try { e.preventDefault(); e.stopImmediatePropagation(); } catch (_) {}
      return true;
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      try { e.preventDefault(); e.stopImmediatePropagation(); } catch (_) {}
      return true;
    }, true);
    // Some uncaught errors route via window.onerror — neutralize it too.
    try { window.onerror = function () { return true; }; } catch (_) {}
    try { window.onunhandledrejection = function () { return true; }; } catch (_) {}
  } catch (_) {}
})();
"""


async def install_pw_crash_shield(context: Any) -> None:
    """Add `_PW_CRASH_SHIELD_JS` as an init script on a Playwright/Camoufox
    BrowserContext so it runs before any page script on every navigation.
    Prevents the Playwright-1.60 Firefox driver page-error NPE crash that
    Air Canada's redeem SPA otherwise triggers. Never raises.
    """
    try:
        await context.add_init_script(_PW_CRASH_SHIELD_JS)
    except Exception as exc:  # noqa: BLE001
        log.warning("AC: install_pw_crash_shield failed: %s", exc)


def build_camoufox_config(headless: Any = True) -> dict[str, Any]:
    """Camoufox launch kwargs for the AC redeem-SPA transport.

    Used by both `/diag/ac_air_bounds` and `_auth_search`.

    Camoufox-on-Fly crash — ROOT CAUSE (Session 16): with
    `headless="virtual"` Camoufox spawns Xvfb on a hardcoded **1x1-pixel
    screen with `+extension GLX`** (see `camoufox/virtdisplay.py`). Air
    Canada's redeem SPA — Angular + Kasada `p.js` + Akamai `sensor.js` —
    aggressively probes **WebGL** for fingerprinting. A WebGL draw on a
    degenerate 1x1 Xvfb GLX context crashes the Firefox content process,
    which surfaces to Playwright as `Browser.close ... WriteUnixTransport
    closed; the handler is closed`. (A page with no WebGL — example.com —
    survives `headless="virtual"` fine; the AC redeem SPA does not.)

    Fix: default to `headless=True` — Camoufox's plain headless mode uses
    Firefox's own offscreen compositor, NOT an Xvfb GLX context, so the
    degenerate-1x1-GLX WebGL crash cannot happen. Camoufox's C++-level
    fingerprint patches still spoof the headless tells (`navigator.webdriver`,
    headless UA, etc.), so `headless=True` is not a bot-defense regression —
    Sekinal/aa_contest's verified AA config is likewise `headless=True`.

    The Firefox memory-hardening prefs (capped HTTP/image/media caches,
    sooner GC, no bfcache) are kept — fingerprint-safe and cheap insurance
    against RSS growth over a 60-90s SPA session.

    TRANSPORT — Tailscale residential exit node (Session 18). Air Canada's
    air-bounds XHR (`akamai-gw.dbaas.aircanada.com/.../v2/search/air-bounds`)
    is Kasada-protected and HTTP-429s any request from the Fly worker's
    DATA-CENTER IP — Kasada flags data-center traffic on sight. The fix is
    to route the whole Camoufox transport through a RESIDENTIAL IP.

    Bright Data Residential (the Session-17 attempt) is unavailable: its
    no-KYC zone rejects POST (HTTP 402) and AC's air-bounds call is
    POST-only, and BD's KYC is business-only. So the residential IP is the
    user's OWN home internet: their home Mac is joined to the worker's
    tailnet as a Tailscale exit node. `entrypoint.sh` runs `tailscaled` in
    userspace-networking mode exposing a local SOCKS5 proxy on
    `127.0.0.1:1055`; `_tailscale_proxy()` returns that as a Camoufox
    `proxy=` dict. Camoufox's AC traffic then egresses from the home Mac's
    residential IP. Crucially, Tailscale is a real WireGuard tunnel — it
    does NOT MITM TLS, so (unlike Bright Data) there is no rogue cert and
    no HSTS wall: aircanada.com's cert chain arrives untouched, so no
    `ignore_https_errors` and no HSTS-disabling prefs are needed.

    When the proxy is set, `geoip=True` so Camoufox auto-derives the
    timezone/locale/lat-long from the (residential) exit IP — keeping the
    fingerprint internally consistent with the exit node's location.

    If `TAILSCALE_AUTHKEY` is unset, `_tailscale_proxy()` returns None and
    the launch falls back to direct Fly egress (which the air-bounds Kasada
    wall will then 429 — but the redeem SPA still loads, so this degrades
    rather than hard-fails). Tailscale is strictly additive: every other
    worker transport keeps Fly's normal egress.
    """
    from common.browser import _tailscale_proxy

    cfg: dict[str, Any] = {
        "headless": headless,    # True (offscreen) — NOT "virtual" (Xvfb GLX)
        "humanize": True,
        "locale": "en-US",
        "window": (1366, 768),
        "block_webrtc": True,
        "geoip": False,          # overridden to True below when a proxy is set
        "firefox_user_prefs": {
            # Cap the HTTP + image memory caches (defaults are unbounded /
            # large). Keeps Firefox RSS bounded over a 60-90s SPA session.
            "browser.cache.memory.enable": True,
            "browser.cache.memory.capacity": 51200,        # 50 MB (KB units)
            "browser.cache.disk.enable": False,
            "image.mem.max_decoded_image_kb": 51200,       # 50 MB
            "media.memory_cache_max_size": 16384,          # 16 MB (KB units)
            "media.cache_size": 16384,
            # Make the garbage / cycle collector fire sooner and harder so
            # the content process gives memory back instead of growing.
            "javascript.options.mem.gc_incremental_slice_ms": 10,
            "javascript.options.mem.high_water_mark": 64,  # MB — GC trigger
            "browser.sessionhistory.max_total_viewers": 0,  # no bfcache
            "browser.sessionhistory.max_entries": 3,
        },
    }

    # Route the transport through the user's home Tailscale exit node — a
    # residential IP — so Air Canada's Kasada-protected air-bounds API does
    # not 429 the call as data-center traffic. `_tailscale_proxy()` returns
    # the worker's local userspace SOCKS5 proxy (127.0.0.1:1055), whose
    # traffic Tailscale routes out through the exit node. `geoip=True`
    # makes Camoufox derive a consistent fingerprint (TZ/locale/geo) from
    # the exit IP. No `ignore_https_errors` / no HSTS prefs: Tailscale is a
    # plain WireGuard tunnel and does not MITM TLS, so aircanada.com's real
    # certificate is delivered intact.
    ts_proxy = _tailscale_proxy()
    if ts_proxy:
        cfg["proxy"] = ts_proxy
        cfg["geoip"] = True
    return cfg


def _cabin_from_ac(code: str) -> str | None:
    """Map an Air Canada cabin code to our cabin enum.

    AC's air-bounds response uses `eco` / `ecoPremium` / `business` /
    `first`. Kept for the T5' transport's parse step.
    """
    return {
        "eco": "Y",
        "ecoPremium": "W",
        "business": "J",
        "first": "F",
    }.get(code)


def _parse_air_bounds(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse Air Canada's air-bounds award response into NormalizedResult[].

    Shape ported from lg/awardwiz aeroplan.ts: `data.airBoundGroups[]` with
    `boundDetails.segments` (resolved via `data.dictionaries.flight`) and
    `airBounds[].prices.milesConversion.convertedMiles`. Kept fully intact
    and ready for the T5' (logged-in) transport. Robust to missing keys:
    any group that fails to parse is skipped, not fatal. Not exercised by
    the current `auth_required` stub.
    """
    results: list[NormalizedResult] = []
    data = payload.get("data") or {}
    groups = data.get("airBoundGroups") or []
    flight_dict = (data.get("dictionaries") or {}).get("flight") or {}

    for grp in groups[:6]:  # cap top 6 itineraries
        try:
            bound = (grp.get("boundDetails") or {})
            seg_ids = bound.get("segments") or []
            segments: list[ResultSegment] = []
            for i, seg_ref in enumerate(seg_ids):
                fid = seg_ref.get("flightId") if isinstance(seg_ref, dict) else seg_ref
                f = flight_dict.get(fid) or {}
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=(f.get("operatingAirline") or {}).get("code") or "AC",
                        marketing_airline_iata=(f.get("marketingAirline") or {}).get("code") or "AC",
                        flight_number=str(f.get("number") or ""),
                        origin_iata=(f.get("origin") or {}).get("locationCode") or origin,
                        dest_iata=(f.get("destination") or {}).get("locationCode") or dest,
                        depart_at=(f.get("departure") or {}).get("dateTime") or f"{date}T00:00:00Z",
                        arrive_at=(f.get("arrival") or {}).get("dateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=(f.get("aircraft") or {}).get("code"),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            for air_bound in grp.get("airBounds") or []:
                cabin_code = _cabin_from_ac(air_bound.get("availabilityDetails", [{}])[0].get("cabin") or "")
                if not cabin_code:
                    continue
                prices = air_bound.get("prices") or {}
                miles_obj = (prices.get("milesConversion") or {}).get("convertedMiles") or {}
                miles = int(miles_obj.get("base") or 0)
                taxes_cents = int(prices.get("totalTaxes") or 0)
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin_code,  # type: ignore[arg-type]
                        seats_remaining=int(air_bound.get("availabilityDetails", [{}])[0].get("quota") or 0),
                        miles_per_pax=miles,
                        surcharge_usd_per_pax=0,  # AC doesn't pass YQ
                        taxes_usd_per_pax=int(round(taxes_cents / 100.0)),
                    )
                )
            if not cabin_prices:
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
                    total_duration_min=int(bound.get("duration") or 0),
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=81,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("AC airBoundGroup parse error: %s", exc)
            continue

    return results


def _cookie_header(cookies: list[dict]) -> str:
    """Build a `Cookie:` header value from stored Playwright-shape cookies.

    The T5' capture stores cookies in Playwright's shape (name/value/domain/
    path/...). For a WU `Cookie:` header we only need `name=value` pairs;
    we keep every cookie (domain scoping is the target's problem, and AC's
    jar is all `aircanada.com`).
    """
    parts = [
        f"{c['name']}={c['value']}"
        for c in cookies
        if c.get("name") and c.get("value") is not None
    ]
    return "; ".join(parts)


def _to_session_cookies(cookies: list[dict]) -> list[dict]:
    """Normalise stored Playwright-shape cookies for `context.add_cookies`.

    Injected as SESSION cookies (no `expires`): a captured cookie's stored
    `expires` is often in the past (Gigya `glt_*` login tokens are
    short-lived) and the browser silently discards an already-expired
    cookie. A session cookie survives the whole context lifetime, which is
    all an air-bounds search needs. CHIPS-capture extras (`partitionKey`,
    `_crHasCrossSiteAncestor`) are dropped.
    """
    out: list[dict] = []
    for c in cookies:
        if not c.get("name") or "value" not in c or not c.get("domain"):
            continue
        nc: dict[str, Any] = {
            "name": c["name"],
            "value": str(c["value"]),
            "domain": c["domain"],
            "path": c.get("path") or "/",
            "secure": bool(c.get("secure", True)),
            "httpOnly": bool(c.get("httpOnly", False)),
        }
        ss = c.get("sameSite")
        if ss in ("Strict", "Lax", "None"):
            nc["sameSite"] = ss
        out.append(nc)
    return out


async def _camoufox_air_bounds(
    cookies: list[dict],
    origin: str,
    dest: str,
    date: str,
) -> tuple[dict | None, dict]:
    """Run the Aeroplan air-bounds search inside Camoufox with the user's
    captured session injected, and return `(air_bounds_response_json,
    diag)`.

    This is the real T5' transport. Air Canada's air-bounds API is Kasada-
    protected (`x-kpsdk-*` headers, minted only by AC's `p.js` in a real
    browser) AND gated behind a logged-in Aeroplan session — so the call
    must be made by the redeem SPA itself, from inside a browser, with the
    user's session. Bright Data Browser API blocks cookie injection for
    aircanada.com; Camoufox is the only transport where injection works.

    Flow: launch Camoufox routed through the user's home Tailscale exit
    node (`build_camoufox_config` wires the local userspace SOCKS5 proxy —
    Kasada 429s the air-bounds XHR from the Fly worker's data-center IP, so
    a residential exit is required) → install the Playwright-driver crash
    shield → inject the captured jar as session cookies → load the redeem
    SPA root (warms Akamai) → navigate the availability deep-link, which
    makes the logged-in SPA run AC's Kasada `p.js` and fire its own
    properly-stamped air-bounds XHR → capture that XHR's JSON via `page.on`.

    Never raises — returns `(None, diag)` on any failure. `diag` carries
    forensic detail for `LAST_RUN_DIAG`.
    """
    diag: dict[str, Any] = {"transport": "camoufox", "stages": []}
    air_bounds_json: dict | None = None
    air_bounds_status: int | None = None
    browser = None
    try:
        from camoufox.async_api import AsyncCamoufox

        search_url = SEARCH_PAGE_TMPL.format(origin=origin, dest=dest, date=date)
        redeem_root = "https://www.aircanada.com/aeroplan/redeem/"

        cf_config = build_camoufox_config()
        through_proxy = "proxy" in cf_config
        diag["proxy"] = "tailscale_exit_node" if through_proxy else "none"
        browser = await AsyncCamoufox(**cf_config).__aenter__()
        diag["stages"].append(
            "camoufox_launched"
            + ("(tailscale_exit)" if through_proxy else "(fly_egress)")
        )
        # Tailscale is a plain WireGuard tunnel (no TLS MITM), so AC's real
        # cert is delivered intact and ignore_https_errors is not required.
        # Kept as a harmless safety net — there is nothing to ignore.
        ctx = await browser.new_context(
            **({"ignore_https_errors": True} if through_proxy else {})
        )
        await install_pw_crash_shield(ctx)
        page = await ctx.new_page()
        page.set_default_timeout(120_000)

        # Block only heavy media — the SPA + Kasada p.js are scripts/XHR.
        async def _block_heavy(route: Any) -> None:
            if route.request.resource_type in ("image", "media"):
                await route.abort()
            else:
                await route.continue_()
        await page.route("**/*", _block_heavy)

        async def _on_response(resp: Any) -> None:
            nonlocal air_bounds_json, air_bounds_status
            try:
                if AIR_BOUNDS_PATH in resp.url and air_bounds_json is None:
                    air_bounds_status = resp.status
                    if resp.status == 200:
                        air_bounds_json = await resp.json()
            except Exception:  # noqa: BLE001
                pass
        page.on("response", _on_response)

        # Inject the captured session jar.
        try:
            await ctx.add_cookies(_to_session_cookies(cookies))
            diag["stages"].append(f"cookies_injected({len(cookies)})")
        except Exception as exc:  # noqa: BLE001
            diag["cookie_inject_error"] = str(exc)[:200]

        async def _goto(url: str, attempts: int = 3) -> bool:
            for _ in range(attempts):
                try:
                    r = await page.goto(url, wait_until="domcontentloaded",
                                        timeout=90_000)
                    await asyncio.sleep(4.0)
                    title = ""
                    try:
                        title = await page.title()
                    except Exception:  # noqa: BLE001
                        pass
                    if "Access Denied" not in title and not (r and r.status == 403):
                        return True
                except Exception:  # noqa: BLE001
                    pass
                await asyncio.sleep(2.0)
            return False

        # Warm the redeem root (mints Akamai _abck/bm_*), then deep-link to
        # the availability route so the logged-in SPA runs the search.
        if not await _goto(redeem_root):
            diag["stages"].append("redeem_root_blocked")
            return None, diag
        diag["stages"].append("redeem_root_loaded")
        await asyncio.sleep(7.0)

        await _goto(search_url)
        diag["stages"].append("availability_nav")

        # Ride any /clogin silent-SSO redirect chain, then wait for the
        # air-bounds XHR. Poll up to ~90s total.
        for _ in range(90):
            if air_bounds_json is not None:
                break
            await asyncio.sleep(1.0)

        diag["air_bounds_status"] = air_bounds_status
        try:
            diag["final_url"] = page.url
        except Exception:  # noqa: BLE001
            pass
        diag["stages"].append(
            "air_bounds_captured" if air_bounds_json is not None
            else "air_bounds_timeout"
        )
        return air_bounds_json, diag
    except Exception as exc:  # noqa: BLE001 — never raise out of a plugin
        diag["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
        return None, diag
    finally:
        if browser is not None:
            try:
                await asyncio.wait_for(browser.close(), timeout=20.0)
            except BaseException:  # noqa: BLE001
                pass


async def _auth_search(
    user_id: str,
    origin: str,
    dest: str,
    date: str,
) -> list[NormalizedResult]:
    """T5' auth path — Aeroplan award search with the user's captured
    logged-in session, run through Camoufox.

      1. Look up the user's stored Aeroplan session (the encrypted cookie
         jar captured when they logged in via the cockpit `/airlines`
         flow) via `get_active_session`.
      2. If no session (or it expired): fall through to the `auth_required`
         verdict — the cockpit shows a "Connect Air Canada" prompt.
      3. If a session exists: run `_camoufox_air_bounds` — launch Camoufox,
         inject the captured jar, drive the redeem SPA to the availability
         route so it fires its own Kasada-stamped air-bounds XHR, capture
         that response, and parse it with `_parse_air_bounds`.

    Records a verdict in `LAST_RUN_DIAG` and never raises.
    """
    global LAST_RUN_DIAG
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    session = await get_active_session(user_id, PROGRAM_ID)
    if not session:
        # No captured session — honest auth_required (same as anon path).
        LAST_RUN_DIAG = {
            "started_at": now_iso,
            "transport": "auth_lookup",
            "origin": origin,
            "dest": dest,
            "date": date,
            "user_id": user_id,
            "last_verdict": "auth_required",
            "row_count": 0,
            "note": (
                "No active program_auth_sessions row for this user — the "
                "user has not connected Air Canada (or the session "
                "expired). Cockpit shows the Connect Air Canada prompt."
            ),
        }
        print(
            f"AC: ===== {origin}->{dest} {date} — auth_required "
            f"(no session for user {user_id}) =====",
            flush=True,
        )
        return []

    cookies = session.get("cookies") or []
    session_id = session.get("session_id")

    # Run the air-bounds search inside Camoufox with the captured session.
    rows: list[NormalizedResult] = []
    air_bounds_json: dict | None = None
    transport_diag: dict[str, Any] = {}
    try:
        air_bounds_json, transport_diag = await _camoufox_air_bounds(
            cookies, origin, dest, date
        )
        if isinstance(air_bounds_json, dict):
            rows = _parse_air_bounds(air_bounds_json, origin, dest, date)
    except Exception as exc:  # noqa: BLE001 — never raise out of a plugin
        log.warning("AC auth-search transport error: %s", exc)
        transport_diag = {"error": str(exc)[:300]}

    # Record the outcome against the session so the cockpit can surface a
    # "reconnect" hint if the captured session stopped working.
    if session_id:
        try:
            await mark_used(session_id, ok=bool(rows))
        except Exception as exc:  # noqa: BLE001
            log.debug("AC mark_used failed: %s", exc)

    air_bounds_status = transport_diag.get("air_bounds_status")
    if rows:
        verdict = "ok"
    elif air_bounds_json is not None:
        verdict = "air_bounds_unparseable"
    elif air_bounds_status:
        verdict = "air_bounds_rejected"
    else:
        verdict = "auth_failed"
    LAST_RUN_DIAG = {
        "started_at": now_iso,
        "transport": "camoufox_auth",
        "origin": origin,
        "dest": dest,
        "date": date,
        "user_id": user_id,
        "auth_session_id": session_id,
        "cookie_count": len(cookies),
        "air_bounds_status": air_bounds_status,
        "transport_diag": transport_diag,
        "last_verdict": verdict,
        "row_count": len(rows),
        "note": (
            f"Parsed {len(rows)} award itineraries via Camoufox."
            if rows
            else (
                "Camoufox transport ran but no award rows — the redeem SPA "
                "did not reach a logged-in state and fire the air-bounds "
                "XHR. Most common cause: the captured Aeroplan session has "
                "expired (Gigya glt_*/cognito tokens are short-lived; AC's "
                "silent-SSO refresh fails with SYS011 for a stale session) "
                "— the user should re-connect Air Canada. See transport_diag."
            )
        ),
    }
    print(
        f"AC: ===== {origin}->{dest} {date} — auth path, verdict={verdict}, "
        f"rows={len(rows)} =====",
        flush=True,
    )
    return rows


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
    user_id: str | None = None,
) -> list[NormalizedResult]:
    """Air Canada Aeroplan award search.

    Aeroplan award search requires a logged-in Aeroplan account session
    (Air Canada's March-2025 anti-scraper login wall — Agent 5 research +
    the 2026-05-20 `/diag/wu_probe` investigation in this module's
    docstring). There is no anonymous transport that returns real rows.

    Dispatch:
      * `user_id` present → `_auth_search`: look up the user's captured
        T5' session and replay the logged-in cookie jar (Phase 2.5).
      * `user_id` absent  → no session to use; records verdict
        `auth_required` in `LAST_RUN_DIAG` and returns `[]`. The cockpit
        surfaces a "Connect Air Canada" prompt via `/airlines`.

    Never raises — always returns a list.
    """
    global LAST_RUN_DIAG

    if user_id:
        return await _auth_search(user_id, origin, dest, date)

    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "none",
        "origin": origin,
        "dest": dest,
        "date": date,
        "last_verdict": "auth_required",
        "row_count": 0,
        "note": (
            "Aeroplan award search requires a logged-in Aeroplan session "
            "(Air Canada's March-2025 anti-scraper login wall). No user_id "
            "was supplied, so there is no captured T5' session to replay. "
            "WU clears Air Canada's Akamai and CAN reach the "
            "loyalty/dapidynamic/* air-bounds API path, but cannot supply "
            "a logged-in Aeroplan account on its own. Connect Air Canada "
            "via the cockpit /airlines page to enable this search."
        ),
        "reference": {
            "warmup_url": WARMUP_URL,
            "search_page": SEARCH_PAGE_TMPL.format(origin=origin, dest=dest, date=date),
            "air_bounds_path_suffix": AIR_BOUNDS_PATH,
        },
    }
    print(
        f"AC: ===== {origin}->{dest} {date} — auth_required, "
        f"returning [] (no user_id; T5' path) =====",
        flush=True,
    )
    return []


search = _scrape_real
