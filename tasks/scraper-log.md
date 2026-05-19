# Scraper Engineering Log

> **Read this BEFORE attempting any scraper work.** Every session should append findings here. Past dead-ends are expensive to rediscover.

---

## Project anatomy + entry points (READ FIRST IF NEW TO PROJECT)

### What PointSnap is
Personal-use airline-award-search cockpit. User submits search (origin/dest/date) on the Next.js frontend; frontend fans out to per-program scrapers; results merge into a spreadsheet view. **Goal: comprehensive coverage of all 23+ major loyalty programs with unlimited date range.** Currently 2/13 working (VS, AS via httpx); the other 11 silently return `[]`.

### System layers
```
User browser
  │
  ▼
Next.js cockpit on Vercel (./src/app/api/search/route.ts)
  │  fans out to 13 plugins; SSE-streams results back
  │  calls ${PYTHON_WORKER_URL}/search?program=X&origin=Y&dest=Z&date=...
  ▼
Python FastAPI worker on Fly.io (pointsnap-workers)
  │  serve.py:PLUGINS dict dispatches to one of 13 plugins
  ▼
Plugin under python-workers/<program>/search.py
  │  most call common/browser.py:browser_page(...) context manager
  │  VS/AS call common/scrape_client.py:scrape_client(...) (httpx)
  ▼
Either:
  • httpx + IPRoyal residential (for VS, AS — sites with no Akamai)
  • Bright Data Browser API via CDP (for the 10 Akamai/Imperva sites)
  • Bright Data Web Unlocker REST API (for direct API POST tests)
  • Camoufox + Fly direct egress (currently being tried for AA)
  ▼
Airline website → returns JSON / HTML → plugin parses → NormalizedResult[]
  ▼
serve.py serializes to camelCase SearchResultRow → writes to Supabase → returns JSON to Next.js
```

### File layout (everything you'll likely touch)
```
PointSnap/
├── python-workers/                    ← deployed to Fly.io as `pointsnap-workers`
│   ├── serve.py                       ← FastAPI app, /search + /health + /diag/* endpoints
│   ├── common/
│   │   ├── browser.py                 ← browser_page() context manager — Patchright/BD/Camoufox
│   │   ├── scrape_client.py           ← httpx client (IPRoyal residential or direct)
│   │   ├── types.py                   ← NormalizedResult / ResultSegment / CabinPrice
│   │   ├── db.py                      ← write_results() — Supabase upserts
│   │   └── account_pool.py            ← per-program login credentials lookup
│   ├── aa_aadvantage/search.py        ← AA plugin (current battlefield)
│   ├── ac_aeroplan/search.py          ← AC plugin (BD migrated, untested)
│   ├── as_mileageplan/search.py       ← AS plugin (httpx, ✅ working)
│   ├── vs/search.py                   ← VS plugin (httpx, ✅ working)
│   ├── ba_avios/, dl_skymiles/, ua_mp/, af_flyingblue/, lh_miles_more/,
│   │   tk_miles_smiles/, nh_ana/, cx_cathay/, av_lifemiles/
│   ├── pyproject.toml                 ← deps: patchright + camoufox + httpx + curl-cffi
│   ├── Dockerfile                     ← Firefox + Xvfb + Chromium + camoufox fetch
│   └── fly.toml                       ← app=pointsnap-workers, performance-2x:4096MB, iad
├── .github/workflows/deploy-workers.yml  ← GitHub Action that deploys python-workers/ to Fly
├── src/app/api/search/route.ts        ← Next.js SSE endpoint, calls Python worker
├── tasks/scraper-log.md               ← THIS FILE
├── tasks/lessons.md                   ← older lessons (prefer scraper-log.md for scraper work)
├── tasks/todo.md                      ← session plan tracker (history of phases)
└── CLAUDE.md                          ← project-wide rules; §12 covers this log
```

### Deployed worker reference
- **Worker URL:** `https://pointsnap-workers.fly.dev`
- **Fly app name:** `pointsnap-workers`
- **Region:** `iad` (Virginia, US East — closest to Supabase us-east-1)
- **VM size:** `performance-2x` (2 vCPU, 4096 MB) — `auto_stop_machines = "stop"`, `min_machines_running = 0` so it sleeps when idle
- **Deploy mechanism:** push to a branch in the workflow allowlist (currently includes `claude/review-scraper-strategy-CXHmM` and `main`) triggers `.github/workflows/deploy-workers.yml`. Workflow runs `flyctl deploy --remote-only --app pointsnap-workers --ha=false` on GitHub-hosted Ubuntu runner.
- **GitHub Actions auth:** `FLY_API_TOKEN` is set as a GitHub repo secret (added by user). Don't try to add via MCP — there's no MCP tool for GitHub secrets, user adds it via repo Settings → Secrets and variables → Actions.
- **First-time Camoufox build:** ~10-15 minutes (downloads Firefox bundle). Subsequent rebuilds are fast (cache hit).
- **Cache miss trigger:** changes to `pyproject.toml` or Dockerfile invalidate the install layer. Changes to `*.py` only invalidate the final `COPY . .` layer.

### Currently-configured Fly secrets (visible via `flyctl secrets list`)
| Secret | What it's for | Source |
|---|---|---|
| `BRIGHTDATA_WSS_URL` | BD Browser API CDP WSS endpoint | User created `pointsnap` zone |
| `BRIGHTDATA_API_KEY` | BD account API key for WU REST calls | `8fe43b6b-48c4-4c83-a1c6-b7cdf761c920` |
| `CAPSOLVER_API_KEY` | CapSolver REST auth | User set in earlier session — CapSolver no longer useful (dropped Akamai) |
| `DATABASE_URL` | Supabase Postgres connection string | User pasted from .env.local |
| `IPROYAL_PROXY_HOST/PORT/USER/PASS` | IPRoyal residential proxies (VS/AS) | Earlier session |
| `AA_USER`, `AA_PASS` | AA AAdvantage login (optional in plugin) | User configured earlier |
| `BA_EXEC_CLUB_USER`, `BA_EXEC_CLUB_PASS` | BA Avios login | Earlier |
| `DL_USER`, `DL_PASS` | Delta login | Earlier |
| `SCRAPERAPI_KEY` | ScraperAPI auth | Legacy; can be removed in Phase 7 cleanup |

