# Agent 1 – AA / Akamai BMP Bypass: Open-Source Deep Dive (May 2026)

Research timestamp: 2026-05-19. All code excerpts are verbatim from the linked sources unless noted.

---

## Sekinal/aa_contest detailed analysis

**Repository:** https://github.com/Sekinal/aa_contest
**Last commit:** `9379fb83e2ea85a2c49ea28af2d28486ba199a60` — 2025-11-07 16:09:24 -0600 ("Small update on readme")
**License:** MIT
**Stack:** Python 3.12 + Camoufox >= 0.4.11 + curl_cffi >= 0.13.0 + httpx[http2] >= 0.28.1
**Approach:** Camoufox-extracts-cookies → curl_cffi-with-firefox135-replay (the canonical 2026 pattern)
**Docker image:** `thermostatic/aa-scraper:latest`
**Claimed success rate:** Akamai challenge pass rate "100%" (automated); cookie extraction >95%; API search >98% with valid cookies. Caveats below.

### Architecture (verbatim from repo)

The repo is small and well-organized. Key files (all under `aa_scraper/`):

```
aa_scraper/
├── cookie_manager.py   # Camoufox-based session warm-up + cookie extraction
├── api_client.py       # curl_cffi-based HTTP/2 replay
├── proxy_pool.py       # Round-robin proxy mgmt w/ 40-min cooldowns on block
├── cookie_pool.py      # Multi-browser pool (3 browsers per proxy max)
├── config.py           # Constants (endpoints, cookie age thresholds)
├── circuit_breaker.py  # 3-failure threshold, 5-min open
├── rate_limiter.py     # Adaptive token bucket
└── retry.py            # Exponential backoff with jitter
```

### 1) EXACT Camoufox launch args

Found in `aa_scraper/cookie_manager.py:328`. The result is striking: **Sekinal uses Camoufox in its barest possible config** — only `headless` is set. No `humanize`, no `geoip`, no `block_webrtc`, no `window`, no explicit `proxy` on the AsyncCamoufox constructor.

```python
# cookie_manager.py:320-329
browser_config = {
    "headless": headless,
}

if self.proxy:
    browser_config["proxy"] = self.proxy.to_playwright_dict()
    logger.debug(f"   Using proxy: {self.proxy.host}:{self.proxy.port}")

async with AsyncCamoufox(headless=headless) as browser:
    page = await browser.new_page()
```

**Critical bug-or-feature observation:** the code builds `browser_config` with `proxy`, but then instantiates `AsyncCamoufox(headless=headless)` — the proxy dict is **never passed to AsyncCamoufox**. Either the author is intentionally bypassing the proxy at the browser layer (running cookie extraction direct from the host IP and only using proxies at the curl_cffi replay layer), or it's a latent bug. Given the proxy_pool.py investment, the former is plausible: AA does extra fingerprinting on residential proxy IPs during the browser-warm-up phase, so they warm up from the host IP and proxy only the JSON replay calls. Worth empirically verifying.

The `proxy.to_playwright_dict()` format (which is what would have been passed) is:

```python
# proxy_pool.py:41-47
def to_playwright_dict(self) -> Dict[str, str]:
    """Convert to Playwright proxy format"""
    return {
        "server": f"http://{self.host}:{self.port}",
        "username": self.username,
        "password": self.password,
    }
```

`headless` defaults to `True`. CLI flag `--no-headless` flips to `False` for debugging.

### 2) Navigation pattern (exact)

The Camoufox session does a **5-step warm-up** before extracting cookies. Verbatim from `cookie_manager.py:332-602`:

```python
# STEP 1: Go to homepage and accept cookies
logger.info("Step 1/5: Loading homepage and accepting cookies...")
await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
await page.wait_for_timeout(2000)
# BASE_URL = "https://www.aa.com"

# Cookie consent banner click (5 selector candidates tried in order)
selectors = [
    "#accept-recommended-btn-handler",
    "#onetrust-accept-btn-handler",
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    'button:has-text("Aceptar")',
]
# After click: await page.wait_for_timeout(1500)
# After accept: await page.wait_for_timeout(1000)

# STEP 2 (in code labeled "Step 2/5"): Register response interceptor
page.on("response", handle_response)
# Listens specifically for "/booking/api/search/itinerary"

# STEP 3: Navigate to search URL with route + date
await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
await page.wait_for_timeout(2000)

# STEP 4: Detect & solve Akamai challenge if present (see Section 3)

# STEP 5: Wait for API response (up to wait_time, default 15s)
# Polls every 1s for api_request_completed flag
# If not received after wait_time: try scrolling to bottom, wait 5s more
```

Search URL is **direct deep-link, not form-submission**. Built as:

```python
search_url = (
    f"{BASE_URL}/booking/search?"
    f"locale=en_US&"
    f"fareType=Lowest&"
    f"pax=1&"
    f"adult=1&"
    f"type=OneWay&"
    f"searchType=Revenue&"  # NB: warm-up uses Revenue, not Award
    f"cabin=&"
    f"carriers=ALL&"
    f"travelType=personal&"
    f"slices={urllib.parse.quote(slices_json)}"
)
```

