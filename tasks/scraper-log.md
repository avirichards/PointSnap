# Scraper Engineering Log

> **Read this BEFORE attempting any scraper work.** Every session should append findings here. Past dead-ends are expensive to rediscover.

---

## Quick reference: working state (as of 2026-05-19)

| Program | Status | Transport | Notes |
|---|---|---|---|
| VS_FLYING_CLUB | ✅ live | httpx + IPRoyal | Calendar API, no Akamai gating |
| AS_MILEAGEPLAN | ✅ live | httpx + IPRoyal | SvelteKit SSR, light protection |
| AA_AADVANTAGE | 🚧 stuck | Camoufox (debugging) | Akamai BMP wall; see "AA: what's been tried" |
| AC_AEROPLAN | ❌ broken | BD Browser API (migrated, untested) | Parsers likely drifted |
| DL_SKYMILES | ❌ broken | BD Browser API (migrated, untested) | Parsers likely drifted |
| UA_MP | ❌ broken | BD Browser API (migrated, untested) | Imperva — needs investigation |
| BA_AVIOS | ❌ broken | BD Browser API (migrated, untested) | Akamai + queue interstitial |
| AF_FLYINGBLUE | ❌ broken | BD Browser API (migrated, untested) | Parsers likely drifted |
| LH_MILES_MORE | ❌ broken | BD Browser API (migrated, untested) | Parsers likely drifted |
| TK_MILES_SMILES | ❌ broken | BD Browser API (migrated, untested) | Parsers likely drifted |
| NH_ANA | ❌ broken | BD Browser API (migrated, untested) | JSF page, needs selectolax parser fix |
| CX_CATHAY | ❌ broken | BD Browser API (migrated, untested) | Parsers likely drifted |
| AV_LIFEMILES | ❌ broken | BD Browser API (migrated, untested) | Parsers likely drifted |

---

## Tools / services tried