User's BD account: rotates the visible API key after sessions for security.

### Cockpit (frontend) reference
- **Hosted:** Vercel (every git push to any branch gets a preview deploy; `main` → production)
- **DB:** Supabase project `cgoyetahoktqupkcvrli` in `us-east-1`. Connection string is the DATABASE_URL above.
- **Worker URL config:** Vercel env var `PYTHON_WORKER_URL=https://pointsnap-workers.fly.dev`. The Next.js route falls back to mock data if this env var is unset (so the frontend works in pure-frontend dev).

### The `/diag/*` endpoints (debugging surface — use these)
- `GET /health` — liveness check, returns `{"status":"ok","dbSkipped":bool}`
- `GET /diag/airline?url=<encoded>&brightdata=1|use_proxy=1|use_camoufox=1` — load any URL via the chosen transport, return title/status/body_snippet/console errors. Useful for "does X transport reach Y airline" checks.
- `GET /diag/warmup?warmup_url=&target_url=&brightdata=1` — two-step navigation in one BD session (for Akamai cookie warmup pattern). Largely abandoned but still exists.
- `GET /diag/aa_last` — returns the LAST_RUN_DIAG dict from `aa_aadvantage/search.py`. Contains per-attempt page_states (title, url, html_preview, html_len), step_errors, page_dumps (visible forms/inputs/buttons), verdicts. **Critical** for debugging Camoufox runs since fly logs are unreachable from this sandbox.
- `GET /diag/proxy` — IPRoyal proxy health check (loads httpbin.org/ip)
- `GET /diag/inputs?url=...` — dump all form inputs on a target page (selector finder)
- `GET /diag/ac_scrape`, `/diag/ua_scrape` — per-plugin debug runs

### Sandbox network limitations (THIS CLAUDE ENVIRONMENT, not the Fly worker)
**This Claude session runs in a sandbox that BLOCKS non-HTTPS outbound:**
- ✅ Allowed: TCP/443 to any host (HTTPS). curl/WebFetch to public URLs work.
- ❌ Blocked: TCP to arbitrary ports — Fly's wireguard tunnel (mesh net), BD's CDP port 9222, Fly's depot builder gRPC channels.
- **Implication:** can't run `flyctl ssh`, can't run `flyctl deploy` from here (wireguard fails). MUST use GitHub Actions for deploys. Can use HTTPS-only flyctl commands (`fly status`, `fly machine list`, `fly logs --no-tail`) IF the token is valid.
- **Fly token status (end of session 5):** EXPIRED. Error: `verify: invalid token: all tokens missing third-party discharge tokens`. User would need to generate a new one at https://fly.io/user/personal_access_tokens.
- **Workaround used:** built `/diag/aa_last` endpoint to expose worker internal state via HTTPS instead of relying on flyctl logs.

### How to "catch up" if you're a fresh Claude
1. Read this entire file (`tasks/scraper-log.md`) top to bottom — should take ~10 minutes.
2. Read `CLAUDE.md` §12 (Scraper Engineering Log discipline) and §1-§11 for project rules.
3. Check current branch (`git branch -a`): work is on `claude/review-scraper-strategy-CXHmM`.
4. Hit `https://pointsnap-workers.fly.dev/health` to confirm worker is up.
5. Hit `https://pointsnap-workers.fly.dev/diag/aa_last` to see the last AA scrape state.
6. Check "Open angles, fully expanded" section at the bottom — that's the prioritized untested list of next moves.
7. Ask the user which open angle to pursue if you're unsure (or pick #1 = BD Residential + Camoufox by default).

### Currently-pending issues at end of session 5 (what's broken right now)
- ❌ **AA AAdvantage**: returns `verdicts=['challenge_unresolved']` after 40s — Camoufox loads www.aa.com but Akamai's behavioral challenge doesn't clear. Top untested fix: BD Residential proxy.
- ❌ **AC/DL/UA/BA/AF/LH/TK/NH/CX/AV**: migrated from ScraperAPI to BD Browser API but never tested end-to-end after migration. Likely each has parser drift (per session-3 `lessons.md` note that parsers were written speculatively against AwardWiz 2024 references). Each plugin needs individual debugging.
- ⚠️ **AS_MILEAGEPLAN** returned `Internal Server Error` (500) on one test call mid-session. Worker auto-stop edge case, not a code bug. Re-test before worrying.
- ⚠️ **Fly auth token expired** — would need fresh PAT from user for any `flyctl` commands.
- ⚠️ **Python `logging.info`/`logging.warning` calls silently dropped** by Fly logs (some Python logging config interaction). Plugins use `print(flush=True)` as a workaround.

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

---

## Sample responses (so you don't have to re-discover the shapes)

### Akamai "Access Denied" — hard deny (440 bytes)
```html
<html><head>
<title>Access Denied</title>
</head><body>
<h1>Access Denied</h1>
 
You don't have permission to access "http://www.aa.com/booking/find-flights" on this server.<p>
Reference #18.e768c917.1779162238.5660acd5
</p><p>https://errors.edgesuite.net/18.e768c917.1779162238.5660acd5</p>


</body></html>
```
- `<title>Access Denied</title>` — title-check works
- `errors.edgesuite.net` reference — Akamai trace ID format
- No script, no redemption — fully blacklisted IP for this session
- `html_len`: 439-441 bytes