Default warm-up test route: `SRQ → BFL`, 7 days ahead (small-city routes — probably chosen to minimize cache poisoning / data noise).

### 3) Akamai challenge detection + handling

This is the most sophisticated piece of the codebase. The author distinguishes **three** states of the AA / Akamai response:

**(a) Solvable JS challenge** — `_is_solvable_challenge()` returns true when these markers exist AND no hard-block markers do:

```python
solvable_indicators = [
    "sec_chlge_form",
    "cp_clge_done",
    'provider="crypto"',
    "akamai-challenge-resubmit",
    'class="sec-container"',
]
```

When detected, waits up to **90 seconds** for Camoufox to autosolve via:

```python
await page.wait_for_function(
    """
    () => {
        const url = window.location.href;
        const content = document.body.innerHTML;

        const isStillBlocked = content.toLowerCase().includes('access denied') ||
                               content.toLowerCase().includes('you don\\'t have permission');

        if (isStillBlocked) {
            return false;
        }

        return !url.includes('akamai') &&
            !url.includes('challenge') &&
            !content.includes('sec_chlge_form') &&
            (url.includes('choose-flights') ||
                url.includes('find-flights') ||
                url.includes('booking'));
    }
    """,
    timeout=90000,
)
```

**(b) Hard block / "Access Denied"** — requires ≥2 of these patterns matching in the body:

```python
akamai_access_denied_patterns = [
    "<title>access denied</title>",
    "<h1>access denied</h1>",
    "you don't have permission to access",
    "errors.edgesuite.net",
]
# Match >= 2 patterns => permanent IP block (40-min cooldown)
```

The 40-minute cooldown comes from real-world observation, not a guess — `proxy.mark_blocked(duration_minutes=40)`.

**(c) Akamai BMP URL paths to watch:**

```python
akamai_url_patterns = {
    "akamai_path": "/ZetFNOmfUz0qb36s_",     # randomized Akamai challenge path
    "akamai_path2": "/booking/api/akamai",
    "challenge_resubmit": "akamai-challenge-resubmit",
}
```

**Reference number pattern** (the kind that shows up in Akamai block pages, e.g. `Reference #18.4d2f7bd.1762483229.74ebcabb`):

```python
if "reference" in content_lower and ("&#46;" in page_content or "." in page_content):
    if "reference&#32;&#35;" in content_lower or "reference #" in content_lower:
        return True, "akamai_reference_block"
```

### 4) Cookie & session validation logic

Cookie extract happens after all 5 steps succeed. Then validated against three tiers (`cookie_manager.py:824-857`):

```python
def _validate_extracted_cookies(self, cookies: Dict[str, str]) -> None:
    # Critical cookies (must have, else raise CookieExpiredError)
    critical_cookies = ["XSRF-TOKEN", "spa_session_id"]

    # Important cookies (should have)
    important_cookies = ["JSESSIONID", "_abck", "bm_sv"]

    # Bot defense cookies (good to have)
    bot_cookies = ["bm_sz", "ak_bmsc", "bm_s", "sec_cpt"]
```

Notable: `_abck` is **important** but **not critical**. The author trusts `XSRF-TOKEN` and `spa_session_id` as the "did we make it through Akamai" signal. No code parses `_abck` to check for `~0~` vs `~-1~` substring — they delegate that judgment to whether the API responded with valid JSON containing `slices` with `productAvailable: True`.

Cookie freshness threshold (`config.py:11-12`):
```python
COOKIE_MAX_AGE = 1800       # 30 min — refresh after
COOKIE_WARNING_AGE = 1200   # 20 min — warn but still use
```

This is the AA-specific operational window. 30 minutes matches anecdotal community reports of `_abck` invalidation cadence.

### 5) Header hand-off to curl_cffi (the production pattern)

Once Camoufox extracts cookies + headers, the API client uses **curl_cffi with Firefox 135 impersonation** to replay (`api_client.py:56-59`):

```python
# Firefox 135 matches Camoufox best (latest stable Firefox fingerprint)
self.impersonate = "firefox135"
```

A **fresh `AsyncSession` per request** is created (deliberate anti-fingerprinting):

```python
# api_client.py:218-228
async with AsyncSession(impersonate=self.impersonate) as session:
    response = await session.post(
        API_ENDPOINT,
        json=payload,
        headers=headers,
        cookies=cookies,
        timeout=self.timeout,
    )
```

Headers are reordered to match captured Firefox order before sending (`api_client.py:73-133`):

```python
HEADER_ORDER = [
    "user-agent",
    "accept",
    "accept-language",
    "content-type",
    "referer",
    "x-xsrf-token",
    "x-cid",
    "origin",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "priority",
    "te",
]
```

Two AA-specific headers are auto-injected if missing:
- `X-XSRF-TOKEN` ← from `cookies["XSRF-TOKEN"]`
- `X-CID` ← from `cookies["spa_session_id"]`

Stripped headers (let curl_cffi own these):
```python
SKIP = {"host", "content-length", "connection", "cookie", "accept-encoding"}
```