| Tool | Verdict | When | Why |
|---|---|---|---|
| **Patchright + IPRoyal residential** | ✅ for VS/AS, ❌ for everyone with Akamai | Session 3 | IPRoyal blocks AA/DL/AC at CONNECT layer. Even for sites it reaches, Akamai sensor.js detects Patchright. |
| **ScraperAPI proxy (free + premium)** | ❌ | Session 3 | Per-resource billing burned credits; "premium" still failed AA. |
| **Bright Data Browser API (CDP)** | ✅ for non-Akamai sites, ❌ for AA | Session 5 morning | 9/11 airline homepages loaded clean (200 OK with HTML). AA returned 403 Access Denied on most IPs. Some IPs got behavioral-challenge response. |
| **Bright Data Web Unlocker (HTTP API)** | ❌ for HTML, partial for API | Session 5 mid | HTML page fetch errors with `expect_element` waiting for `#weeklyCarousel` (BD's stale AA selector). POST to /booking/api/search/itinerary succeeds but AA returns app-level error 309 (no session state). |
| **CapSolver `AntiAkamaiBMTask`** | ❌ (deprecated) | Session 5 mid | CapSolver dropped Akamai support entirely — task type returns `ERROR_TYPE_NOT_SUPPORTED`. Their docs no longer list Akamai. |
| **2Captcha** | ❌ (never supported BMP) | Session 5 mid | Public docs confirm only reCAPTCHA, AWS WAF, Cloudflare, Geetest. No Akamai. |
| **Camoufox (Firefox-based stealth)** | 🚧 in progress | Session 5 late | Loads www.aa.com but Akamai serves the `sec-if-cpt-container` behavioral challenge interstitial. Sensor.js doesn't validate Camoufox-on-Fly-egress within 40s wait + mouse simulation. |
| **Apify `igolaizola/flight-award-scraper`** | ❌ (constraints don't fit) | Session 5 late | $3/1000 results, 23 programs turnkey BUT hard 60-day date cap (user requires unlimited window) AND missing 4 of our programs (BA, NH, CX, AV). |
| **Seats.aero Pro** | ❌ (user rejected) | Session 5 morning | $9.99/mo, covers ~9 programs incl AA, but user wants DIY ownership. |

---

## AA: what's been tried (failed)

In order of discovery:

1. **Direct GET to /booking/find-flights via BD Browser API**: 403 Access Denied. Akamai path-protection.
2. **Same with Referer=/loyalty/login header**: 1/5 attempts worked on Browser API morning of 2026-05-19 (~20% IP success rate). Could not reproduce reliably; rate degraded to ~0% over the day as Akamai re-flagged BD's pool.
3. **Sticky BD session IDs `aa1-aa24`**: deterministically mapped to specific IPs — drew streaks of 8+ all-blocked IDs. Worse than default rotation.
4. **Random uuid-based session IDs**: same ~0% page-load rate as sticky.
5. **Country rotation (us, ca, gb, jp, au, de) in BD session_id**: no meaningful change. CA exits sometimes got soft-challenge variant (with sensor.js script) but the cookie minted from sensor.js stayed in challenged state (`~-1~-1~-1`).
6. **In-page reload after sensor.js (in same Patchright/BD session)**: cookies preserved across reload but Akamai didn't upgrade `_abck` to trusted (`~0~`) — sensor.js's internal browser-detection flagged Patchright.
7. **CapSolver `AntiAkamaiBMTask`**: API returns `ERROR_TYPE_NOT_SUPPORTED`. CapSolver dropped Akamai.
8. **Mouse simulation + scroll during 60s wait via BD Browser API**: no improvement.
9. **Mobile entry (mobile.aa.com)**: redirects to www.aa.com/homePage.do. Initial page-load succeeded sometimes via BD Browser API.
10. **Direct form-fill on homePage.do via BD Browser API**: form fill SUCCEEDED, submit clicked, navigated to `/booking/choose-flights/1?sid=<uuid>` (real backend SID!), but the results page returned the Akamai "Challenge Validation" interstitial that never cleared.
11. **WU direct POST to `/booking/api/search/itinerary`**: succeeds at network layer (200 OK with AA JSON shape) but AA app returns `error: 309` without session state. Confirmed any cookie/header variation makes no difference — AA's API requires a session validated through the browser flow.
12. **Camoufox + Fly egress**: loads www.aa.com but Akamai serves behavioral challenge (`sec-if-cpt-container`). Sensor.js doesn't clear within 40s of mouse-simulation. Same html_len=2380 challenge response across multiple requests.

---

## Akamai BMP response taxonomy (AA-specific)

When BD Browser API or Camoufox hits aa.com, Akamai serves ONE of:

1. **Real page** (76 KB HTML, full `reservationFlightSearchForm`) — rare, only when sensor.js silently passes. ~0-5% of attempts today.
2. **Behavioral challenge interstitial** (~2.4 KB, `<div id="sec-if-cpt-container" style="display:none">` + sensor.js script tag) — sensor still running, will redirect to (1) if it passes OR show visible tile-puzzle if it fails. ~40-50% of attempts.
3. **Hard Access Denied** (~440 B, `<title>Access Denied</title>` + edgesuite.net reference) — IP fully blacklisted, no redemption. ~40-50% of attempts.

Distinguishable by `html_len`: 2380=challenge, 439-441=hard-deny, 70000+=real page.

---

## Key open-source references

| Repo | Status | Use |
|---|---|---|
| [lg/awardwiz](https://github.com/lg/awardwiz) | Archived Sep 2024 | Reference for plugin shapes / response parsers (likely drifted since archive) |
| [Sekinal/aa_contest](https://github.com/Sekinal/aa_contest) | Active 2026 | Camoufox + curl_cffi pattern; claims 100% AA success |
| [daijro/camoufox](https://github.com/daijro/camoufox) | Active | Firefox-based stealth with C++-level fingerprint injection |
| [apify/fingerprint-injector](https://github.com/apify/fingerprint-injector) | Active | Apify's stealth fingerprint generator for Playwright |
| [rebrowser/rebrowser-patches](https://github.com/rebrowser/rebrowser-patches) | Active | Patches Runtime.Enable CDP leak (not Akamai-specific) |
| [xvertile/akamai-bmp-generator](https://github.com/xvertile/akamai-bmp-generator) | Active but stale | Server that generates Akamai sensor_data; you maintain device pool |
| [hypersolutions.co](https://docs.hypersolutions.co/akamai-web/getting-started) | Commercial | €100/mo for 50K req; sensor-data-as-a-service. Only paid path that explicitly handles Akamai BMP v4. |

---

## Partner-site backdoors (for award data when direct scrape fails)

Per OneWorld partner research:

- **Alaska Airlines (alaskaair.com)** — shows AA-operated transcon + transatlantic award inventory. Public, anonymous browse, weakest anti-bot in oneworld. **Already working** via our AS plugin (httpx + IPRoyal). Limitation: subset of AA inventory only (Alaska doesn't see ALL AA awards).
- **British Airways Reward Flight Finder** — public at `britishairways.com/travel/flightfinderhome/public/en_gb`. Akamai-protected (similar tier to aa.com). Mobile API reverse-engineered by [timrogers/ba_rewards](https://github.com/timrogers/ba_rewards).
- **Qantas Flight Reward Finder** — `flightrewardfinder.qantas.com`, public, lighter protection. Partial AA coverage (≤1200mi).

User explicitly wants comprehensive AA data not partner-subset, so these are CROSS-CHECKS not replacements.

---

## Logging discipline (per session start)

1. **Read this file first**. Don't re-run tests we've already proven fail.
2. **Append to this file** after every meaningful test or finding. Date-stamp it.
3. **Move concluded items** to the right table column.
4. **Don't suggest a tool/service that's already in the "tried, failed" section** without explaining what's different this time.

---

## Session log (date-stamped findings)

### 2026-05-19 — Session 5 (Camoufox pivot)

- Started with: 2/13 plugins working (VS, AS). Believed 10-11 of 13 worked. Reality: only 2 had ever returned real rows.
- Discovered other plugins still routed through ScraperAPI which is broken.
- Migrated 9 plugins (AC/DL/UA/BA/AF/LH/TK/NH/CX/AV) from ScraperAPI to BD Browser API.
- End-to-end test post-migration: all 9 still return 0 rows (parser drift + Akamai walls).
- Pivoted AA to Camoufox foundation (Firefox-based stealth). Camoufox launches successfully on Fly, but Akamai serves behavioral challenge that doesn't clear within 40s.
- Confirmed CapSolver dropped Akamai support (Apr 2025-ish).
- Found that mouseSimulation + page.context.cookies + page.title polling can hang Camoufox/Firefox; wrapped with asyncio.wait_for(3s).
- Open question: is Akamai blocking the Fly egress IP class? Need to test Camoufox + BD Residential proxy.

---

## Session 5 chronicle (2026-05-18 → 2026-05-19) — full detail

This is the comprehensive timeline of what was tried, what was learned, and the dead-ends to NEVER repeat. Organized chronologically by major pivot.

### Phase A — Discovery: the cockpit was 2/13, not 10/11

Believed at session start: VS + AS via httpx working, AC/DL/UA/BA/AF/LH/TK/NH/CX/AV/AA all working via Bright Data Browser API (passed homepage probes via `/diag/airline?brightdata=1`), only AA broken.

Reality discovered late-session:
- `/diag/airline?brightdata=1` bypasses the plugin and probes BD directly. The actual `/search?program=X` calls were silently returning `rows: []` because all 9 Browser-API plugins still routed through ScraperAPI (`use_scraperapi=True`).
- Migrated 9 plugins (AC, DL, UA, BA, AF, LH, TK, NH, CX, AV) from ScraperAPI to BD Browser API in commit `a53e0fb`. Mechanical change — `use_scraperapi=True` → `use_brightdata=True`, remove `proxy_country=...`.
- Post-migration batch test: all 9 still return 0 rows. Either parser drift (per session-3 lessons.md about speculative AwardWiz parsers), additional Akamai walls, or both. Each needs individual debugging.

**Lesson:** "homepage loads with 200" does NOT mean "the plugin works end-to-end." Verify with actual `/search?program=X` calls against routes that should have inventory.

### Phase B — Bright Data Browser API path for AA

#### Setup
- Created `pointsnap` zone in BD (Browser API product, NOT Web Unlocker)
- WSS URL format: `wss://brd-customer-hl_<id>-zone-pointsnap:<pwd>@brd.superproxy.io:9222`
- Added BRIGHTDATA_WSS_URL to Fly secrets via `flyctl secrets set --stage`
- `common/browser.py` got new `use_brightdata=True` branch that uses `chromium.connect_over_cdp(wss_url)` instead of launching local Chromium
- Resource blocking (image/css/font/media/manifest) added to keep bandwidth ~$5-15/mo

#### What worked
- BD Browser API homepage loads for 9-10 of 11 airlines (200 OK with full HTML)
- TLS handshake fine, real Chrome 148 UA, no "HeadlessChrome" tells
- Cost: ~$0.008-0.024 per page load (bandwidth-billed)

#### What didn't work for AA
- Direct GET to `www.aa.com/booking/find-flights`: 403 Access Denied across all attempts/countries
- **T3 anomaly** (morning of 2026-05-19): single `/diag/airline?url=...booking/find-flights&brightdata=1&referer=https://www.aa.com/loyalty/login` returned 200 OK with real AA homepage title. Could NOT reproduce reliably; 5x retest showed 1/5 success. By evening this rate dropped to ~0%.
- Sticky session IDs (`aa1`, `aa2`, ... `aa24`): deterministically map BD to a fixed subset of exit IPs. Drew streaks of 8+ all-blocked IDs. Worse than default rotation.
- Random UUID session IDs: same ~0% rate.
- Country rotation in session_id (`aa<uuid>-country-ca` etc.): no improvement. Notably non-US exits sometimes got the "soft challenge" variant (sensor.js script embedded) but cookie minted by Patchright stayed in challenged state `~-1~-1~-1`.
- In-page reload after sensor.js (same Patchright session): cookies preserved but `_abck` never upgraded to `~0~`. Patchright's internal-fingerprint signals fail sensor.js's checks.
- Mouse simulation (page.mouse.move + scrollBy) during 60s wait: 0/30 attempts cleared.

**Lesson:** BD Browser API + Patchright cannot defeat AA's Akamai BMP, regardless of session/country/wait/mouse-simulation tuning. The bot signal is at the browser-fingerprint layer (Chromium-via-CDP detectable), not the IP/cookie layer.

### Phase C — Bright Data Web Unlocker path for AA

#### Setup
- User created separate `pointsnap_webunlock` zone for the WU product
- API endpoint: `POST https://api.brightdata.com/request` with Bearer auth
- Body shape: `{"zone": "pointsnap_webunlock", "url": "...", "format": "raw", "method": "POST"|"GET", "body": "..."}`
- Field-name gotcha: WU uses `body` (not `data`) for POST payloads — first attempt failed with `"data" is not allowed`

#### What worked
- WU POST to `/booking/api/search/itinerary` directly: HTTP 200, AA's JSON response shape returned. **Akamai network-layer is bypassed by WU.**

#### What didn't work
- AA's app layer returns `{"error":"309", "fareBenefits":[], "products":[], "slices":[]}` — request reaches AA's backend but is rejected for not having a valid session.
- Tried every cookie/header variation: fake `_abck`, fake `JSESSIONID`, real X-CSRF-Token guess, different Referer values, no Origin — all return identical error 309. AA's API requires SESSION STATE that's only minted through the full browser flow, not header tweaks.
- WU GET to `aa.com` HTML pages: times out at 90s with error `x-brd-error: waiting for selector "#weeklyCarousel" failed`. BD's WU has stale page-load detection for AA (waiting for a selector that doesn't exist on the current homepage). Later attempts got the more honest `captcha or protection page found` error.

**Lesson:** WU's network-layer bypass is real but useless without session state. Cannot mint session via WU alone; cannot mint via raw header tweaks.

### Phase D — Form-fill in BD Browser API

Discovered via WU GET to `mobile.aa.com/booking` (which DID work — 200 OK, 76 KB HTML) that AA has a legacy `reservationFlightSearchForm` with:
- `input[name="originAirport"]`
- `input[name="destinationAirport"]`
- `input[name="departDate"]` (date format `mm/dd/yyyy`)
- `input[name="tripType"]` radio (`oneWay` / `roundTrip`)
- `input[name="redeemMiles"]` checkbox (award mode)
- `input[type="submit"][id="flightSearchForm.button.reSubmit"]`
- Hidden `input[name="_csrf"]` token
- Form action: POST to `/booking/find-flights`

mobile.aa.com loaded via BD Browser API too (200 OK, redirects to `www.aa.com/homePage.do` via JS, page renders with the same form).

#### Submission attempts
1. **JS `setVal(name, val)` + dispatchEvent('submit')**: form fields filled in DOM but submit event fired without actually submitting. `defaultPrevented: false` but no navigation.
2. **`page.click("input[name='flightSearchForm.button.reSubmit']")`**: selector miss — the submit input has `id=` not `name=`.
3. **Real Patchright keystrokes** (`page.fill(name, val)` + `page.keyboard.press("Tab")` + `page.click("input[type='submit'][id='...']")`): **fill SUCCEEDED**, click SUCCEEDED, form submitted, navigated to `https://www.aa.com/booking/choose-flights/1?sid=<real-uuid-from-AA-backend>`.

#### What happened on the results page
- Post-submit URL was correct (`/booking/choose-flights/?sid=<uuid>`)
- Title: `'Challenge Validation'` — Akamai serves an interstitial on the results page too
- 0 search-results XHRs captured during 30-60s wait
- Captured `/services/graphql` XHR was just `{"data": {"staticContent": ...}}` — homepage init, not flight search
- Also saw `{"data": {"loginInfo": {"expiry": 0, "status": 200}}}` — login probe, not flight search
- AA's actual flight search XHR never fired because the page never escaped Challenge Validation

**Lesson:** Even when we beat the first Akamai layer (page-load) and submit a real form, there's a SECOND Akamai layer (results page) that sensor.js needs to re-validate. Patchright fails this second validation just as it failed the first.

### Phase E — Captcha solver investigation (all dead-ends)

Subagent-driven research confirmed:
- **CapSolver dropped Akamai BMP support.** Their `AntiAkamaiBMTask` returns `ERROR_TYPE_NOT_SUPPORTED`. Their public docs list reCAPTCHA, AWS WAF, Cloudflare Turnstile, Geetest, ImageToText — no Akamai.
- **2Captcha never had Akamai.** Their list: reCAPTCHA, FunCaptcha, GeeTest, hCaptcha, Turnstile. Their separate "Fingerprint API" doesn't cover behavioral systems either.
- **Hyper Solutions** (https://docs.hypersolutions.co): the only commercial sensor-data-as-a-service that explicitly handles Akamai. ~€100/mo for 50K requests. Their public docs document Akamai web v3 (and pixel/sec-cpt challenges); BMP v4 mobile is not advertised explicitly. Verify with sales before relying on it.
- **xvertile/akamai-bmp-generator** + similar OSS sensor generators: documented as outdated against Akamai v3+. The developer ecosystem has largely given up on free Akamai sensor solvers.

**Lesson:** As of 2026, no free or low-cost commercial captcha solver supports Akamai BMP. The cost gradient is: $0 (browser cookie-mint) → €100+/mo (Hyper Solutions) → bespoke ($1000+/mo proxies + custom solvers).

### Phase F — Camoufox pivot

Subagent research confirmed `Sekinal/aa_contest` (active 2026) uses Camoufox + curl_cffi to bypass AA's Akamai with 100% success. Camoufox is a Firefox fork that injects fingerprints at the C++ level BEFORE any JS can read them — Akamai's sensor.js can't detect a real-Firefox-looking session.

#### Setup
- Added `camoufox[geoip]>=0.4` to pyproject.toml
- Updated Dockerfile: Firefox + Xvfb apt deps, `python -m camoufox fetch` build step (~210 MB Firefox bundle)
- Added `use_camoufox=True` branch to `common/browser.py` with config: `headless="virtual"` (uses Xvfb), `humanize=True`, `locale="en-US"`, `window=(1366, 768)`, `block_webrtc=True`, `geoip=False` (no proxy)
- AA plugin switched from `use_brightdata=True` to `use_camoufox=True, use_proxy=False` (per Sekinal proving Fly egress works)
- First Camoufox deploy: ~10-15min build (Firefox bundle download cold)

#### What worked
- Camoufox launches successfully on Fly in `headless="virtual"` mode
- Real Firefox runs sensor.js
- `_abck` cookie minted in browser session

#### What didn't work
- AA's Akamai serves **behavioral-challenge interstitial** at the initial www.aa.com load: `<div id="sec-if-cpt-container" style="display:none">` + sensor.js script. Same `html_len=2380`-byte response across requests.
- Within 40s of mouse simulation + scrollBy, sensor.js does NOT upgrade `_abck` to trusted (`~0~`). The behavioral signals from a virtual display + asyncio-driven mouse moves don't match what sensor.js expects from a real user.
- ~50% of attempts get the soft "behavioral challenge" (2380 bytes); ~50% get hard `Access Denied` (~440 bytes, no redemption path). Hard-deny means the BD/Fly IP is fully blacklisted by Akamai for that session.
- Original 90s wait loop with unbounded `page.mouse.move` / `page.title()` calls **hung Camoufox indefinitely** when the page was stuck on the challenge. Wrapped every async call in `asyncio.wait_for(timeout=3.0)` to prevent hangs.
- Reducing resource-blocker from blocking [image, stylesheet, font, media, manifest] → [image, media] only: Firefox treats missing CSS differently than Chromium (elements end up `offsetParent === null`, so visibility checks fail for every form element). Fix in commit `314719a`.
- Switched ENTRY_URL from `mobile.aa.com/booking` to `www.aa.com/` direct (avoids JS redirect chain that Firefox may handle differently than Chromium). Same challenge interstitial either way.

**Current Camoufox verdict:** `challenge_unresolved` after 40s in commit `d59b3d1`. Clean failure mode — exits the attempt without hanging. Next angles: BD Residential proxy (different IP class) or partner-site backdoor.

### Phase G — Apify investigation

The `igolaizola/flight-award-scraper` actor on Apify supports 23 airlines including AA at $3/1000 results. Subagent investigated whether it's the answer.

#### Why it doesn't fit
- **Hard 60-day date window** — confirmed in README. User explicitly wants unlimited window (AA's full 331-day award booking horizon).
- **Missing 4 of our 13 programs:** BA Avios, NH ANA Mileage Club, CX Asia Miles, AV LifeMiles. We'd still need custom scrapers for those.
- **The actor itself is closed-source.** Developer is Iñigo Garcia Olaizola ("the Golang Automation Guy", credible — 51 actors, 98.4% run success, 2.3K MAU on Apify). His OTHER repos suggest stack: Go + `chromedp` (CDP-driven Chromium) + Apify residential proxies. **He has NEVER published an Akamai bypass technique publicly** — his "secret" is just real-headless-Chromium + good residential proxies.

**Lesson:** Apify's success on AA validates the architecture (real browser + residential proxy) but does NOT reveal any proprietary bypass technique. The Apify dev's stack IS roughly what we're building with Camoufox + (eventual) BD Residential.

### Phase H — Partner-site backdoor research

Subagent investigated whether AA's award inventory can be sourced from a oneworld partner's site instead.

#### Findings
- **Alaska Airlines** (alaskaair.com/search) — shows AA-operated transcon + transatlantic award seats. PUBLIC. WEAKEST anti-bot in oneworld. Our existing AS plugin already pulls this (httpx + IPRoyal). **But:** Alaska only shows a SUBSET of AA's award inventory; not comprehensive enough for the user's "every flight from every carrier" goal.
- **British Airways Reward Flight Finder** (britishairways.com/travel/flightfinderhome/public/en_gb) — shows AA awards. PUBLIC. BUT same Akamai BMP tier as aa.com. Mobile API reverse-engineered by `timrogers/ba_rewards`.
- **Qantas Flight Reward Finder** — public, lighter protection, partial AA coverage (≤1200mi each way).

**Lesson:** Partner sites are USEFUL CROSS-CHECKS but not REPLACEMENTS for direct AA scraping. They show incomplete inventory.

### Phase I — Stealth hardening research

Subagent on Patchright stealth hardening reported:
- Patchright + BD Browser API currently sits at ~40-50% trusted by Akamai BMP.
- Adding `apify/fingerprint-injector` + 7 manual JS patches (navigator.webdriver, plugins, chrome.runtime, permissions.query, WebGL parameters, navigator.languages, iframe contentWindow propagation) + canvas/audio noise + `oxymouse` mouse paths → ~75-85% trusted.
- Closing the last 15% requires Camoufox (which we pivoted to) OR a paid service.
- `rebrowser/rebrowser-patches` closes the Runtime.Enable CDP leak but doesn't change Akamai BMP outcomes materially.

**Lesson:** Patchright will never beat Akamai BMP at AA's tier no matter how many JS patches are layered. The browser engine itself (Chromium with CDP attached) leaks signals at a level patches can't fix. Camoufox sidesteps this by being a real Firefox.

### Phase J — Deploy / infra learnings

- **This sandbox blocks non-HTTPS outbound.** BD CDP at port 9222 and Fly's wireguard tunnel both fail with TLS / connection errors. Cannot run flyctl deploys or fly logs from this container — must use GitHub Actions for deploys + diag endpoints + direct HTTPS curls.
- **GitHub Actions is the working deploy path.** Workflow at `.github/workflows/deploy-workers.yml` triggers on push to specific branches. Path filter on `python-workers/**` + `.github/workflows/deploy-workers.yml`.
- **Fly auth token expired mid-session.** Error: `verify: invalid token: missing third-party discharge tokens`. Switched to relying on `/diag/aa_last` endpoint + direct `curl` to public Fly URL instead of `flyctl`.
- **Python logging is unreliable on Fly worker.** `log.info` and `log.warning` calls sometimes don't appear in Fly logs (some Python logging config interaction we never tracked down). `print(flush=True)` is the reliable alternative.
- **Worker auto-stop is aggressive.** Machine idles → suspends → first request after suspension can time out at the Fly edge before the machine wakes. Subsequent requests are fast. Important for monitor-script timing.
- **Camoufox first-build is slow (~10-15 min).** Subsequent rebuilds hit Docker cache. Layer ordering matters: `pyproject.toml` copy → pip install → `camoufox fetch` → `COPY . .` keeps the Firefox bundle cached across code changes.

### Phase K — Architectural choices that worked

- `/diag/aa_last` endpoint in serve.py reads module-level `LAST_RUN_DIAG` dict from `aa_aadvantage/search.py` — lets us inspect the most recent scrape's captured XHRs, page states, step errors via a single curl. Replaces flyctl logs (which we lost access to).
- `print(..., flush=True)` for diagnostics that need to reach Fly logs.
- Bounded async calls with `asyncio.wait_for(timeout=...)` — prevents Camoufox/Patchright hangs from locking the worker indefinitely.
- Single-deploy detection by polling for a specific new endpoint in `/openapi.json` instead of trying to read Fly's image hash (which requires authed flyctl).

### Open angles not yet attempted

1. **Camoufox + BD Residential proxy** (sticky session). Hypothesis: Akamai's hard-deny on ~50% of attempts is IP-rep based. A residential IP from BD's Residential product (NOT Browser API CDP) might land in a less-flagged class. Requires user to create a Residential zone in BD dashboard.
2. **Camoufox + curl_cffi hybrid**. Per the asadfix architecture: Camoufox mints cookies, exports to curl_cffi with `impersonate="firefox133"`, curl_cffi POSTs to `/booking/api/search/itinerary` with the validated `_abck`. Bypasses the "Challenge Validation" wall on the results page because we never load the results page — we hit the API directly with valid cookies.
3. **Hyper Solutions paid sensor-data API**. Last-resort paid path (€100/mo). Only commercial service known to still solve Akamai.
4. **Longer Camoufox wait (5+ min) with denser behavior simulation**. Untested. Diminishing returns expected.
5. **Solving the visible tile-puzzle challenge programmatically**. When sensor.js fails silently, Akamai shows tile_container with visual puzzle. CapSolver-like image solvers don't cover this specific Akamai pattern.
6. **Camoufox `headless=False` with real Xvfb** (not the bundled `"virtual"` mode). Maybe real Xvfb vs bundled Xvfb makes a behavioral difference.

### Commits in this session (newest first)

| Commit | Summary |
|---|---|
| `37b9719` | docs: scraper engineering log + CLAUDE.md rule to maintain it |
| `d59b3d1` | diag(aa): MAX_ATTEMPTS=1 + bail on challenge_unresolved before fill |
| `acb3317` | fix(aa): bound every Camoufox call with asyncio.wait_for(3s) |
| `c543c7f` | fix(aa): wait up to 90s for Akamai behavioral challenge + simulate motion |
| `015b5c5` | diag(aa): switch to www.aa.com root + capture HTML preview + 20s wait |
| `314719a` | fix(aa): stop blocking CSS in Camoufox + longer JS wait + page-state diag |
| `a345811` | feat(scraper): add Camoufox foundation + switch AA to Camoufox |
| `a53e0fb` | feat(scrapers): migrate 9 plugins from ScraperAPI -> Bright Data Browser API |
| `50a8757` | fix(aa): mouse movement + scroll during challenge wait + 60s ceiling |
| `6dcfe53` | fix(aa): wait up to 30s for Akamai 'Challenge Validation' to clear |
| `b39cbe7` | fix(aa): use domcontentloaded — networkidle never settles on mobile.aa.com |
| `69861d5` | feat(aa): mobile.aa.com entry + form-fill submission |
| `8fe68dc` | feat(aa): CapSolver Akamai BMP integration |
| `57496c1` | feat(aa): switch to Bright Data Web Unlocker for the Akamai bypass |
| `141e451` | fix(aa): skip login + use random session IDs + tighter timeouts |
| `9b7a92c` | feat(aa): sticky-session retry to find a working BD exit IP |
| `ad429f5` | diag(aa): expose captured XHRs via /diag/aa_last endpoint |
| `e737dae` | diag(aa): capture /services/graphql + dump payload shapes |
| `2b1008a` | diag(aa): dump all visible forms/inputs/buttons on the loaded page |
| `1f935a7` | fix(aa): call submitSearch() directly + capture ALL aa.com XHRs |
| `7483f74` | fix(aa): per-step error capture + force=True on Patchright actions |
| `97c98d6` | fix(aa): use real Patchright keystrokes + click for form submit |
| `c47969a` | diag(aa): inspect AA's booking form via Browser API + print-flush logging |
| `0be102a` | feat(diag): add referer + user_agent params to /diag/airline |
| `43942e6` | feat(diag): add brightdata=1 query param to /diag/airline |
| `c7cfc64` | feat(scraper): add Bright Data Browser API path to browser_page() |