### Akamai behavioral challenge — soft (2380 bytes)
```html
<!DOCTYPE html><html lang="en"><head></head><body>
<script type="text/javascript" src="/Y1atzWeFtkT0CpHX9D40vFNYnFY/c07mS6YL3h/O2Zv/Ug8rWAN/4C30u?v=92e4d221-6cdf-7337-5efe-481b41991730&t=310488769"></script>
<div id="sec-if-cpt-container" role="main" style="display: none">
    <div class="behavioral-content">
        <div id="sec-bc-text-container"></div>
        <div id="sec-bc-tile-parent">
            <div id="sec-bc-tile-container"></div>
        </div>
        <div class="sec-bc-button-p... (truncated)
```
- `<title>` is EMPTY (no title tag in <head>)
- Script src has randomized path + `?v=<uuid>&t=<timestamp>` query
- `sec-if-cpt-container` = "secure: in-flight challenge container" (Akamai BMP marker)
- `style="display: none"` = challenge is invisible by default; sensor.js will either pass silently OR reveal the tile-puzzle if scoring fails
- `html_len`: 2380 bytes (always — Akamai's template)

### AA "real homepage" (~76 KB)
- `<title>American Airlines - Airline tickets and low fares at aa.com</title>`
- Contains `<form name="reservationFlightSearchForm" id="reservationFlightSearchForm" onsubmit="submitSearch(getCurrentSearch())" method="post" action="/booking/find-flights">`
- Form has: originAirport, destinationAirport, departDate, returnDate, tripType radio, redeemMiles checkbox, _csrf hidden, flightSearchForm.button.reSubmit submit input
- This is what we WANT to land on. Currently we don't reach it via Patchright OR Camoufox+Fly-egress.

### AA app-level error 309 (from WU direct POST)
```json
{"error":"309","fareBenefits":[],"products":[],"responseMetadata":null,"slices":[],"utag":null}
```
- HTTP 200 (not Akamai's 403)
- Returned by AA's backend when `/booking/api/search/itinerary` is hit without valid browser session cookies
- Body length: 96 bytes
- Same response regardless of cookies/Origin/Referer/X-CSRF-Token

### AA `_abck` cookie states
- `~-1~-1~-1~...` = unvalidated / challenged. sensor.js ran but didn't trust this session.
- `~0~-1~-1~...` = TRUSTED. sensor.js silently passed. We never see this from BD/Camoufox on Fly egress.
- We DO see ~11-12 cookies set on every BD Browser API session (including `_abck`, `bm_sz`, `ROUTEID`, `dtCookie`, `akavpau_www_aahomepage`, etc.) but `_abck` always stays in `~-1~` form.

### `/services/graphql` queries observed (post-form-submit on www.aa.com)
- `{"data": {"staticContent": {"locale": "en_US", "url": "/en_US/fragments/home-page/emergency-response/go-dark.json", ...}}}` — homepage init only
- `{"data": {"loginInfo": {"expiry": 0, "status": 200}}}` — login probe
- **No flight-search GraphQL query observed in any test.** AA's UI dispatches some other request (probably form POST → server-rendered results) or it's blocked by Challenge Validation before firing.

---

## Useful testing commands (copy-paste)

### Trigger AA search end-to-end + read diag
```bash
curl -s --max-time 300 "https://pointsnap-workers.fly.dev/search?program=AA_AADVANTAGE&origin=JFK&dest=LAX&date=2026-08-15" > /tmp/r.json
echo "size: $(wc -c < /tmp/r.json), rows: $(python3 -c "import json; print(len(json.load(open('/tmp/r.json')).get('rows',[])))" )"
curl -s --max-time 30 https://pointsnap-workers.fly.dev/diag/aa_last > /tmp/d.json
python3 -c "import json; d=json.load(open('/tmp/d.json')); print(f'verdicts: {d.get(\"verdicts\")}'); [print(f'  attempt {s.get(\"attempt\")}: title={s.get(\"title\")[:40]!r} html_len={s.get(\"html_len\")} url={s.get(\"url\")}') for s in d.get('page_states', [])]"
```

### Test BD WU directly against AA's API
```bash
curl -s --max-time 90 -X POST https://api.brightdata.com/request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 8fe43b6b-48c4-4c83-a1c6-b7cdf761c920" \
  -d '{
    "zone": "pointsnap_webunlock",
    "url": "https://www.aa.com/booking/api/search/itinerary",
    "format": "raw",
    "method": "POST",
    "body": "{\"slices\":[{\"origin\":\"JFK\",\"destination\":\"LAX\",\"departureDate\":\"2026-08-15\",\"allCarriers\":true,\"departureTime\":\"040001\"}],\"passengers\":[{\"type\":\"adult\",\"count\":1}],\"tripOptions\":{\"locale\":\"en_US\",\"searchType\":\"Award\"},\"requestHeader\":{\"clientId\":\"AAcom\"}}",
    "headers": {"Content-Type": "application/json", "Accept": "application/json"}
  }'
```
Expected: `{"error":"309", ...}` JSON. If this changes shape, AA's API moved.

### Test BD Browser API loads ANY airline homepage
```bash
curl -s --max-time 60 "https://pointsnap-workers.fly.dev/diag/airline?url=https%3A%2F%2Fwww.<airline>.com&brightdata=1&wait_ms=4000" | python3 -m json.tool
```
Replace `<airline>` with `aa`, `aircanada`, `delta`, etc. Expected for 9 of 11: status=200 with real title. For AA: status=403 Access Denied.

### Test from Apify (sample only — no token yet)
```bash
curl -X POST \
  "https://api.apify.com/v2/acts/igolaizola~flight-award-scraper/run-sync-get-dataset-items?format=json&timeout=120" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"origins":["JFK"],"destinations":["LAX"],"startDate":"2026-08-15","endDate":"2026-08-15","cabin":"business","issuers":["american"],"maxItems":50}'
```

### Direct curl to AA from Fly worker (smoke test) — currently always fails
```bash
curl -s --max-time 30 https://www.aa.com/
# → either Access Denied (440 bytes) or behavioral challenge (2380 bytes)
```

### Check what's deployed (without flyctl)
```bash
# Health
curl -s https://pointsnap-workers.fly.dev/health
# → {"status":"ok","dbSkipped":false}

# Endpoints currently registered
curl -s https://pointsnap-workers.fly.dev/openapi.json | python3 -c "import json,sys; print(list(json.load(sys.stdin).get('paths',{}).keys()))"
```

---

## BD configuration reference

### Browser API zone (the CDP one we've been using)
- Name: `pointsnap`
- WSS URL: `wss://brd-customer-hl_6f5ad35c-zone-pointsnap:n7h9hjvh70lp@brd.superproxy.io:9222`
- Stored as Fly secret `BRIGHTDATA_WSS_URL`
- CAPTCHA Solver: ON (no extra cost)
- Premium domains: OFF (aa.com not on BD's premium list; toggling on for AA didn't change behavior)
- Connect via: `pw.chromium.connect_over_cdp(wss_url)`
- Sticky session: append `-session-<id>` to the username portion of the WSS URL
- Country override: append `-country-<cc>` to the username

### Web Unlocker zone (the HTTP-API one for raw POST)
- Name: `pointsnap_webunlock`
- API: `POST https://api.brightdata.com/request`
- Auth: `Authorization: Bearer 8fe43b6b-48c4-4c83-a1c6-b7cdf761c920` (account-level API key)
- Body format: `{"zone": "<zone>", "url": "<target>", "format": "raw"|"json", "method": "GET"|"POST", "body": "<string>", "headers": {...}}`
- **Field-name gotcha:** POST body field is `body` (NOT `data` — `data` rejected with validation error)
- HTML pages: WU hits `expect_element` selector wait for `#weeklyCarousel` (BD's stale AA detection). Times out at ~90s with `x-brd-error: captcha or protection page found`.
- API endpoints: works directly. AA returns app error 309.

### Account API key (separate from zone passwords)
- Value: `8fe43b6b-48c4-4c83-a1c6-b7cdf761c920` (visible in BD popups during setup)
- Used for: WU Bearer auth, BD's REST APIs
- **Security:** in our chat transcript. User should rotate when done with this work.

### BD Residential proxy (not yet set up)
- This is the missing piece for Camoufox + clean IP. The user has Browser API + Web Unlocker; would need to add Residential as a third zone.
- Connection format (when set up): `proxy = {"server": "http://brd.superproxy.io:33335", "username": "brd-customer-<id>-zone-<zone>-country-us-session-<sid>", "password": "<password>"}`
- Pass via Camoufox: `AsyncCamoufox(proxy=proxy_dict, geoip=True, ...)`

---

## Camoufox configuration that gets us this far

```python
from camoufox.async_api import AsyncCamoufox

async with AsyncCamoufox(
    headless="virtual",         # uses bundled Xvfb wrapper
    humanize=True,              # smooth cursor movement
    locale="en-US",
    window=(1366, 768),
    block_webrtc=True,          # prevents IP leak if proxied
    geoip=False,                # only True with proxy
) as browser:
    page = await browser.new_page()
    # Resource blocking: ONLY block image/media in Firefox.
    # Blocking CSS makes elements offsetParent === null in Firefox.
    async def _block_heavy(route):
        if route.request.resource_type in ("image", "media"):
            await route.abort()
        else:
            await route.continue_()
    await page.route("**/*", _block_heavy)
```

Sekinal's minimum-viable config (from `Sekinal/aa_contest`):
```python
async with AsyncCamoufox(headless=headless) as browser:
    page = await browser.new_page()
```
Then they `page.wait_for_function(...)` up to 90s for sensor.js to validate `_abck`.

---

## Patchright vs Camoufox: empirical signals on aa.com

| Signal | Patchright (Chromium) | Camoufox (Firefox) |
|---|---|---|
| Page-load success rate | ~0-5% (was 20% before Akamai re-flagged BD's pool) | Same / similar |
| Cookies minted | 11-12 (incl. `_abck` in `~-1~` form) | 11-12 (incl. `_abck` in `~-1~` form) |
| `_abck` upgrades to `~0~` | Never | Not yet observed in our tests |
| Form fill works (when page loads) | Yes | Yes (with longer wait for JS) |
| Form submit + navigation | Yes (got real SID) | Untested (challenge doesn't clear) |
| Results page Challenge Validation | Always | Always (so far) |
| Memory per session | ~250 MB | ~500 MB |
| First-launch time | ~2-3s | ~5-7s |

---

## Per-subagent findings (full detail)

### Subagent #1: open-source AA scrapers (2026-05-19)

- `Sekinal/aa_contest` — 1 star, active. Uses **Camoufox + curl_cffi Firefox-133 impersonation**. Pivoted FROM Patchright/Playwright. Claims "100% pass rate, 10-30s on first request" for Akamai. No proxy required per README. Reference for the architecture we're following.
- `borski/travel-hacking-toolkit` — 495 stars, active. Uses Patchright + Chromium + xvfb in Docker. Only does AAdvantage balance/status, not award search.
- `lg/awardwiz` — archived Sept 2024. Used "Arkalis" engine (Chromium via raw CDP). Reference for plugin shapes / response parsers but those have likely drifted.
- `tszumowski/aa_flight_search_tool` — 9 stars, unmaintained, Selenium. Dead.

Key technical findings:
- **TLS layer matters more than fingerprint** — `curl_cffi impersonate="chrome124"` or `firefox133` is the consensus 2026 building block per asadfix scraping guide and The Web Scraping Club.
- **ISP/static residential proxies, never rotating mid-session** — Akamai scores trust across a session.
- **Cookie injection alone does NOT work** — `_abck` is fingerprint-bound; mismatch invalidates instantly.
- **Hyper Solutions** (€100/mo for 50K req, drops to €1/k at 1M) is the only paid sensor-data-as-a-service.

### Subagent #2: AA mobile app API (2026-05-19)

- Endpoint confirmed: `POST https://www.aa.com/booking/api/search/itinerary` with the request body shape AwardWiz documented.
- **No public mobile API reverse-engineering exists.** Zero MITM/Frida writeups on GitHub/Medium/blogs. AA's app is cert-pinned + requires jailbroken device.
- NDC / partner API not viable. Exploreamerican.com sales-only (cash, no awards), requires ARC/IATA accreditation.
- No public AAdvantage account-tier APIs.
- `/services/graphql` only serves static-content + login-info queries — no flight-search GraphQL query exists.

### Subagent #3: alternative Akamai BMP solvers (2026-05-19)

Scrapeway May-2026 Akamai bench:
- Firecrawl, ScraperAPI, Scrapfly: 100% on StockX
- ZenRows: 95%
- ScrapingBee: 0%, Scrapingdog: 0%, Scrapingant: 0%

Top recommendations:
1. **Scrapfly** — $30/mo Discovery (1k free credits), 100% on Walmart (Akamai + behavioral combo similar to AA). Use `asp=true&render_js=true&session=<id>`. **Failed Akamai requests are FREE.** Best signal-to-noise candidate not yet tried.
2. **ScrapeBadger** — explicit Patchright + sensor.js execution. PAYG from $10, non-expiring credits. Failed Akamai not charged.
3. **ScraperAPI Akamai endpoint** — only 68.95% in Proxyway harder bench. Skip.

Skip: Multilogin, AdsPower, Kameleo, Octobrowser (fingerprint tools, NOT sensor.js solvers, no Akamai BMP receipts). NetNut, Crawlbase, Smartproxy mobile, AnyIP, Browserless stealth, ScrapeOps, BotProof — no independent data.

### Subagent #4: oneworld partner workaround (2026-05-19)

Ranked partner sites for AA inventory:
1. **British Airways Reward Flight Finder** — best AA coverage. URL: `britishairways.com/travel/flightfinderhome/public/en_gb`. PUBLIC, no FF login. BUT Akamai BMP same as aa.com — not materially easier.
2. **Alaska Airlines** (alaskaair.com) — easier scraping, partial AA coverage. WE ALREADY HAVE THIS via AS plugin (httpx + IPRoyal).
3. **Qantas** — public flight reward finder, lighter protection. ≤1200mi each way coverage of AA.

Hidden mobile API: `timrogers/ba_rewards` Ruby gem reverse-engineered BA's iOS Avios Flight Finder private API. Different auth surface, lighter protection than web. Worth exploring if direct AA fails.

Aggregators already doing partner-derived AA: Seats.aero, AwardFares, point.me, Roame all infer AA from partner backends (BA, Alaska especially).

### Subagent #5: Patchright stealth hardening (2026-05-19)

Bright Data Browser API + Patchright currently at ~40-50% trusted. Gap closures available:
- `apify/fingerprint-injector` + 7 manual `addInitScript` patches: +30-50% (navigator.webdriver, plugins, chrome.runtime, permissions.query consistency, WebGL params, navigator.languages, iframe webdriver propagation)
- Canvas/AudioContext noise injection: +10% (must be deterministic per session, not per-call random)
- `oxymouse` Gaussian + Bezier mouse paths: +10-20%
- `rebrowser/rebrowser-patches` — closes Runtime.Enable CDP leak but doesn't change Akamai outcome (Akamai is TLS+behavior+sensor, not Runtime.Enable)
- Total layered hardening: ~75-85% best case

What Patchright already handles: Runtime.enable leak (uses isolated ExecutionContexts), Console.enable leak, --enable-automation removed, --disable-blink-features=AutomationControlled, closed shadow root traversal.

What Patchright does NOT patch: behavioral signals (mouse/keyboard/scroll timing — Akamai's biggest tell), Canvas/WebGL/Audio fingerprint values, navigator.plugins/mimeTypes/permissions.query consistency, window.chrome.app/runtime/csi/loadTimes, prototype-chain Proxy CDP trap (unpatched in V8 as of March 2026).

**Conclusion:** Camoufox sidesteps these client-side patches entirely by being a real Firefox.

### Subagent #6: Apify igolaizola integration spec (2026-05-19)

- API: `POST https://api.apify.com/v2/acts/igolaizola~flight-award-scraper/run-sync-get-dataset-items`
- Auth: `Bearer <APIFY_API_TOKEN>`
- 23 programs supported (all 13 of ours covered EXCEPT BA Avios, NH ANA, CX Cathay, AV LifeMiles — those 4 not in actor)
- **Hard 60-day date window** (deal-breaker per user requirement)
- $3/1000 results pricing. ~$3/mo at our usage volume.
- Apify Free plan: $5/mo platform credits, no card.
- Actor 2 months old, 164 total users, 26 MAU, 0 ratings — beta-ish but credible author (98.4% run success across 51 actors).
- Apify dev's tech stack (inferred from his GitHub): Go + chromedp (CDP-driven Chromium) + Apify Residential proxies. **No proprietary Akamai bypass** — same approach we're building.

### Subagent #7: Camoufox integration deep-dive (2026-05-19)

Concrete migration plan delivered:
- `pyproject.toml`: add `camoufox[geoip]>=0.4`
- Dockerfile: add Firefox/GTK/Xvfb apt deps, `python -m camoufox fetch` build step. ~+430 MB image growth.
- Set `PLAYWRIGHT_BROWSERS_PATH=/app/.cache/camoufox`
- `common/browser.py`: add `use_camoufox=True` branch with `AsyncCamoufox(headless="virtual", humanize=True, geoip=False, ...)`
- Fly memory: 4GB is enough (current `performance-2x` config)
- Sekinal's verified-working config: minimal — `AsyncCamoufox(headless=headless)` + `page.wait_for_function(...)` for `_abck` to validate.

### Subagent #8: curl_cffi + sensor_data techniques (2026-05-19)

- **The cookie-mint + curl_cffi pattern is the canonical 2026 free Akamai bypass.** Camoufox/Patchright mints `_abck` in trusted state, exports cookies to `curl_cffi` with `impersonate="firefox133"`, replay against API endpoint.
- `curl_cffi` alone CANNOT execute sensor.js — it's only ~10% of the bypass. Browser cookie-mint is required.
- AwardWiz used this pattern (Arkalis-Chromium for mint, curl-cffi for replay) — archived but pattern is sound.
- Hyper Solutions docs explicitly document Akamai web v3 + sec-cpt + pixel; BMP v4 mobile NOT advertised — verify with sales.
- Open-source sensor generators (xvertile, xiaoweigege) documented as outdated for Akamai v3+.
- `rebrowser-patchright` doesn't change Akamai outcome — fixes Runtime.Enable not behavior.

### Subagent #9: Apify actor source inspection (2026-05-19)

- igolaizola has 51 actors on Apify, github.com/igolaizola with ~30 repos.
- His `chromedp` fork (forked from chromedp/chromedp) — pushed 2026-03-23. Active maintenance of CDP-driver fork = strong signal his actor uses real Chromium via CDP, not pure HTTP.
- `darkpanda` fork of `lightpanda-io/browser` (Zig-based headless, Playwright/Puppeteer-compatible via CDP) — pushed 2026-03-24. Lightweight Chromium alternative.
- `chromote` — Chrome-in-Docker with VNC + remote debugging :9222. Operational chassis for browser-in-container.
- Other actors are Go + `net/http` + browser-like headers (idealista-scraper, fr24).
- Shopify Discovery writeup (Oct 2025): "browser automation is overkill" for Shopify — but Shopify isn't Akamai.
- **No "akamai" / "sensor_data" / "_abck" / "utls" / "bmp" strings anywhere in his repos.** No published technique. Source code for flight-award-scraper is closed.

**Verdict:** Apify's "trick" is just real Chromium + residential proxies. Same architecture we're targeting with Camoufox.

---

## User's explicit constraints + goals (capture before pivots)

- **"I want every flight from every carrier"** — comprehensive AA inventory required, partial-via-partners is insufficient
- **"60-day cap is unacceptable"** — Apify is out for this reason alone
- **"If the Apify developer can figure it out, I want to be able to figure it out too"** — DIY ownership preferred over rented service
- **"I don't care how long this takes you just figure it out"** — committed to multi-session work
- **"Stop suggesting to quit"** — proactively explore options instead of recommending Seats.aero / drop-AA
- All 23 programs Apify covers + 4 we already have (BA, NH, CX, AV) = 27-program eventual scope
- No explicit ceiling on monthly cost (so far)

---

## "If you need to..." cookbook

### ...test whether AA is currently scrapeable
1. Hit `https://www.aa.com/` direct via curl. If HTML is 76+ KB and has `reservationFlightSearchForm`: Akamai has loosened. If 2380 bytes (`sec-if-cpt-container`): challenge interstitial. If 440 bytes (`Access Denied`): hard deny.
2. Hit `/diag/airline?url=https%3A%2F%2Fwww.aa.com&brightdata=1&wait_ms=4000` on the worker. Read title + body_snippet.
3. Hit `/search?program=AA_AADVANTAGE&origin=JFK&dest=LAX&date=<60-day-out>` and read `/diag/aa_last` immediately.

### ...debug a stuck Camoufox session
1. Check `/diag/aa_last`. If `started_at` exists but `verdicts: None` after >5min: session is hanging. Worker may need restart.
2. If `page_states` are populated but `step_errors` are present: form fill timeouts; selector miss or page state wrong.
3. If `html_len == 2380`: stuck on Akamai behavioral challenge.
4. If `html_len == 440-441`: hard Access Denied (IP blacklisted).

### ...migrate a non-AA plugin from BD-Browser-API to Camoufox
1. Read the plugin's `async with browser_page(...)` call
2. Change `use_brightdata=True` → `use_camoufox=True`. Add `use_proxy=False` for testing (or `use_proxy=True` once BD Residential is configured)
3. Verify Firefox-specific behaviors: timer thresholds may need bumping, `wait_until="domcontentloaded"` works (don't use `networkidle`)
4. Tests rendering: pages that need CSS to render forms — Firefox may differ from Chromium

### ...add a new program plugin (one of the 10 Apify-covered but we don't have)
1. Read `vs/search.py` or `as_mileageplan/search.py` for the httpx-based template (use this when target site has no Akamai BMP).
2. Read `aa_aadvantage/search.py` for the Camoufox template (use when target needs full browser).
3. Add the new plugin's directory to `pyproject.toml` packages list.
4. Add `<PROGRAM_ID>` import + dispatch entry in `serve.py`'s `PLUGINS` dict.
5. Seed the program in `src/db/seed/programs.ts` (Drizzle).
6. Add to seed run if it's the first deploy.

### ...investigate a new airline's anti-bot setup
1. WU GET via `format=json` against the homepage. Look at headers + body in returned JSON. Akamai = `_abck`/`bm_sz` cookies. Imperva = `incap_ses_*`. Cloudflare = `cf_clearance`. DataDome = `datadome` cookie.
2. Try `format=raw` on the home page. If 2380 bytes with `sec-if-cpt-container`: Akamai BMP challenge variant. 
3. Browser API + form-fill: if it works, the protection is Akamai-light (Imperva, DataDome can sometimes be browser-bypassed easily).

### ...look at what the deployed worker actually has
```bash
curl -s https://pointsnap-workers.fly.dev/openapi.json | python3 -m json.tool | grep -E '"/.*":' | sort
```

### ...test BD Web Unlocker's POST capability against any API endpoint
```bash
WU_PAYLOAD=$(python3 -c 'import json; print(json.dumps({
  "zone": "pointsnap_webunlock",
  "url": "<target API URL>",
  "format": "raw",
  "method": "POST",
  "body": "<json-string-body>",
  "headers": {"Content-Type":"application/json"}
}))')
curl -s -X POST https://api.brightdata.com/request \
  -H "Authorization: Bearer 8fe43b6b-48c4-4c83-a1c6-b7cdf761c920" \
  -H "Content-Type: application/json" \
  -d "$WU_PAYLOAD"
```

---

## Open angles, fully expanded

### 1. Camoufox + BD Residential proxy (HIGHEST PRIORITY)
**Hypothesis:** Akamai's hard-deny on ~50% of attempts is IP-rep based (Fly egress is a datacenter IP). BD Residential gives a real consumer IP.

**Steps:**
1. User creates a new BD zone, type "Residential Proxy" (not Browser API, not WU)
2. User shares connection params: `username` (incl. zone), `password`, `port` (usually 33335)
3. Update `common/browser.py` Camoufox branch to accept the residential proxy URL when `use_proxy=True`
4. Test AA via `use_camoufox=True, use_proxy=True`

**Expected:** Higher % of attempts pass Akamai's initial IP-rep check. Sensor.js still needs to validate behavior + browser fingerprint — Camoufox handles the fingerprint, residential IP handles the rep.

**Cost:** BD Residential is ~$8.40/GB. At ~2 MB/search, 100 searches/mo = ~$1.68/mo.

### 2. Camoufox cookie-mint + curl_cffi replay (SECOND PRIORITY)
**Hypothesis:** Even if Camoufox loads the page through behavioral challenge, we can't reliably re-render the search results page (Challenge Validation). Solution: harvest validated cookies from Camoufox, replay against the actual API with curl_cffi.

**Steps:**
1. Camoufox loads www.aa.com (with 1+ above so we have a real IP)
2. Wait for `_abck` to upgrade to `~0~` (validated) using `page.wait_for_function`
3. Export `page.context.cookies()` to a dict
4. Build curl_cffi POST: `curl_cffi.AsyncSession(impersonate="firefox133").post("https://www.aa.com/booking/api/search/itinerary", headers=..., cookies=cookies, json=body)`
5. Parse response

**Why this is the canonical 2026 free Akamai bypass.** AwardWiz's exact pattern. Camoufox just replaces AwardWiz's Arkalis-Chromium.

### 3. Hyper Solutions paid sensor-data API (FALLBACK)
**Hypothesis:** If we can't beat Akamai with browser-based mint, pay for valid sensor_data.

**Steps:**
1. User signs up at hypersolutions.co. Get API key.
2. Add `hyper-sdk` Python package.
3. Flow: GET aa.com → get sensor script URL + challenge context → POST to Hyper with `(url, ua, abck, bm_sz, version, script, context, accept_language, ip)` → receive `sensor_data` → POST sensor_data to Akamai's script endpoint → get back validated `_abck` cookie → use cookies for API calls.

**Cost:** ~€100/mo for 50K requests. €1/k at 1M+.

**Risk:** Their public docs only cover Akamai web v3, not BMP v4 — verify with sales first.

### 4. Solve the visible tile-puzzle (LOW PRIORITY)
**Hypothesis:** When sensor.js fails, Akamai shows a click-puzzle in `sec-bc-tile-container`. CapSolver-like image solvers don't cover this Akamai-specific pattern.

**Steps:** Probably involves image classification (CNN) on the visible tiles. Out of scope for personal-use.

### 5. Longer Camoufox wait with denser simulation (LOW PRIORITY)
**Hypothesis:** 5+ min of dense behavioral signals will eventually pass sensor.js scoring.

**Steps:** Bump wait to 300s. Add scroll, click, mousemove with varied timing.

**Risk:** Diminishing returns. Akamai BMP looks at quality of signals, not quantity.

### 6. Camoufox `headless=False` with real Xvfb (LOW PRIORITY)
**Hypothesis:** Bundled `headless="virtual"` differs detectably from real Xvfb.

**Steps:** Run actual `xvfb-run uvicorn ...` in the container with `DISPLAY=:99`. Set `headless=False`.

**Risk:** Maintenance overhead. Probably no real benefit.

### 7. BA mobile API via timrogers/ba_rewards pattern (CROSS-CHECK)
**Hypothesis:** BA's mobile API has lighter protection than the web. We could pull AA inventory via BA's "Avios Flight Finder" mobile endpoint.

**Steps:** Read `timrogers/ba_rewards` Ruby gem. Port the auth + request logic to Python. Test.

**Limitation:** This is BA's data, not AA's — partial inventory only.

---

## Session 11 — 2026-05-19 — Phase 0 recon kickoff + BD Residential infrastructure

### Plan approved
User approved the multi-phase recovery plan (`/root/.claude/plans/knowing-everything-you-know-warm-bunny.md`). Key decisions:
- **Transport rubric** with 9 tiers (T0 httpx → T7 commercial + T5' user-auth + T8 partner backdoor)
- **Phase 0**: 8 parallel research subagents to build per-airline transport rubric BEFORE any code
- **Phase 1**: 5-variant parallel attack on AA (A: Camoufox+BDR, B: cookie-mint+curl_cffi, C: mobile.aa.com, D: BD Browser API legacy, E: bulk calendar endpoint)
- **Phase 2.5 (parallel with Phase 2)**: user-initiated auth-capture flow (cockpit-streamed Camoufox login → harvest cookies → replay), for MFA-gated programs like Aeroplan
- **Spend cap**: $50/day BD Residential ($8/GB rate → ~1,250 searches)
- **No stored credentials** — frontend auth only
- **Hands-off execution** per `tasks/progress.md` + `tasks/blockers.md`

### Bright Data Residential zone created
User created zone `pointsnap_residential` in BD dashboard. Connection URL:
```
http://brd-customer-hl_6f5ad35c-zone-pointsnap_residential:p96hs5z78sku@brd.superproxy.io:33335
```
(Credentials stored as Fly secret `BRIGHTDATA_RESIDENTIAL_URL` — NEVER committed.)

Config decisions:
- **Default countries: ANY** (per-request `-country-XX` override via username modifier instead of zone-level config)
- **Web Unlocker API toggle: OFF** (we want raw proxies, the worker handles bot logic)
- **Shared (Pay per GB) at $8/GB** (corrects earlier $2.50/GB misquote)
- **Sticky sessions: per-request via `-session-<id>` username modifier** (~10min idle pinning)

### Infrastructure code landed (commit pending)
1. **`common/browser.py:_brightdata_residential_proxy(country, session)`** — new helper. Parses `BRIGHTDATA_RESIDENTIAL_URL` env, injects `-country-XX` and `-session-YY` into the username segment. Returns Camoufox/Playwright-compatible proxy dict.
2. **`common/browser.py:browser_page()`** — new params: `use_brightdata_residential: bool`, `brightdata_country: str | None`. When `use_camoufox=True` + `use_brightdata_residential=True`, routes through BD Residential as the Camoufox proxy. Priority: BD Residential > IPRoyal > none.
3. **`serve.py:/diag/airline`** — new query params: `use_camoufox`, `brightdata_residential`, `brightdata_country`, `brightdata_session`. Ad-hoc smoke testing of T3 (Camoufox + BD Residential) from any URL.

Code compiles cleanly (`python -c "import ast; ast.parse(...)"` confirmed).

### Phase 0 dispatched
8 background research subagents launched in parallel at 2026-05-19 16:45 UTC:
1. **Agent 1**: AA / Akamai OSS deep-dive (Sekinal/aa_contest, asadfix bypass, 2026 blog posts)
2. **Agent 2**: Apify igolaizola actor reverse-engineering
3. **Agent 3**: 28-domain bot defense profiling (HTTP HEAD probes + cookie/header classification)
4. **Agent 4**: Mobile API endpoint mapping (per-airline app intercepts from community sources)
5. **Agent 5**: T5' user-auth viability per airline (login req'd, MFA flavor, cookie portability)
6. **Agent 6**: Community knowledge mining (FlyerTalk, Reddit, Twitter, niche blogs)
7. **Agent 7**: Commercial API matrix (Duffel/Amadeus/Sabre/Travelport — critically: AWARD search vs revenue-only)
8. **Agent 8**: Partner-backdoor cross-check map (alliances + bilaterals for triangulation, NEVER primary)

Each writes to `/home/user/PointSnap/tasks/scraper-research/agent-{N}-{topic}.md`. Output consolidated into `tasks/scraper-rubric.md` after all return (~25-30min wall-clock expected).

### What didn't change yet (pending Phase 0 + Phase 1)
- AA plugin still uses `use_camoufox=True, use_proxy=False` — Phase 1 will rewrite as 5-variant dispatcher
- No new plugins yet — Phase 3
- Cockpit `/airlines` page doesn't exist yet — Phase 2.5

### Next session pickup
- Phase 0 agents return; consolidate findings into `tasks/scraper-rubric.md`
- Update AA plugin to call `browser_page(use_camoufox=True, use_brightdata_residential=True, brightdata_country="us", brightdata_session=f"aa_{int(time.time())}")` — Variant A
- Write Phase 1 Variants B/C/D/E as separate functions in `aa_aadvantage/search_variants.py`
- Wire `/diag/aa_va` … `/diag/aa_ve` endpoints
- Smoke-test all 5 variants in parallel

### Phase 0 outcomes (all 8 agents complete)

**Big-picture strategy reset** based on 8 parallel research subagents:

1. **AA is solvable with no proxy** — Sekinal/aa_contest (commit Nov 7 2025, MIT) proves Camoufox + Fly egress passes Akamai BMP for aa.com. Phase 0 smoke confirmed: `/diag/airline?use_camoufox=1&use_proxy=0&url=https://www.aa.com` returns 200 with sensor.js executing.

2. **20 of 23 programs require login** (Agent 5). Aeroplan built a login wall in March 2025 specifically to stop scrapers. T5' (user-initiated auth-capture via cockpit-streamed Camoufox) is mainline, not fallback. Only 3 anonymous-OK: AS Mileage Plan, AM Aeromexico, EY Etihad Guest. AA's award search is anonymous-OK; account login is optional (email OTP only).

3. **JetBlue is wide open** — Fastly Varnish only, no Akamai/Cloudflare/Imperva. T0 (httpx). API endpoint per Agent 6: `https://jbrest.jetblue.com/lfs-rwb/outboundLFS`. **Easiest Phase 2 target.**

4. **Bot defense distribution** (Agent 3, 28 domains):
   - Akamai BMP "tight" (TLS RST from sandbox): AF/KL, TK, UA, QR, BA, EY — 6
   - Akamai BMP "single-tier" (homepage open, API blocked): AA, AC, CX, DL, NH, VS, EK, ET, AY, QF, SQ, voegol, VA, AV — 14
   - Akamai "light" (no `_abck` on cold): AS, AM, AD — 3
   - Cloudflare Turnstile: LH, SK — 2
   - Imperva: CM, SV — 2
   - Fastly Varnish only: B6 — 1

5. **Apify igolaizola = closed Go source, direct API hits, 60-day cap structural** (Agent 2). $3/1k pricing confirms no browser automation overhead. To beat 60 days we need T5' authenticated sessions.

6. **Commercial T7 layer effectively empty** (Agent 7). Of 11 vendors matrixed, only seats.aero returns AWARD prices in miles. User rejected at $9.99/mo retail. Resilience must come from scraping diversity, not commercial fallback.

7. **Partner backdoors as cross-check only** (Agent 8). 16 hubs documented. 5 airlines have no viable cross-check: KE, DL own-metal pricing, GA, AS as operating carrier, TK. Strongest cross-check clusters: Aeroplan + (BA Avios + Asia Miles).

8. **Mobile APIs sometimes softer** (Agent 4): `api.qantas.com` returns 3.9 MB JSON with no auth on /flight/refData/airport. `mobile.emirates.com` 705 KB full site. `b2c.voegol.com.br` cleanest Latin American target. But: `mobile.emirates.com` still has `_abck` + `bm_sz` on responses, so Akamai is still in the path there.

**Key endpoint URLs captured (Agent 6 — verbatim from working OSS scrapers):**
- AA: `POST /booking/api/search/itinerary` body has `clientId: "AAcom"` + `searchType: "Award"`
- UA: `POST /api/token/anonymous` (Bearer mint) → `POST /api/flight/FetchFlights`
- AC: `POST */loyalty/dapidynamic/{tenant}/v2/search/air-bounds` with required `marketCode=TNB`
- AS: `GET /searchbff/V3/search?…fareView=as_awards`
- B6: `GET https://jbrest.jetblue.com/lfs-rwb/outboundLFS` (SEPARATE host)
- WN: `GET /api/air-booking/v1/...`
- DL: `POST /shop/ow/search` + interstitial at `/shop/ow/flexdatesearch`
- AV: 4 ASPX endpoints (not detailed in summary; consult Agent 6 report)

**Operational caveat from Agent 6**: AC v seats.aero lawsuit alleges seats.aero hit Aeroplan 265,552 times in 2 days. **Throttle aggressively** on AC. One shopping request can fan out to 100-300 partner availability requests internally.

### Sekinal-pattern code landed (commit 587d4a6)

`aa_aadvantage/search.py:_try_once()` rewritten:
- Camoufox + Fly egress (no proxy)
- Load `aa.com/` homepage; accept cookie banner if present
- Navigate to `https://www.aa.com/booking/search?locale=en_US&fareType=Lowest&pax=1&adult=1&type=OneWay&searchType=Award&cabin=&carriers=ALL&travelType=personal&slices=[{"orig":"JFK","origNearby":false,"dest":"LAX","destNearby":false,"date":"2026-08-15"}]`
- `page.on("response")` captures `/booking/api/search/itinerary` JSON
- 30s wait window with light mouse motion to feed sensor.js
- Scroll-to-bottom nudge if XHR hasn't fired after 30s
- Reuse existing `_parse_xhr` (response shape unchanged)
- 7 verdict codes: ok, nav_failed, page_blocked, xhr_timeout, xhr_no_slices, no_results, crash
- MAX_ATTEMPTS: 1 → 3

Diff: -245/+147 lines. All form-fill removed (was returning challenge_unresolved from post-form Akamai wall).