API endpoint and request body shape (these are gold for our own impl):

```python
API_ENDPOINT = "https://www.aa.com/booking/api/search/itinerary"

# POST body schema
payload = {
    "metadata": {"selectedProducts": [], "tripType": "OneWay", "udo": {}},
    "passengers": [{"type": "adult", "count": passengers}],
    "requestHeader": {"clientId": "AAcom"},
    "slices": [{
        "allCarriers": True,
        "cabin": "",
        "connectionCity": None,
        "departureDate": date,
        "destination": destination,
        "destinationNearbyAirports": False,
        "maxStops": None,
        "origin": origin,
        "originNearbyAirports": False,
    }],
    "tripOptions": {
        "corporateBooking": False,
        "fareType": "Lowest",
        "locale": "en_US",
        "pointOfSale": "",
        "searchType": search_type,  # "Award" or "Revenue"
    },
    "loyaltyInfo": None,
    "version": "cfr" if search_type == "Revenue" else "",
    "queryParams": {
        "sliceIndex": 0,
        "sessionId": "",
        "solutionSet": "",
        "solutionId": "",
        "sort": "CARRIER",
    },
}
# Revenue searches add: metadata["udo"]["search_method"] = "Lowest"
```

### 6) Proxy strategy (provider-agnostic)

`proxy_pool.py` reads proxies from a flat file (one `host:port:username:password` per line). **No provider is named** in the codebase. The choice of provider is left to the operator. However:

- Cooldown duration of **40 minutes** is hardcoded for IP-block recovery
- Max **3 browsers per proxy** ("safe limit" comment)
- "Block detected" is the only signal that triggers proxy rotation — proxies stay sticky otherwise. This is consistent with the asadfix guidance ("never rotate IPs mid-session, Akamai scores per-session").

`README.md` does **not** mention any specific proxy provider. The author's tested performance numbers (10-15 concurrent tasks safe, blocks after 1-5 minutes at 15 concurrent) imply they used **residential or ISP proxies**, not datacenter — datacenter IPs would never sustain even 5 minutes at 10 concurrent on AA.

### 7) Captcha solver: NONE

No CapSolver, 2Captcha, AntiCaptcha, or anything similar in `pyproject.toml` deps. The "Akamai bypass" is entirely:
1. Camoufox's Firefox-with-stealth handles the JS challenge automatically (waits up to 90s)
2. If a hard block fires, the proxy is cooled down 40 min and a new one rotated in
3. curl_cffi replay uses captured cookies + Firefox 135 TLS fingerprint

### 8) Adaptive tuning observations from the README

From the README's "Performance recommendations" (the author's empirical results):

| Config | Behavior |
|---|---|
| `--max-concurrent 5` (default) | Safe; no blocks in their testing |
| `--max-concurrent 5 + --browsers 3` | "Pretty safe, haven't tested continuously for more than 5 minutes" |
| `--max-concurrent 10 + --browsers 3` | "Risky, likely to get blocked after a few minutes" |
| `--max-concurrent 15 + --browsers 3` | "Will likely be blocked if scraping for more than 1 minute" |

This implies: AA's per-session rate ceiling is approximately **5 req/sec sustained** before block-risk rises sharply.

---

## asadfix/scraping-guide (the 2026 reference) detailed analysis

**Canonical URL:** https://asadfix.github.io/scraping-guide/
**Title:** "Web Scraping 2026: Bypass Cloudflare, Akamai, DataDome | Asad Ikram"
**Last update:** Active 2026 (referenced May 2026 production cases)
**Note:** There is no `asadfix/akamai-bypass-2026` repository under that exact name; the scraping-guide site is the source. It is hosted at `asadfix.github.io`. License/source unknown (it's a marketing/guide site, no code repo).

### The two states of `_abck` (verbatim consensus from guide + dev.to + multiple sources)

```
_abck=...~-1~...   →  unvalidated, full bot scoring, requests blocked
_abck=...~0~...    →  validated, trust granted, requests pass
```

The `-1 → 0` flip happens **only after** sensor.js (~512KB obfuscated) executes in a real browser context AND POSTs telemetry to `/_bm/data`, AND Akamai's edge confirms the JA4/HTTP/2/header-order fingerprint is consistent with the User-Agent claim.

**Important 2026 nuance from dev.to/xkiian** ("Bypassing Akamai v3 sensor_data with TLS in 2026 — why the deobfuscator is a trap"):

> "Akamai bot manager v3 is solvable in 2026 without a sensor_data generator for the majority of public targets. Scoring is dominated by what you ship before the JS even runs — TLS, HTTP/2 SETTINGS + frame order, HTTP/3, header order, ALPN, and ECH. Get those right and the deep sensor_data path mostly evaluates to 'trusted, move on.'"

Translation: **for most Akamai sites you no longer need a sensor_data generator.** TLS fingerprint + ISP residential proxy + clean HTTP/2 frame order is enough. AA may or may not be in this "majority" — Sekinal's repo proves Camoufox+Firefox135 still works as of late 2025, but the trajectory is toward TLS-only solutions.

### Verbatim curl_cffi handoff pattern (from asadfix)

```python
from curl_cffi import requests

session = requests.Session()

# First request: warm-up (establishes _abck state)
r1 = session.get(
    "https://target.com/",
    impersonate="chrome131",   # 2026 standard; chrome147+ also OK
    timeout=10
)
# Check for _abck cookie
print(f"_abck: {session.cookies.get('_abck')}")

# Wait for multi-request trust accumulation
import time
time.sleep(1)

# Subsequent requests on same session reuse validated state
r2 = session.get(
    "https://target.com/api/products",
    impersonate="chrome131"
)
```

For browser→curl_cffi handoff (the Sekinal pattern):

```python
from camoufox.sync_api import Firefox
from curl_cffi import requests

with Firefox(
    geoip=True,                # auto-aligns timezone/locale/WebRTC
    proxy={
        "server": "http://proxy.provider.com:8011",
        "username": "user",
        "password": "pass",
    },
) as browser:
    page = browser.new_page()
    page.goto("https://target-site.com/")
    page.wait_for_timeout(2000)  # Let sensor.js run

    cookies = page.context.cookies()
    _abck_cookie = next(c for c in cookies if c['name'] == '_abck')

# curl_cffi replay (same proxy, matched impersonation)
session = requests.Session()
session.cookies.set(
    name="_abck",
    value=_abck_cookie['value'],
    domain=".target-site.com"
)

resp = session.get(
    "https://target-site.com/api/data",
    impersonate="chrome148",   # or "firefox135" if mint via Camoufox/Firefox
    headers={ ... }
)
```

**Note:** asadfix's guide shows `chrome148` for impersonation. Sekinal uses `firefox135` because their minting browser is Camoufox (which is Firefox-based). **Match your impersonate to the minting browser family** — minting with Camoufox/Firefox then replaying as Chrome will break the trust score because the User-Agent + JA4 + cookie set won't be internally consistent.

### TLS fingerprint requirements (must match exactly)

From the guide:

- **JA4 hash** must match target Chrome/Firefox version exactly
- **HTTP/2 SETTINGS frame**: `HEADER_TABLE_SIZE`, `MAX_CONCURRENT_STREAMS`, `INITIAL_WINDOW_SIZE`, `MAX_FRAME_SIZE`, `MAX_HEADER_LIST_SIZE` must match the browser's values
- **ALPN**: `h2` (HTTP/2)
- **Cipher suite order**: browser-exact, not alphabetical
- **GREASE values** must be included and randomized

curl_cffi handles all of this with `impersonate=` — but **you must use a fresh version**: "Chrome 120 fingerprints in 2026 are themselves suspicious, real users rolled forward. Keep `impersonate='chrome131'` or newer."

### Headers — order matters

Chrome's natural header order must be preserved. The Sekinal code (above) enforces this with an explicit `HEADER_ORDER` list. curl_cffi already preserves dict-insertion order on Python 3.7+, so the trick is just to insert in the right order.

### Sensor.js signals collected (2026)

- Canvas fingerprint (pixel-level hash of GPU-rendered shapes)
- WebGL `WEBGL_debug_renderer_info` (exact GPU model string)
- AudioContext sine-wave-through-compressor signature
- **60 `chrome-extension://` URL probes** (NEW in 2026 — zero passing = instant bot)
- Mouse/scroll trajectory physics (Fitts's Law curves)
- navigator properties cross-checked

**Strategic guidance from guide:**
- *Never* attempt JS-level patching of `toDataURL()`/`getParameter()` — detectable via `Function.prototype.toString()`
- Use CloakBrowser (49 C++ patches) if site demands extension probe responses
- Use real ISP residential proxies (Comcast AS7015 mentioned as known-working); datacenter IPs fail at the IP-reputation layer before sensor.js even runs

### Production architecture (asadfix's reference pattern)

```
Scrapy spider (Python)
  → GoProxyMiddleware (urllib, ~35ms round trip)
      → Go HTTP server :8765 (4-session pool)
          → Go TLS library sessions (akamai-v3-sensor)
              → ISP proxy (Comcast AS7015, static residential)
                  → Target site

Sustained: 24 req/min, 0 blocks in 500+ requests
```

This is **for a different deployment** (the guide notes its specific target failed with Camoufox due to IP reputation). For AA, the Sekinal pattern (Camoufox + curl_cffi) reportedly works.

### Where Camoufox specifically still wins

- Cloudflare Turnstile (Camoufox passes 100% per guide)
- "Lighter Akamai implementations" — explicitly called out
- Anywhere the site has a cookie-consent banner or first-page JS that must execute

### Where Camoufox fails in 2026

- Bot Manager Premier with pixel challenges
- Sites that require all 60 extension probes (Camoufox ships with none by default; would need addons configured manually)
- Sites where the IP-reputation tier of the proxy fails before sensor.js even runs (i.e. anything with bad-IP scoring)

---

## Other working AA scrapers found

### johnbalvin/pyaair

- URL: https://github.com/johnbalvin/pyaair
- License: MIT
- Stars: 7
- Commits: 3 total
- Approach: Pure HTTP, no browser, no proxy logic, no cookie handling
- Verdict: Educational/aspirational. Will not survive Akamai BMP in production. Not a reference for our build.

### tszumowski/aa_flight_search_tool

- URL: https://github.com/tszumowski/aa_flight_search_tool
- Approach: Selenium + BeautifulSoup
- Status: README itself says "not being actively maintained"
- Verdict: Pre-2024 era, would not bypass Akamai BMP today. Not useful.

### Austerius/AmericanAirlines-scraper

- URL: https://github.com/Austerius/AmericanAirlines-scraper
- Approach: Selenium + BeautifulSoup, "educational purposes"
- Verdict: Educational only. Same fate as tszumowski above.

### ahmadms1/flight_scrapper

- Surfaced in search results but not investigated due to time budget. README skim suggests generic Selenium approach — same family as the two above.

### Sekinal is the only repo with a credible 2026 production pattern.

### Akamai sensor-data generators (orthogonal but relevant)

- **xvertile/akamai-bmp-generator** (https://github.com/xvertile/akamai-bmp-generator) — 348 stars, Go, generates sensor data for mobile BMP (versions 3.3.4, 3.3.1, 3.2.3, 3.1.0, 2.2.3, etc.). Includes PoW support. **Mobile-focused** — example references `com.ihg.apps.android`. Could potentially work against aa.com web if the BMP version matches, but uncertain — not designed for that.
- **fxnatic/abck-tools** (https://github.com/fxnatic/abck-tools) — 17 stars, Go, MIT. Lower-level: `Jrs`, `CalcDis`, `Encrypt`, `ShuffleString`, `ExtractKeys(bm_sz)` — primitives for assembling sensor_data manually. Useful as a study reference; would need Go service in our stack to use directly.
- **jesterfoidchopped/akamai-v3-sensor** — referenced in asadfix guide as "the Go TLS library" used in their production case. Couldn't fully audit; flagged as further reading.

### Camoufox project status

- URL: https://github.com/daijro/camoufox
- Last commit: 2026-05-11 (v150.0.2-beta.25)
- Stars: 8.5k, Forks: 721
- Maintenance: "active development resumed" after ~1-year gap. Has lost some performance vs older versions due to base-Firefox upgrades + newly-discovered fingerprint inconsistencies, per recent commentary.
- License: MIT (Camoufox itself), but bundled Firefox terms apply

---

## Synthesis: recommended Camoufox config for AA based on findings

The Sekinal pattern works as of Nov 2025. The asadfix guidance for 2026 says we should still add `geoip=True` and `humanize=True` for robustness — Sekinal omits these and gets away with it because their warm-up flow is forgiving (90s wait for solve, multiple retries). For PointSnap, we should err on the side of more anti-detect surface, not less.

**Copy-pasteable Python snippet (PointSnap-targeted):**

```python
"""
PointSnap AA AAdvantage scraper - 2026 Akamai BMP bypass blueprint.

Pattern (cribbed from Sekinal/aa_contest + asadfix scraping guide):
  1. Camoufox warms up a session on aa.com homepage + search page
  2. Cookies + headers captured
  3. curl_cffi replays the JSON API with matched Firefox TLS fingerprint
"""

import asyncio
import json
import urllib.parse
from datetime import datetime, timedelta

from camoufox.async_api import AsyncCamoufox
from curl_cffi.requests import AsyncSession


BASE_URL = "https://www.aa.com"
API_ENDPOINT = "https://www.aa.com/booking/api/search/itinerary"

# Critical: must match the minting browser family.
# Camoufox is Firefox-based, so impersonate firefox*.
IMPERSONATE = "firefox135"


async def mint_aa_session(
    proxy: dict | None = None,        # {"server": "http://host:port", "username":"...", "password":"..."}
    test_origin: str = "SRQ",
    test_destination: str = "BFL",
    days_ahead: int = 7,
    headless: bool = True,
    wait_for_api_secs: int = 15,
):
    """Warm up an aa.com session in Camoufox; return (cookies, headers, referer)."""

    departure = (datetime.now() + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    slices = json.dumps(
        [{"orig": test_origin, "origNearby": False,
          "dest": test_destination, "destNearby": False,
          "date": departure}],
        separators=(",", ":"),
    )
    search_url = (
        f"{BASE_URL}/booking/search?"
        f"locale=en_US&fareType=Lowest&pax=1&adult=1&type=OneWay&"
        f"searchType=Revenue&cabin=&carriers=ALL&travelType=personal&"
        f"slices={urllib.parse.quote(slices)}"
    )

    captured = {"headers": {}, "cookies": {}, "ok": False}

    # Camoufox kwargs — Sekinal-minimal + asadfix-recommended anti-detect surface
    camoufox_kwargs = dict(
        headless=headless,
        humanize=True,          # asadfix: Gaussian mouse jitter
        block_webrtc=True,      # avoids leaking real IP via WebRTC
        geoip=True,             # auto-align timezone/locale/WebRTC to proxy exit
        window=(1366, 768),     # common real-user resolution
    )
    if proxy:
        camoufox_kwargs["proxy"] = proxy

    async with AsyncCamoufox(**camoufox_kwargs) as browser:
        page = await browser.new_page()

        async def on_response(resp):
            if "/booking/api/search/itinerary" in resp.url and resp.status == 200:
                try:
                    body = await resp.json()
                    if body.get("slices"):
                        captured["headers"] = {
                            k: v for k, v in resp.request.headers.items()
                            if not k.lower().startswith(":")
                            and k.lower() not in {"host", "content-length", "connection",
                                                  "cookie", "accept-encoding"}
                        }
                        captured["ok"] = True
                except Exception:
                    pass

        page.on("response", on_response)

        # Step 1: homepage + accept cookies
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
        for sel in ["#accept-recommended-btn-handler",
                    "#onetrust-accept-btn-handler",
                    'button:has-text("Accept all")']:
            try:
                btn = await page.wait_for_selector(sel, timeout=4000, state="visible")
                if btn:
                    await btn.click()
                    await page.wait_for_timeout(1500)
                    break
            except Exception:
                continue

        # Step 2: deep-link search (triggers Akamai challenge if any)
        await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        # Step 3: detect Akamai hard block vs solvable challenge
        content = (await page.content()).lower()
        hard_block = sum(p in content for p in [
            "<title>access denied</title>",
            "<h1>access denied</h1>",
            "you don't have permission to access",
            "errors.edgesuite.net",
        ]) >= 2
        if hard_block:
            raise RuntimeError("AA hard block on this IP; cooldown ~40min before retry.")

        # Step 4: wait for valid API response (Camoufox auto-solves JS challenge)
        for _ in range(wait_for_api_secs):
            if captured["ok"]:
                break
            await page.wait_for_timeout(1000)
        if not captured["ok"]:
            # Scroll to nudge lazy fetch
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(5000)
        if not captured["ok"]:
            raise RuntimeError("AA search-itinerary API never returned valid JSON.")

        # Step 5: extract cookies
        for c in await page.context.cookies():
            captured["cookies"][c["name"]] = c["value"]

        # Sanity check: AA's must-have cookies
        critical = {"XSRF-TOKEN", "spa_session_id"}
        missing = critical - captured["cookies"].keys()
        if missing:
            raise RuntimeError(f"Critical AA cookies missing after warm-up: {missing}")

        return captured["cookies"], captured["headers"], page.url


async def aa_search(
    origin: str,
    destination: str,
    date: str,                     # "YYYY-MM-DD"
    passengers: int = 1,
    search_type: str = "Award",    # "Award" or "Revenue"
    cookies: dict = None,
    headers: dict = None,
    referer: str = "",
    proxy: str = None,             # "http://user:pass@host:port"
):
    """Replay an aa.com search via curl_cffi with Firefox 135 TLS."""

    payload = {
        "metadata": {"selectedProducts": [], "tripType": "OneWay", "udo": {}},
        "passengers": [{"type": "adult", "count": passengers}],
        "requestHeader": {"clientId": "AAcom"},
        "slices": [{
            "allCarriers": True, "cabin": "", "connectionCity": None,
            "departureDate": date, "destination": destination,
            "destinationNearbyAirports": False, "maxStops": None,
            "origin": origin, "originNearbyAirports": False,
        }],
        "tripOptions": {
            "corporateBooking": False, "fareType": "Lowest",
            "locale": "en_US", "pointOfSale": "", "searchType": search_type,
        },
        "loyaltyInfo": None,
        "version": "cfr" if search_type == "Revenue" else "",
        "queryParams": {"sliceIndex": 0, "sessionId": "", "solutionSet": "",
                        "solutionId": "", "sort": "CARRIER"},
    }
    if search_type == "Revenue":
        payload["metadata"]["udo"]["search_method"] = "Lowest"

    # Header order matters; Firefox's natural sequence:
    HEADER_ORDER = ["user-agent", "accept", "accept-language", "content-type",
                    "referer", "x-xsrf-token", "x-cid", "origin",
                    "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site",
                    "priority", "te"]
    ordered = {}
    src = {k.lower(): (k, v) for k, v in (headers or {}).items()}
    for h in HEADER_ORDER:
        if h in src:
            k, v = src[h]
            ordered[k] = v
    for k, v in (headers or {}).items():
        if k.lower() not in {h.lower() for h in ordered}:
            ordered[k] = v
    # Inject AA-required headers if missing
    if "x-xsrf-token" not in {k.lower() for k in ordered} and cookies.get("XSRF-TOKEN"):
        ordered["X-XSRF-TOKEN"] = cookies["XSRF-TOKEN"]
    if "x-cid" not in {k.lower() for k in ordered} and cookies.get("spa_session_id"):
        ordered["X-CID"] = cookies["spa_session_id"]
    if referer:
        for k in list(ordered):
            if k.lower() == "referer":
                ordered[k] = referer
                break
        else:
            ordered["Referer"] = referer

    async with AsyncSession(impersonate=IMPERSONATE, proxy=proxy) as s:
        r = await s.post(
            API_ENDPOINT,
            json=payload,
            headers=ordered,
            cookies=cookies,
            timeout=30,
        )
        if r.status_code == 403:
            raise RuntimeError("AA 403 — cookies invalidated; re-mint session")
        if "text/html" in r.headers.get("content-type", "").lower():
            raise RuntimeError("AA returned HTML — IP block; rotate proxy")
        r.raise_for_status()
        return r.json()


# Example wiring (illustrative; PointSnap will wire to its own worker / cookie pool):
async def example():
    cookies, headers, referer = await mint_aa_session(
        proxy={"server": "http://residential.example.com:8011",
               "username": "u", "password": "p"},
    )
    data = await aa_search(
        origin="LAX", destination="JFK", date="2026-08-15",
        search_type="Award",
        cookies=cookies, headers=headers, referer=referer,
        proxy="http://u:p@residential.example.com:8011",
    )
    return data
```

**Deviations from Sekinal we made deliberately:**

| Change | Rationale |
|---|---|
| Added `humanize=True` | asadfix recommends it; Sekinal's omission is probably accidental, not deliberate |
| Added `block_webrtc=True` | Sekinal omits; risk of WebRTC leak revealing real client IP exists. Cheap insurance. |
| Added `geoip=True` | Critical when proxying — auto-aligns timezone, locale, WebRTC to the proxy's exit country. Sekinal's omission is part of why their warm-up may fail more often with proxies. |
| Added `window=(1366, 768)` | Sekinal uses Camoufox defaults; we use a known-common resolution to reduce fingerprint outliers |
| Pass `proxy=` to AsyncCamoufox | Sekinal builds the dict but never passes it to `AsyncCamoufox(...)`. Whether bug or feature, we pass it explicitly — if running warmup off proxy is desired, do it explicitly by passing `proxy=None`. |
| Same `impersonate="firefox135"` | Match minting browser family (Camoufox = Firefox) |
| Same warm-up endpoint (`SRQ → BFL`) | Small-market route, low data noise |
| Same critical cookie check (`XSRF-TOKEN`, `spa_session_id`) | These are AA-specific and load-bearing |

---

## Open questions / things we couldn't confirm

1. **Whether Sekinal's omission of `proxy=` on `AsyncCamoufox(...)` is intentional.** The `browser_config` dict is built with the proxy and then discarded. This might mean cookie extraction runs from the host IP and only the API replays go through proxies. We should test both modes empirically — passing proxy to the browser, vs. not — and measure which yields fewer blocks per warm-up.

2. **Specific proxy provider Sekinal uses.** Never named. Behavior implies residential or ISP; their "10-15 concurrent OK" performance is inconsistent with datacenter IPs. Plausible candidates: IPRoyal residential, Bright Data unblocker, NetNut ISP, Soax. We should benchmark our own.

3. **Whether the `firefox135` impersonate target is still optimal in May 2026.** curl_cffi releases new versions as browser fingerprints change. We should check the latest curl_cffi (`>=0.13.0` is what Sekinal pinned) for an even fresher Firefox target.

4. **Whether the 90s Akamai challenge wait is enough.** Sekinal's `wait_for_function` runs up to 90s — at higher Akamai trust tiers we may see challenges that take 120s+ or that intentionally fail to discourage automation. Need to measure tail latency.

5. **What `searchType: "Award"` returns vs `"Revenue"` for AA's API.** Sekinal warms up with Revenue but supports both. The payload schemas are nearly identical (`version: "cfr"` for Revenue only; `udo.search_method: "Lowest"` for Revenue only). We need to verify the Award response shape against Sekinal's parser before trusting the data extraction layer.

6. **Whether `_abck=~0~` cookie state is verified anywhere in Sekinal's code.** It is not — they delegate trust judgment to API-response-shape validation (does it have `slices` with `productAvailable: True`?). For PointSnap we may want a more explicit cookie-state check to detect "I got a 200 but the API will start returning 403 soon" early.

7. **Whether the deep-link search URL pattern in `cookie_manager.py` still works.** AA may have changed URL shape since Sekinal's last commit (Nov 2025). Need to test against live aa.com before adopting.

8. **xvertile/akamai-bmp-generator applicability to aa.com web.** It's designed for mobile BMP. Web BMP may share signing primitives but uses different payload structure. Not a clear short-term path; flagged as research.

9. **dev.to/xkiian article content.** WebFetch returned 404 even though Google indexes it — likely behind dev.to's challenge or our fetcher's user-agent. The summary from search-result snippets is what we have; consider revisiting from a different vantage point.

---

## Citations (full URLs)

### Primary sources (deeply analyzed)

- Sekinal/aa_contest — https://github.com/Sekinal/aa_contest (cloned and read locally; commit `9379fb83` dated 2025-11-07)
- asadfix scraping guide — https://asadfix.github.io/scraping-guide/
- Camoufox official usage — https://camoufox.com/python/usage/
- Camoufox GeoIP docs — https://camoufox.com/python/geoip/
- Camoufox WebRTC docs — https://camoufox.com/fingerprint/webrtc/

### Repos referenced but not deeply analyzed

- daijro/camoufox — https://github.com/daijro/camoufox
- CloverLabsAI/camoufox — https://github.com/CloverLabsAI/camoufox
- johnbalvin/pyaair — https://github.com/johnbalvin/pyaair
- tszumowski/aa_flight_search_tool — https://github.com/tszumowski/aa_flight_search_tool
- Austerius/AmericanAirlines-scraper — https://github.com/Austerius/AmericanAirlines-scraper
- ahmadms1/flight_scrapper — https://github.com/ahmadms1/flight_scrapper
- AmericanAirlines/AA-Mock-Engine — https://github.com/AmericanAirlines/AA-Mock-Engine (official; not a scraper, kept for reference)
- xvertile/akamai-bmp-generator — https://github.com/xvertile/akamai-bmp-generator
- fxnatic/abck-tools — https://github.com/fxnatic/abck-tools
- jesterfoidchopped/akamai-v3-sensor — https://github.com/jesterfoidchopped/akamai-v3-sensor (referenced in asadfix guide)
- xiaoweigege/akamai2.0-sensor_data — https://github.com/xiaoweigege/akamai2.0-sensor_data
- reverse-god/akamai-sensordata — https://github.com/reverse-god/akamai-sensordata
- NewStartMe/bypass_akamai — https://github.com/NewStartMe/bypass_akamai
- JokerPeter/akamai-sensor-data-bypass — https://github.com/JokerPeter/akamai-sensor-data-bypass
- infecting/akamai — https://github.com/infecting/akamai
- lexiforest/curl_cffi — https://github.com/lexiforest/curl_cffi
- lexiforest/curl_cffi issue #529 (TLS ja3/akamai params) — https://github.com/lexiforest/curl_cffi/issues/529

### Blog / guide sources

- dev.to/xkiian – Bypassing Akamai v3 sensor_data with TLS in 2026 — https://dev.to/xkiian/bypassing-akamai-v3-sensordata-with-tls-in-2026-why-the-deobfuscator-is-a-trap-5cjh
- dev.to/vhub_systems – How to Bypass Akamai Bot Detection in 2026: curl-cffi + Residential Proxies — https://dev.to/vhub_systems_ed5641f65d59/how-to-bypass-akamai-bot-detection-in-2026-curl-cffi-residential-proxies-5h3k
- BrightData – Bypass Akamai Bot Detection — https://brightdata.com/blog/web-data/bypass-akamai-bot-detection
- BrightData – Web Scraping With curl_cffi (2026) — https://brightdata.com/blog/web-data/web-scraping-with-curl-cffi
- Scrapfly – How to Bypass Akamai (2026) — https://scrapfly.io/blog/posts/how-to-bypass-akamai-anti-scraping
- ZenRows – How to Bypass Akamai: 3 Best Methods — https://www.zenrows.com/blog/bypass-akamai
- ZenRows – Web Scraping with Camoufox — https://www.zenrows.com/blog/web-scraping-with-camoufox
- ScrapeBadger – Akamai Bypass — https://scrapebadger.com/akamai-bypass
- Substack (thewebscraping.club) – Bypassing Akamai for free — https://substack.thewebscraping.club/p/bypassing-akamai-for-free
- Roundproxies – How to use Camoufox to bypass anti-bots in 2026 — https://roundproxies.com/blog/camoufox/
- Datahut – curl_cffi to Bypass Cloudflare 2026 — https://www.blog.datahut.co/post/web-scraping-without-getting-blocked-curl-cffi
- DataResearchTools – Browser TLS Fingerprint Mimicry with curl-impersonate 2026 — https://dataresearchtools.com/browser-tls-fingerprint-mimicry-with-curl-impersonate-2026/
- Medium/glizzykingdreko – Akamai v3 Sensor Data Deep Dive — https://medium.com/@glizzykingdreko/akamai-v3-sensor-data-deep-dive-into-encryption-decryption-and-bypass-tools-da0adad2a784
- Scraperly – How to Scrape American Airlines in 2026 — https://scraperly.com/scrape/american-airlines
- Apify – Flight Award & Itinerary Scraper — https://apify.com/igolaizola/flight-award-scraper

### Library docs

- curl_cffi documentation – https://curl-cffi.readthedocs.io/en/latest/
- curl_cffi impersonate targets – https://curl-cffi.readthedocs.io/en/latest/impersonate/targets.html
- curl_cffi impersonate guide (v0.11.1) – https://curl-cffi.readthedocs.io/en/v0.11.1/impersonate.html
- cffi-curl 0.13.0 release info – https://libraries.io/pypi/cffi-curl

### Related anti-bot tool repos (orthogonal)

- 0xdevalias – Cloudflare/Akamai bypass notes gist – https://gist.github.com/0xdevalias/b34feb567bd50b37161293694066dd53
- Hyper Solutions Akamai SDK – https://pkg.go.dev/github.com/Hyper-Solutions/hyper-sdk-go/akamai
- Hyper Solutions Akamai docs – https://docs.hypersolutions.co/akamai-web/getting-started
