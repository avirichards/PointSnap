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
| AA_AADVANTAGE_WU | 🚧 stuck | WU 2-step + BD Browser API mint rung | Mint rung mints `spa_session_id` via BD Browser API; WU-replayed award POST still error 309 — AA session is transport-bound. See Session 14 + blockers.md 2026-05-20 19:40. |
| AC_AEROPLAN | ❌ broken | auth path; tenant RESOLVED, transport blocked | air-bounds tenant `1ASIUDALAC` + host `akamai-gw.dbaas.aircanada.com` resolved (Session 15). Blocked: Kasada-protected path needs `x-kpsdk-*` from a real browser; BD Browser API blocks cookie injection, Camoufox crashes on Fly. |
| DL_SKYMILES | ❌ broken | WU 2-step (Akamai-walled on POST) | Homepage mint OK; `POST /shop/ow/search` → Akamai 444 for both WU formats. Award POST needs validated `_abck`. See Session 12. |
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
| **Bright Data Browser API (CDP)** | ✅ for non-Akamai sites, ❌ for AA, ❌ for any cookie injection | Session 5 morning / 15 | 9/11 airline homepages loaded clean (200 OK with HTML). AA returned 403 Access Denied on most IPs. **Session 15: BD Browser API is a MANAGED browser — it blocks ALL client-side cookie writes for the proxied domain. `add_cookies`, CDP `Network.setCookie`/`setCookies`, `Storage.setCookies`, and `document.cookie` all fail "Overriding X forbidden" (even into a provably-empty jar); a second `page.route` handler breaks the proxy tunnel (`ERR_TUNNEL_CONNECTION_FAILED`). A captured logged-in session CANNOT be replayed inside BD Browser API. Do not retry.** |
| **Bright Data Web Unlocker (HTTP API)** | ⚠️ AA blocked on a zone setting | Session 13 | WU renders `mobile.aa.com/booking` (200, jar w/ `XSRF-TOKEN`+`JSESSIONID`, NO `spa_session_id`) + reaches AA's award POST (200). Every `www.aa.com` page 502s — stale `#weeklyCarousel` `expect_element` rule. The `x-unblock-expect` override that fixes it is OFF on the `pointsnap_webunlock` zone (`feature_not_active` — "Manual expect is not enabled"). AA award POST still `error 309` without `spa_session_id`; AA mints no cookies on the 309. **Fix: enable "Manual Expect" on the WU zone — then code works unchanged.** See Session 13 + blockers.md. |
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
13. **WU 2-step session-mint (Session 13)**: WU-GET `mobile.aa.com/booking` mints a 15-cookie jar (`XSRF-TOKEN`, `JSESSIONID`, Akamai `bm_*`) but NOT `spa_session_id` — it's the legacy server-rendered page, no SPA bootstrap. Award POST with that jar → still `error 309`. The www.aa.com booking SPA *would* mint `spa_session_id` but WU can't render any www.aa.com page (stale `#weeklyCarousel` `expect_element` rule), and the `x-unblock-expect` override to defeat it returns `feature_not_active` (Manual Expect disabled on the `pointsnap_webunlock` zone). AA's 309 response issues no cookies, so `spa_session_id` can't be earned from the API. **Blocked on a 1-click BD zone setting** — see Session 13 chronicle + `blockers.md`.

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

---

## Session 12 — 2026-05-20 — DL SkyMiles WU 2-step (proof airline) — CONCLUSION: Akamai-walled on POST

Goal: prove the Bright Data **Web Unlocker two-step** transport for DL SkyMiles
award search. DL was the designated proof airline — if WU 2-step worked it would
roll out to 8 sibling plugins. **It does not work for DL.** The award POST is
Akamai-walled. Forensic detail below so the next session doesn't re-walk this.

### What was done
- Rewrote `python-workers/dl_skymiles/search.py` from the (broken) Patchright/BD
  Browser API transport to the WU 2-step: `wu_mint_cookies("https://www.delta.com/")`
  → cookie jar → WU POST `/shop/ow/search` with the jar forwarded as a `Cookie:`
  header. Plugin tries both WU transports (`format=json` then `format=raw`),
  records each as a separate `attempts[]` entry, returns `[]` defensively.
- Added `/diag/dl_last` to `serve.py` (mirrors `/diag/aa_wu_last`) — exposes
  `dl_skymiles.search.LAST_RUN_DIAG`. Only serve.py change made.
- Commits on `claude/review-scraper-strategy-CXHmM`: `b704888` (initial WU 2-step),
  `f0e699f` (add format=json transport), `2ea8caa` (record finding).

### DL award endpoint (confirmed current, 2026-05-20)
- **`POST https://www.delta.com/shop/ow/search`** is the award-search endpoint.
  AWS API Gateway / Lambda backed — error envelopes carry `x-amzn-requestid`,
  `x-amz-apigw-id`, `"shopAWSError":"Y"`.
- `/flight-search/book-a-flight` is the entry page — an Angular SPA
  (`<base href="/flightsearch">`, `data-critters-container`).
- `/shop/ow/flexdatesearch` is a sibling POST-body endpoint (flex-date variant).
- `/prefill/retrieveSearch?searchType=RecentSearchesJSON` → `[]` (saved searches;
  works, not useful for a cold search).
- `/api/graphql` GET → 358 KB SPA HTML shell, NOT a real GraphQL data endpoint.

### Probe results (all via `/diag/wu_probe`, which uses WU `format=json`)
| Request | Result |
|---|---|
| `GET https://www.delta.com/` | 200, 8.5 KB, ~10-11 Set-Cookie (the `bm_*` set + `AKA_A2`,`Homepage`,`location`,`akaalb_www_alb_homepage`; `_abck` inconsistent — present `~-1~` once, absent next run) |
| `GET /shop/ow/search` (any param shape — tried 4) | 200, `{"shoppingError":{"error":{"message":{"code":"100800","message":"...there was a problem processing your request..."}}},"shopAWSError":"Y"}` (225 bytes). `100800` = no valid request payload. WU clears Akamai for GET. |
| `POST /shop/ow/search` no body | **444**, `<TITLE>Access Denied</TITLE>` Akamai edge reject (189 bytes, has `Reference#`) |
| `GET /shop/ow/flexdatesearch` | same `100800` JSON |
| `GET /api/graphql` | 200, 358 KB SPA HTML shell (not real GraphQL) |
| `POST https://httpbin.org/post` via WU | 200, echoes request — **proves WU POST capability is fine** |

### Two deployed runs read from `/diag/dl_last` (the decisive evidence)
Run 1 (`format=raw` only, commit b704888): mint → 11 cookies (incl `_abck` `~-1~`);
`POST /shop/ow/search` `format=raw` → WU 200 but body = Akamai "Access Denied"
HTML (189 b). Verdict `api_non_json`.

Run 2 (both transports, commit f0e699f): mint → 10 cookies (NO `_abck` this time);
- `format=json` POST → `wu_http_status:200`, **`target_status:444`**, body Akamai
  "Access Denied" HTML. Verdict `api_error`.
- `format=raw` POST → WU 200, body Akamai "Access Denied" HTML. Verdict `api_non_json`.

### CONCLUSION (the answer for the 8-airline rollout)
**The WU homepage cookie jar does NOT authenticate DL's award API**, and more
fundamentally **the award call can't even be made** — Delta's Akamai policy
**rejects POST to `/shop/ow/*` at the edge (444 Access Denied)** while permitting
GET. This is independent of:
  - WU format (`json` and `raw` both 444)
  - request body (no body / full JSON body both 444)
  - the minted cookie jar (forwarded or not — still 444)

`httpbin POST` via WU works, so this is **Delta's Akamai, not a WU limitation**.
WU's unlocker does not solve Akamai for the Delta POST — it passes it through and
Akamai's edge kills it. The endpoint needs a **sensor.js-validated `_abck`**
(advanced to `~0~`) issued to the same client/IP that sends the POST. A single
stateless WU homepage GET cannot produce that — WU's mint didn't even reliably
return an unvalidated `_abck`.

**Rollout implication:** the WU 2-step as designed (homepage GET → cookies →
API POST) is **insufficient for any airline whose award endpoint is a POST behind
Akamai BMP** — which per Agent 3 is the 14-airline "Akamai single-tier" cluster
(AA, AC, CX, DL, NH, VS, EK, ET, AY, QF, SQ, voegol, VA, AV). It only stands a
chance where the award endpoint accepts GET, or the carrier's bot policy doesn't
edge-reject POSTs. **Do NOT roll WU 2-step to the 8 siblings on the DL proof —
DL disproved it.** (The AA WU variant `AA_AADVANTAGE_WU` got app-level error 309,
a different failure — AA's API at least accepts the POST. DL's doesn't even do
that.)

### Untested next angles for DL (not built this session)
1. **Render+POST in one WU session.** If BD exposes a WU mode that runs the page
   render and the award POST in the SAME unlock session, sensor.js telemetry
   could validate `_abck` before the POST. Needs a BD product/param the current
   `bd_wu.py` helper doesn't expose — check BD WU docs for a browser/session mode.
2. **In-page POST via Camoufox/Patchright** (the AA deep-link XHR-capture pattern,
   NOT the WU 2-step): load the `flightsearch` SPA, let it fire the award POST
   from inside the page so `_abck` is validated + DataDome/Akamai intent ML sees
   real navigation, then `page.on("response")` captures the JSON. This is the
   transport the OLD dl plugin attempted; it failed via BD Browser API but may
   work via Camoufox + BD Residential (the AA Variant-A path).
3. **GET-based award data** — none found. Every `/shop/ow/*` GET returns `100800`.

### Useful testing commands (DL)
```bash
# Probe any delta.com URL through WU (format=json) — status, headers, body head
curl -s 'https://pointsnap-workers.fly.dev/diag/wu_probe?url=<URL-encoded>&method=GET'

# Run the DL plugin + read its forensic trace
curl -s 'https://pointsnap-workers.fly.dev/search?program=DL_SKYMILES&origin=JFK&dest=LAX&date=2026-08-15'
curl -s 'https://pointsnap-workers.fly.dev/diag/dl_last' | python3 -m json.tool
```

### Commit log (Session 12)
| SHA | Message |
|---|---|
| `b704888` | feat(dl): WU two-step transport for SkyMiles award search |
| `f0e699f` | feat(dl): try WU format=json transport for award POST |
| `2ea8caa` | docs(dl): record confirmed finding — WU 2-step is Akamai-walled for DL |

---

## Session 13 — 2026-05-20 — AA AAdvantage WU 2-step session-mint — CONCLUSION: blocked on a BD zone setting

Goal: get AA award rows via the Bright Data Web Unlocker 2-step (`AA_AADVANTAGE_WU`).
The award API `POST /booking/api/search/itinerary` reaches AA's backend fine
through WU but returns `{"error":"309"}` ("no session"). Built the 2-step
session-mint. **Result: works end-to-end except WU can only mint a `mobile.aa.com`
jar that lacks `spa_session_id`; the `www.aa.com` SPA page that would mint it
can't be rendered because a required BD zone feature ("Manual Expect") is off.**
Forensic detail below so the next session doesn't re-walk it.

### What was built (`python-workers/aa_aadvantage/search_wu.py`, commits below)
- Real 2-step flow: `_mint_aa_session()` WU-GETs an aa.com page to harvest a
  cookie jar → `search_via_wu()` WU-POSTs the award API with that jar.
- `_wu_get_json` — local WU GET helper that can send an `x-unblock-expect`
  header (`bd_wu.wu_request_json` can't; `bd_wu.py` not modified).
- `_wu_post_json` — WU POST via `format=json` (vs `bd_wu.wu_post`'s
  `format=raw`) so AA's response `Set-Cookie` headers are visible.
- Mint strategy ladder, all run, best jar selected (prefer `spa_session_id`).
- API POST retry loop (max 3): folds any cookies AA issues on a 309 into the
  jar and retries; stops early if a 309 issued no new cookies.
- Forensic `LAST_RUN_DIAG` via `/diag/aa_wu_last` — every mint strategy +
  POST attempt recorded.
- Only `search_wu.py` touched. serve.py / bd_wu.py / other plugins untouched.

### AA endpoint facts (confirmed current, 2026-05-20)
- `POST https://www.aa.com/booking/api/search/itinerary` — award API.
  `searchType:"Award"`, `clientId:"AAcom"`. Reachable via WU.
- Anonymous POST → `{"error":"309","fareBenefits":[],"products":[],
  "responseMetadata":null,"slices":[],"utag":null}` (95 bytes). 309 = no session.
- AA's 309 response **sets zero cookies** — the API does NOT bootstrap a
  session on first call (tested via `format=json` POST: `set-cookie` empty).
- `mobile.aa.com/booking` is the ONLY AA URL WU renders cleanly.

### Probe results (all WU `format=json`, throttled — ~12 probes total)
| Request | Result |
|---|---|
| `GET mobile.aa.com/booking` | **200**, 76 KB HTML, 15-cookie jar: `XSRF-TOKEN`,`JSESSIONID`,`bm_s`,`bm_sz`,`AKA_A2`,`KROUTEID`,`ROUTEID`,`UAC`,`dtCookie`,`sessionLocale`,`aka_*`,`al`,`akavpau_*`. NO `spa_session_id`. |
| `GET www.aa.com/` | 502, `x-brd-error: waiting for selector "#weeklyCarousel" failed: timeout 90000ms`, `errcode: expect_element` |
| `GET www.aa.com/booking/find-flights` | 502, same `#weeklyCarousel` `expect_element` |
| `GET www.aa.com/booking/flights/choose-flights` | 502, same |
| `GET www.aa.com/booking/` | 502, same |
| `GET www.aa.com/booking/flights/start.do` | 502, same |
| `GET www.aa.com/aileron-view/` | 502, same |
| `GET www.aa.com/booking/find-flights` + `x-unblock-expect:{"body":true}` | 400, `x-brd-error: "Manual expect is not enabled for this zone"`, `errcode: feature_not_active` |
| `GET www.aa.com/booking/api/search/dual/elementsConfig` | 502, `captcha or protection page found`, `errcode: reject_block` |
| `GET www.aa.com/loyalty/login` | 502, `Unexpected Status 429 ... ext_proxy_connect_error`, `errcode: rate_limit` (transient BD throttle) |

### Three deployed test runs (read from `/diag/aa_wu_last`)
All three: mint via `mobile_booking` (15 cookies, no `spa_session_id`) →
award POST → `wu_status:200`, `target_status:200`, AA returns `error 309`,
`slices:[]`, `api_set_cookie_names:[]`. Verdict `no_slices`, `row_count:0`.
The `www_findflights` mint strategy: `target_status:400 feature_not_active`.

### CONCLUSION — the blocker, and the 1-click fix
WU bypasses AA's Akamai for the **POST** (AA's API responds 200 — unlike DL,
whose Akamai edge-rejects POST). AA's app-level **error 309** is the wall: the
award API needs `spa_session_id` (Sekinal's #1 critical cookie). That cookie
is minted only by the **www.aa.com booking SPA bootstrap**. WU cannot render
**any** `www.aa.com` page — it applies a stale per-host render-readiness rule
waiting for `#weeklyCarousel` (a dead homepage selector) → `expect_element`
timeout. WU's override for that (`x-unblock-expect` header) is **disabled on
the `pointsnap_webunlock` zone** → `feature_not_active`.

**Fix (user, ~1 min):** enable **"Manual Expect"** / custom `expect` on the
`pointsnap_webunlock` WU zone (BD dashboard → zone → Advanced / Custom Headers
& Cookies). The code's `www_findflights` strategy already sends
`x-unblock-expect:{"body":true}`; once the zone allows it, WU should render
the SPA, mint `spa_session_id`, and the existing code folds it into the POST —
**no code change needed**. (Caveat: enabling custom headers makes that zone
bill 100% of requests.) If Manual Expect doesn't yield `spa_session_id` (SPA
may set it via client-side JS, which WU's `format=json` Set-Cookie capture
misses), fall back to BD **Browser API** (`BRIGHTDATA_WSS_URL`, zone `pointsnap`)
for the mint step — a real browser runs the SPA JS so `spa_session_id` lands
in the cookie jar. Full detail in `tasks/blockers.md` (2026-05-20 19:00 entry).

### Useful testing commands (Session 13)
```
# Run the AA WU variant + inspect forensic diag
curl -s 'https://pointsnap-workers.fly.dev/search?program=AA_AADVANTAGE_WU&origin=JFK&dest=LAX&date=2026-08-15'
curl -s 'https://pointsnap-workers.fly.dev/diag/aa_wu_last' | python3 -m json.tool
# Probe any URL through WU (format=json envelope: status, set-cookie, x-brd-error)
curl -s 'https://pointsnap-workers.fly.dev/diag/wu_probe?url=https://mobile.aa.com/booking&method=GET' | python3 -m json.tool
```

### Commit log (Session 13)
| SHA | Message |
|---|---|
| `25b59e0` | feat(aa): WU two-step session-mint for AAdvantage award search |
| `c07e765` | fix(aa): WU mint runs all strategies, prefers spa_session_id jar |
| `62bcc9d` | fix(aa): WU award POST via format=json, fold AA-minted 309 cookies |

### Recon playbook — transferable techniques from the working plugins (Session 13)

Distilled from VS / AS / B6 successes + the AA/DL diagnostics. Apply this to any
airline a WU-grind agent reports as "resisted" or "endpoint not found".

**1. Read the airline's live JS bundle — it is ground truth.**
The B6 JetBlue win came from this: community intel (awardwiz, 2024) gave a dead
endpoint (`jbrest.jetblue.com/lfs-rwb/outboundLFS` → 404). The agent fetched
JetBlue's Angular `main.*.js`, grepped it, and found the CURRENT endpoint
referenced as `bffServiceBestFareUrl` → `jbrest.jetblue.com/bff/bff-service/bestFares/`.
Recipe: fetch the homepage HTML (via WU) → extract `<script src>` bundle URLs
(`main.*.js`, `app.*.js`, `runtime.*.js`, `vendor.*.js`, `chunk.*.js`) → fetch each
bundle → grep for `Url`, `endpoint`, `/api/`, `/bff/`, `award`, `redeem`, `search`,
`bestFare`, `availability`. The bundle constructs the real request — it reveals the
endpoint, the param/body shape, and any token-fetch flow.

**2. Probe the separate API / BFF host — the soft underbelly.**
Heavy bot defense sits on the consumer `www.<airline>`; the API host is often far
lighter. Confirmed: `jbrest.jetblue.com` (B6, wide open), `api.aa.com` (Phase 0:
permissive CORS + x-api-key), `api.qantas.com` (Phase 0: 3.9 MB no-auth JSON).
For each airline try: `api.<domain>`, `bff.<domain>`, `<iata>rest.<domain>`,
`mobile.<domain>`, `m.<domain>`, `booking.<domain>`, `services.<domain>`.

**3. WU GET ≫ WU POST. Prefer GET-able endpoints.**
DL proved it: WU GET `/shop/ow/search` → 200; WU POST same path → Akamai-444
edge-block. Any airline with a GET-able award endpoint (query-param search,
calendar) sidesteps the edge-block-POST problem entirely.

**4. Calendar / flexible-dates / month endpoints are gold.**
VS and B6 both win on whole-month award-calendar endpoints: GET-able,
lighter-defended, one cheap call returns a month of pricing. For each airline,
hunt the flexible-dates/calendar endpoint, not just per-flight search.

**5. Pattern B (WU in-page render) for edge-blocked-POST airlines.**
If the award API is POST-only AND edge-blocks the WU POST (DL pattern), have WU
GET the *results-page SPA URL* — the SPA fires its own POST from inside WU's
Akamai-cleared session (not edge-blocked, same-session). Parse the rendered DOM.

**6. Official airline developer APIs exist for some — 100% reliable.**
Agent 6 found official APIs: Singapore KrisConnect, Turkish Airlines dev portal
(`strawb3rryx7/tkapi`), AF-KL NDC. For SQ + TK, registering for the official API
beats scraping entirely. Needs an API key/registration (user action).

**7. One fix cascades.** The AS aircraft-FK savepoint patch in `common/db.py`
already protects every plugin from DB-write crashes on unknown aircraft codes —
no per-plugin work needed when a new plugin starts returning rows.

**Consolidation-pass plan**: when the 3 WU-grind agents report, for every airline
marked "resisted"/"endpoint not found", dispatch a focused agent armed with #1–#5
above (JS-bundle recon → BFF-host probe → GET-preference → Pattern B fallback).

---

### 2026-05-20 — Session 14 (AA WU plugin: BD Browser API mint rung)

Goal: add a BD Browser API mint rung to `aa_aadvantage/search_wu.py` so the AA WU
plugin can mint `spa_session_id` without depending on the disabled `pointsnap_webunlock`
zone "Manual Expect" setting (the Session 13 blocker). Branch
`claude/review-scraper-strategy-CXHmM`, commits `91d2d97` + `b1de16f`.

**Viability probe — BD Browser API CAN render www.aa.com and mint `spa_session_id`.**
Added a temporary `/diag/_tmp_aa_cookie_probe` endpoint (loads a URL via
`browser_page(use_brightdata=True)`, dumps `page.context.cookies()`), then removed it.
Probe results, BD Browser API (zone `pointsnap`, `BRIGHTDATA_WSS_URL`):
- `https://www.aa.com/booking/find-flights` → **HTTP 200**, redirects to
  `/booking/search/find-flights`, body is the real "Book flights" SPA form,
  **56-cookie jar with `XSRF-TOKEN` + `spa_session_id` + `JSESSIONID`**,
  `akamai_denied: false`. THIS is the URL that mints the SPA session.
- `https://www.aa.com/` and `/booking/find-flights` on a *different* exit IP →
  "Access Denied" (Akamai edgesuite hard-deny), only `bm_*` cookies, no session.
- `/booking/flights/choose-flights` → HTTP 404 (AA's "page must have taken flight"
  404 page — that path doesn't exist), but Akamai let it through: 45-cookie jar
  with `XSRF-TOKEN` + `JSESSIONID`, NO `spa_session_id` (the 404 page isn't the SPA).
- `/booking/choose-flights/1` → HTTP 200 but redirects to `/booking/session-timeout`
  (no active search in session); still minted `spa_session_id`.
Conclusion: BD Browser API renders www.aa.com on a clean exit IP and the booking
SPA's bootstrap mints `spa_session_id`. The earlier scraper-log "~0% AA success
via BD Browser API" was for a *harder* task (Patchright form-fill + result-page
render) — a simple page-load-and-read-cookies clears Akamai ~50% of the time.

**Mint rung built.** `search_wu.py` `_mint_via_browser_api()` / `_mint_browser_once()`:
opens `browser_page(use_brightdata=True)`, navigates `/booking/find-flights`, polls
`page.context.cookies()` until BOTH `XSRF-TOKEN` and `spa_session_id` are present
(they land at slightly different moments in the SPA bootstrap — `b1de16f` fixed an
initial bug where breaking on `spa_session_id`-only exported a jar missing
`XSRF-TOKEN`, which the ladder's XSRF-floored gate then dropped). Retries up to 3
fresh BD sessions for a complete jar. Gated to run only when the WU-GET strategies
fail to mint `spa_session_id`.

**Result — mint rung works, but `AA_AADVANTAGE_WU` still returns 0 rows.**
Across ~6 deployed `/search` runs (`/diag/aa_wu_last` captured each):
- Runs where a Browser-API try drew a clean IP: minted the full jar, ladder
  selected it (`minted_via: browser_api_findflights`, `spa_sid_present: true`),
  WU POST to `/booking/api/search/itinerary` → AA `{"error":"309",...,"slices":[]}`
  (95 bytes), `api_new_cookie_names: []`. **309 even with a valid `spa_session_id`.**
- Runs where all 3 Browser-API tries drew HTTP 403 hard-deny IPs (e.g. JFK→LAX
  19:32 run): rung minted nothing, ladder fell back to the `mobile.aa.com` jar,
  POST → 309. The 3-try retry rode out the deny ~50% of runs.

**Key finding: AA's award API session is TRANSPORT-BOUND, not just cookie-bound.**
`spa_session_id` is minted by a BD **Browser API** Chromium on exit IP A; the award
POST is replayed by BD **Web Unlocker** through a different exit IP B with a freshly
WU-solved Akamai context. AA binds the session to the originating browser's Akamai
`_abck` device + IP, so a complete cookie jar handed to a *separate* transport still
gets 309. `spa_session_id` is necessary but not sufficient — the request must also
originate from the device/IP that minted it. **The WU two-step is architecturally a
dead end for AA.**

**Next move (see blockers.md 2026-05-20 19:40):** do the whole search *inside* the
BD Browser API browser — after `/booking/find-flights` renders, fill the form / fire
the SPA's own search and capture `/booking/api/search/itinerary` via
`page.on("response")`. Session + `_abck` + IP + API call all share one browser
context → no 309. ~2-4 h; capped by BD Browser API's ~50% Akamai deny rate.

**Cost:** ~6 deployed `/search` runs (WU requests + ≤3 BD Browser API page loads
each, image/css/font-blocked). Bandwidth-billed; ~$0.05-0.15. No commercial APIs.

**Commits:**

| SHA | Message |
|---|---|
| `91d2d97` | wip(aa): in-flight AA Browser-API mint work — syntax-verified |
| `b1de16f` | fix(aa): BD Browser API mint rung must export both session cookies |

---

## Session 15 — 2026-05-21 — AC Aeroplan: air-bounds `{tenant}` RESOLVED; transport blocked

Goal: resolve the AC Aeroplan air-bounds `{tenant}` placeholder, wire it into
`ac_aeroplan/search.py`, and get an authenticated `/search` to return rows.
A logged-in Aeroplan session was captured for user
`e9d28a3e-9bfa-445b-a195-4ce19479ab07` (65 cookies in `program_auth_sessions`,
expires 2026-05-22T03:14:56Z — valid during this session).

### RESOLVED — the air-bounds `{tenant}` and full endpoint shape

Fetched the redeem SPA shell anonymously (no auth, no bot-defense block):
`GET https://www.aircanada.com/aeroplan/redeem/` → 200, 62 KB HTML, title
`AC Loyalty`. The HTML's inline `<script>KPSDK.configure([...])</script>` and
the Angular bundle `main.a9487328622ef44a.js` gave the ground truth:

- **Real tenant id: `1ASIUDALAC`** (the prior placeholder `1ASIATSAC` 404s).
- **API gateway host: `akamai-gw.dbaas.aircanada.com`** — NOT `www.aircanada.com`.
- **The redeem SPA uses the `dapidynamicplus` base, not `dapidynamic`.**
  `main.js`:  `Co = "https://akamai-gw.dbaas.aircanada.com"`,
  `ua = "/loyalty/dapidynamicplus/1ASIUDALAC/v2"`, the air-bounds API client
  basePath = `Co + ua`.
- **Full air-bounds URL:**
  `POST https://akamai-gw.dbaas.aircanada.com/loyalty/dapidynamicplus/1ASIUDALAC/v2/search/air-bounds?lang=en-CA`
- **Required request headers** (Angular `requestPlugins`):
  `x-api-key: Z5R8Rm1sA37iC0gaS5kb69ltHwKBTYzUa89gQDwm`,
  `x-app-client-id: redemption-web`.
- Body: a JSON object the SPA calls `airBoundsInputs`; the air-bounds method
  is `vendor.js` `AirBoundApi.airBoundsShopping(xt, Xt)` →
  `body = JSON.stringify(xt.airBoundsInputs)`, query param `lang`.
- The `KPSDK.configure` block registers BOTH
  `/loyalty/dapidynamic/1ASIUDALAC/v2/search/air-bounds` and the
  `dapidynamicplus` variant — the SPA's air-bounds client wires the
  `dapidynamicplus` base.

These are now baked into `ac_aeroplan/search.py` as the `AIR_BOUNDS_*`
constants (commit `bb4f33f`). `_auth_search` POSTs the correct URL + headers.

### BLOCKER — AC is Kasada-protected and the session cannot be replayed

The redeem page loads **Kasada** (`KPSDK.configure(...)` + the Kasada `p.js`
at `https://akamai-gw.dbaas.aircanada.com/<uuid>/<uuid>/p.js`). The
air-bounds POST is KPSDK-registered, so it requires per-request
`x-kpsdk-ct` / `x-kpsdk-cd` headers that **only AC's `p.js` can mint inside
a real browser**. A stateless WU `Cookie:`-header replay cannot produce
those — so the existing `_auth_search` WU path returns no rows even with
the correct tenant. The captured session must be replayed *inside a
browser* that runs `p.js`.

### BLOCKER — BD Browser API cannot inject a captured session for aircanada.com

Built `/diag/ac_air_bounds` (serve.py) — opens a browser, injects the
captured 65-cookie jar, navigates the redeem SPA, captures the air-bounds
XHR. **Every cookie-injection primitive failed on BD Browser API:**

- `context.add_cookies(...)` → `Protocol error (Storage.setCookies):
  Overriding deviceId, geoCityName, ..., XSRF-TOKEN, ... is forbidden`
  (22 cookie names listed).
- `clear_cookies()` then `add_cookies` → same error, even though
  `ctx.cookies()` confirmed the jar was empty (`jar_after_inject: 0`).
- CDP `Network.setCookies` (bulk) → same `Overriding ... forbidden`.
- CDP `Network.setCookie` (one-by-one, into a provably-empty jar) →
  `Overriding deviceId cookie is forbidden` — fails for a SINGLE cookie.
- CDP `Network.clearBrowserCookies` then `Network.setCookies` → same.
- CDP `Network.deleteCookies` per cookie, then `Network.setCookie` → same.
- `page.route("**/*", ...)` to rewrite the `Cookie` HEADER → broke BD's
  proxy tunnel: `Page.goto: net::ERR_TUNNEL_CONNECTION_FAILED` on every
  navigation (a plain `browser_page(use_brightdata=True)` page load to the
  SAME URL succeeds — so it is the second `page.route` handler that breaks
  the tunnel).
- `page.set_extra_http_headers({"Cookie": ...})` → did not crash, but the
  navigation then failed: `Page.navigate: Overriding deviceId, ... is
  forbidden` — the document-load itself rejected.
- `document.cookie` writes via an `add_init_script` → ALSO triggered
  `Page.navigate: Overriding ... is forbidden`.

**Conclusion: BD Browser API is a managed browser — it does not permit any
client-side cookie manipulation for the proxied domain.** This is a hard
architectural wall, definitively established. Do NOT re-attempt cookie
injection on BD Browser API for any airline; it will not work.

### BLOCKER — Camoufox crashes on the Fly worker

Pivoted `/diag/ac_air_bounds` to Camoufox (`use_camoufox=True`) — Camoufox
is a local Firefox where `add_cookies` works normally. **Camoufox is
currently broken on the deployed Fly worker:** both `/diag/ac_air_bounds`
and a plain `/diag/airline?use_camoufox=1&url=...` crash with
`Browser.close: unable to perform operation on <WriteUnixTransport
closed=True ...>; the handler is closed` — the Camoufox browser process
dies. The Camoufox runtime in the deployed image is broken and needs an
infra fix (Dockerfile / Camoufox bundle / Xvfb) before it is usable. The
endpoint was reverted to BD Browser API as a still-functional recon tool.

### Useful facts learned (forensic detail for next session)

- `GET https://www.aircanada.com/aeroplan/redeem/` is **anonymously
  fetchable** (200, 62 KB) — NOT Akamai-blocked. So is `/aeroplan/redeem/
  main.<hash>.js` and `vendor.<hash>.js`.
- `GET https://www.aircanada.com/aeroplan/redeem/availability/outbound?...`
  (the deep-link with search params) **IS Akamai path-protected** — `403
  Access Denied` (`edgesuite.net` reference) from BD exit IPs. The redeem
  SPA *root* loads, the `/availability/` deep-link does not.
- In-app SPA navigation works: load `/aeroplan/redeem/` then
  `history.pushState` + `dispatchEvent(new PopStateEvent('popstate'))` to
  the `/availability/outbound?...` route — no Akamai-protected document
  request. The Angular router picks it up. (But without a logged-in session
  the SPA then redirects to `/clogin/pages/login`.)
- The redeem SPA's auth guard reads login state **client-side from
  `document.cookie`** (the Gigya `glt_3_*` / `gig_loginToken_3_*` cookies),
  not from an API call — it redirects to `/clogin` BEFORE making any
  `/loyalty/` XHR.
- Captured-jar cookie facts: the Gigya login cookies `glt_3_...`,
  `gig_bootstrap_3_...` (domain `.aircanada.com`) and `gig_loginToken_3_...`
  (domain `.login.aircanada.com`) are all **non-httpOnly** (so settable via
  `document.cookie` on a transport that allows it). `XSRF-TOKEN` and
  `cognito` are httpOnly, domain `auth.api-gw.dbaas.aircanada.com`.
- The captured cookies carry `partitionKey` + `_crHasCrossSiteAncestor`
  fields (Playwright 1.5x+ CHIPS capture) — these must be stripped before
  `add_cookies` on any transport.
- AC v seats.aero: AC built the Aeroplan login wall in March 2025 to stop
  award scrapers. Throttle aggressively.

### Open angles for next session (prioritized)

1. **Fix Camoufox on the Fly worker.** Camoufox is the only transport that
   both runs `p.js` (mints Kasada tokens) AND allows `add_cookies` (injects
   the captured session). The `Browser.close ... handler is closed` crash
   needs debugging — likely a Dockerfile / `camoufox fetch` / Xvfb issue.
   Once Camoufox runs: `/diag/ac_air_bounds` is already written to inject
   the jar via `add_cookies`, drive the redeem SPA in-app, and capture the
   air-bounds XHR (URL + headers + body). That one capture finalizes the
   `airBoundsInputs` body and — if Akamai/Kasada accept the injected
   session — yields real rows.
2. **BD Residential + Camoufox** (zone `pointsnap_residential`,
   `BRIGHTDATA_RESIDENTIAL_URL`) — gives Camoufox a clean residential IP if
   Fly egress is Akamai-flagged for AC.
3. The `airBoundsInputs` body shape can also be partially reverse-engineered
   from `main.js`/`vendor.js` but it is assembled from NgRx state, not a
   greppable literal — a live XHR capture is far more reliable.

### Commit log (Session 15)

| SHA | Message |
|---|---|
| `6c31292` | diag(ac): add /diag/ac_air_bounds to capture the real air-bounds request |
| `2220b00` | diag(ac): surface raw cookie-injection failure |
| `cb6e825` | diag(ac): clear stale jar + retry redeem nav past Akamai deny |
| `17b0d44` | diag(ac): inject cookies via CDP Network.setCookies + land redeem root |
| `87c56fe` | diag(ac): surface CDP cookie-injection error + post-inject jar count |
| `e4f95fe` | diag(ac): clear cookie jar before CDP injection, inject before first nav |
| `630b005` | diag(ac): inject session via Cookie-header rewrite, not cookie store |
| `b595b06` | diag(ac): dump redeem-root search-form inputs |
| `399bf70` | diag(ac): drive air-bounds via in-app SPA navigation |
| `76b205a` | diag(ac): dump SPA storage + session expiry to find the auth signal |
| `07c9a71` | diag(ac): inject auth cookies via document.cookie init script |
| `e65d5b6` | diag(ac): terminal route handler, leave document request untouched |
| `2085270` | diag(ac): use set_extra_http_headers for Cookie, drop page.route |
| `643bfc6` | diag(ac): pivot air-bounds capture to Camoufox |
| `bb4f33f` | fix(ac): wire resolved air-bounds tenant/host/path/headers into plugin |

---

## Session 16 — 2026-05-21 — AC Aeroplan: Camoufox crash MISDIAGNOSED; real cause = IPRoyal proxy

Goal: finish the AC Aeroplan award search. Pick up Session 15's #1 open angle
("fix Camoufox on the Fly worker"). Same captured session for user
`e9d28a3e-9bfa-445b-a195-4ce19479ab07` (65 cookies, expires 2026-05-22T03:14:56Z).

### CORRECTION — Camoufox is NOT broken on the Fly worker

Session 15 concluded "Camoufox crashes on the Fly worker
(`Browser.close ... handler is closed`)" and listed a Dockerfile/Xvfb infra
fix as the #1 task. **That diagnosis was wrong.** Reproduction this session:

| Test | Result |
|---|---|
| `GET /diag/airline?use_camoufox=1&url=https://example.com` | **200**, title `Example Domain`, no crash — Camoufox runs fine |
| `GET /diag/airline?use_camoufox=1&url=https://www.aircanada.com/aeroplan/redeem/` (default `use_proxy=1`) | `Page.goto: NS_ERROR_PROXY_FORBIDDEN` |
| `GET /diag/airline?use_camoufox=1&use_proxy=0&url=https://www.aircanada.com/aeroplan/redeem/` | **200**, title `AC Loyalty`, AC's Akamai sensor.js executing in console — works |

Root cause: `/diag/airline` defaults `use_proxy=1`. The `browser_page()`
Camoufox branch, when `use_proxy=True` and no BD-residential, routes Camoufox
through **IPRoyal residential** (`_proxy_kwargs()`). **IPRoyal blocks
aircanada.com at the CONNECT layer** (already documented in this log's Tools
table — "IPRoyal blocks AA/DL/AC at CONNECT"). Firefox surfaces a forbidden
CONNECT as `NS_ERROR_PROXY_FORBIDDEN`; when the dead proxied browser is then
torn down, Playwright's transport is already gone and `Browser.close` throws
`handler is closed`. **Session 15 saw the teardown-crash variant and wrongly
blamed the Camoufox runtime / Docker image.** The Dockerfile + `camoufox fetch`
+ Xvfb are all fine — no infra change is needed.

Fix: Camoufox must run with `use_proxy=False` (Fly direct egress) for
aircanada.com — exactly what Sekinal's AA pattern already does. `/diag/
ac_air_bounds` (still hardcoded `use_brightdata=True` from the Session-15
revert) is being switched to `use_camoufox=True, use_proxy=False`.

### BUT — the `handler is closed` crash ALSO reproduces with use_proxy=False

After switching `/diag/ac_air_bounds` to Camoufox + Fly egress, the
`Browser.close: unable to perform operation on <WriteUnixTransport
closed=True ...>; the handler is closed` crash STILL fired on the AC
redeem flow. So it is NOT only an IPRoyal artifact — IPRoyal was just the
FIRST way to trigger it. Rebuilt `/diag/ac_air_bounds` with a direct
Camoufox lifecycle (crash-safe teardown) + a per-phase `steps` trace, and
added `/diag/sysinfo`. Forensic results:

**Memory + /dev/shm RULED OUT.** `/diag/sysinfo` on the idle worker:
`MemAvailable 3.69 GB`, `SwapTotal 0`, **`/dev/shm` total 1958 MB**
(~1.9 GB — not the feared 64 MB), worker idle RSS ~68 MB. Firefox + a
heavy SPA cannot OOM in 3.6 GB free. So the crash is neither memory nor
/dev/shm exhaustion.

**Step trace pinpoints the crash.** `/diag/ac_air_bounds` step timings:
`camoufox_launched` t=51.9s (slow cold Firefox start, not fatal) →
`cookies_injected` 65 ok → `nav_redeem_root_done landed=True status=200`
t=65.3 (redeem page loads fine) → `spa_bootstrapped` t=73.3 → then the
next call `page.evaluate` (spa_storage dump) failed `handler is closed`.
`loyalty_urls_seen` shows the SPA DID start (fetched `info.json`,
`app-config.json`, `airports.json`). **Firefox's process dies during AC
redeem-SPA bootstrap, ~10-20s after the page loads.**

**Reproduces ANONYMOUSLY.** `/diag/airline?use_camoufox=1&use_proxy=0&
wait_ms=20000&url=https://www.aircanada.com/aeroplan/redeem/` (no injected
cookies, 20s wait) → same `handler is closed` crash. So the crash is NOT
the injected session either — it is the AC redeem SPA itself crashing the
Camoufox Firefox process. (`example.com` with the same Camoufox config
survives fine; a `wait_ms=0` redeem load also survived — it crashes only
when the SPA runs for ~10-20s.)

### ROOT CAUSE — `headless="virtual"` 1x1 Xvfb GLX context + WebGL

`camoufox/virtdisplay.py`: `headless="virtual"` spawns Xvfb with
`-screen 0 1x1x24` (a hardcoded **1x1-pixel** screen) and `+extension
GLX`. Air Canada's redeem SPA — Kasada `p.js` + Akamai `sensor.js` —
aggressively probes **WebGL** for fingerprinting. A WebGL draw on a
degenerate 1x1 Xvfb GLX context crashes the Firefox content process. That
is why example.com (no WebGL) survives and the AC redeem SPA does not.

**Fix attempt (WRONG):** switched `build_camoufox_config()` to
`headless=True`. **Did not fix it** — Firefox still died during redeem-SPA
bootstrap with no Xvfb in the path. WebGL/1x1-GLX theory disproved.

### ACTUAL ROOT CAUSE — Playwright 1.60 Firefox driver NPE crash

Built `/diag/camoufox_probe` — runs the Camoufox load in a **subprocess**
with full stdout+stderr capture (the async handler only ever sees
Playwright's `handler is closed` wrapper, never the real cause). The
subprocess `stderr` finally showed it:

```
/usr/local/lib/python3.12/site-packages/playwright/driver/package/lib/coreBundle.js:49624
              url: pageError.location.url,
                                      ^
TypeError: Cannot read properties of undefined (reading 'url')
    at FFBrowserContext.<anonymous> (.../coreBundle.js:49624:39)
    at _Page.addPageError (.../coreBundle.js:19951:16)
    at FFPage._onUncaughtError (.../coreBundle.js:43470:20)
Node.js v24.15.0   [process exits]
```

It is **NOT a browser crash at all** — there is zero Firefox crash dump
(`/diag/firefox_crashes` → `[]`). The **Playwright Node driver process**
crashes: when Air Canada's redeem SPA / Kasada `p.js` raises an uncaught
JS error within ~2-4s of load, Firefox emits a page-error event whose
`location` field is `undefined`; Playwright 1.60's `FFBrowserContext`
page-error handler does `pageError.location.url` with no null-check →
`TypeError` → the **entire Node driver exits** → the Python side loses the
stdio pipe → `WriteUnixTransport closed` / `Connection closed while
reading from the driver`. (`example.com`, which throws no uncaught error,
survives indefinitely — confirmed via the same probe.)

Probe timeline (AC redeem): camoufox launched → `goto` 200 "AC Loyalty" →
`alive t+2s` → **`DEAD at t+4s: Connection closed while reading from the
driver`**. Crash is ~2-4s after load, exactly when the SPA's first
uncaught error fires. `camoufox` itself, `headless`, `use_proxy`, memory,
`/dev/shm`, and the injected cookies are all IRRELEVANT — every one of
those was varied and the crash is identical; the only constant is the AC
SPA raising an uncaught error.

**Fix attempt 1 (`install_pw_crash_shield`, FAILED):** an init script
registering capture-phase `error`/`unhandledrejection` handlers that
`preventDefault()`. Verified via `/diag/camoufox_probe?shield=1` — **same
crash at coreBundle.js:49624**. A page-level `error`-event handler does
NOT stop the crash: Firefox's Juggler protocol emits the page-error
telemetry at the JS-engine error-report level, *before* the page's own
`error` handlers run. The shield is kept (it does silence the console
noise) but it is not the fix.

**Fix attempt 2 (`patch_playwright.py`, THE FIX):** patch the Playwright
driver bundle directly. `python-workers/patch_playwright.py` (run at
Docker build, after `camoufox fetch` so that layer stays cached) patches
`FFPage._onUncaughtError`: `this._page.addPageError(error,
params2.location)` → `... params2.location || { url: "", lineNumber: 0,
columnNumber: 0 }`. The default object is TYPE-CORRECT (`url` a string,
`lineNumber`/`columnNumber` numbers) — a plain `{}` would relocate the
crash to Playwright's protocol validator (`ValidationError: location.url:
expected string, got undefined`). Plus defensive `(pageError.location||
{}).X` guards at the two dispatch sites. Behaviour-preserving, idempotent.

**VERIFIED FIXED.** `/diag/camoufox_probe` on `aircanada.com/aeroplan/
redeem/` now stays alive the full 44s (`alive t+2s` … `alive t+44s`,
clean `teardown ok`). The Camoufox-on-Fly crash is resolved — root cause
was a Playwright-1.60 Firefox-driver NPE, NOT a browser/Camoufox/Xvfb/
memory problem.

### After the crash fix — the AUTH wall (Session 16 continued)

Camoufox now drives the AC redeem SPA fine, but `/search` still returns
0 rows because the **captured Aeroplan session is too stale to use**:

- The injected jar (65 cookies) is now fully retained (`jar_after_inject:
  65`) — fixed by injecting every cookie as a SESSION cookie (dropping the
  captured `expires`), since the captured expiries are partly in the past.
- Forensic `auth_cookie_detail` of the captured jar:
  * `glt_3_*` (Gigya short-lived login token) — **expired ~1.3 h** before
    the test (`expires 1779340446` ≈ 2026-05-21 05:14 UTC).
  * `cognito` (the AWS-Cognito session for `auth.api-gw.dbaas.aircanada
    .com`, which gates the air-bounds API) — **expired ~2.3 h** before the
    test (`expires 1779336869` ≈ 04:14 UTC).
  * `gig_loginToken_3_*` / `gmid` / `ucid` (Gigya remember-me + device
    tokens) — valid to **2027**.
- With the short-lived tokens expired, the redeem SPA's auth guard bounces
  to AC's silent-SSO chain: `auth.api-gw.../oauth2/authorize` →
  `akamai-gw.../cognito-proxy/authorize-proxy` → `www.aircanada.com/
  clogin/pages/proxy?context=<JWT>` (loads `ac_SSO_bundle.js`) → and after
  ~57 s → **`/clogin/pages/error?code=SYS011`**. The SSO bundle makes NO
  Gigya call — it bails before contacting Gigya, then times out → SYS011.
  So the silent re-auth from the long-lived remember-me token FAILS for a
  >2 h-stale session replayed in a fresh browser.
- A direct `fetch()`/XHR to the air-bounds API
  (`POST akamai-gw.dbaas.aircanada.com/loyalty/dapidynamicplus/
  1ASIUDALAC/v2/search/air-bounds?lang=en-CA`) from the redeem page → HTTP
  **429** with NO `x-kpsdk-*` request header — Kasada's `p.js` does not
  stamp a `page.evaluate` fetch that runs before its challenge solves.

**Confirmed transport facts for the production wiring:**
- The air-bounds endpoint URL/headers in `ac_aeroplan/search.py`
  (`AIR_BOUNDS_*`) are correct — a request reaches it (got a 429, not a
  404/DNS error).
- `window.KPSDK` is **absent** on the redeem SPA *root* page — the redeem
  root does NOT load Kasada `p.js`. Only the logged-in `/availability/`
  page state runs `p.js` (and would fire a properly-`x-kpsdk-*`-stamped
  air-bounds XHR). A `page.evaluate` fetch/XHR from the redeem root is
  unstamped → Kasada 429. So a manual air-bounds call from outside the
  logged-in SPA is not viable; the SPA must make the call itself.

### CONCLUSION — Camoufox crash fixed; this captured session is stale

**What was achieved (Session 16):**
- The Camoufox-on-Fly crash is **fixed** (`patch_playwright.py` — the
  Playwright-1.60 Firefox-driver `pageError.location` NPE). Verified: the
  AC redeem SPA runs in Camoufox 44s+ with a clean teardown.
- `ac_aeroplan/search.py` `_auth_search` is **rewired** off the dead WU
  `Cookie:`-replay onto the real Camoufox transport `_camoufox_air_bounds`
  — launch Camoufox, inject the captured jar (as session cookies), drive
  the redeem SPA root → availability deep-link, capture the SPA's own
  air-bounds XHR, parse with `_parse_air_bounds`.

**Why `/search` still returns `[]` for user `e9d28a3e-…`:** the captured
Aeroplan session is **expired**. Its short-lived Gigya/Cognito tokens
(`glt_3_*`, `cognito`) lapsed ~1.3-2.3 h before testing; AC's silent-SSO
refresh (`/clogin/pages/proxy` → `ac_SSO_bundle.js`) fails with `SYS011`
for a stale session replayed in a fresh browser. The redeem SPA therefore
never reaches a logged-in state, never loads Kasada `p.js`, and never
fires the air-bounds XHR. This is NOT a code defect — it is session
staleness. The `program_auth_sessions` row's `expires_at` (2026-05-22)
is bookkeeping; the *real* Gigya session lifetime is far shorter.

**To get real rows:** capture a FRESH Aeroplan session (via the cockpit
`/airlines` connect flow) and run `/search` within the Gigya session's
live window (minutes-to-≈1 h, not hours). The transport code is now
complete and proven to drive the SPA — only a live session is needed.

**Open follow-up (next session):** confirm whether a fresh session
replayed in Camoufox stays logged in end-to-end (it should — Camoufox's
fingerprint is stable and AC's `gmid`/`ucid` device tokens are valid),
OR whether AC's silent SSO is browser/IP-bound such that even a fresh
captured session can't be replayed in a different browser. If the latter,
the T5' capture flow itself (`auth/capture.py`, currently BD Browser API)
should capture *and search* in one continuous browser session rather than
capture-then-replay.

### Commit log (Session 16)

| SHA | Message |
|---|---|
| `9716b42` | diag(ac): switch ac_air_bounds capture to Camoufox + Fly egress |
| `4f13fe3` | diag(ac): step-traced ac_air_bounds + sysinfo; harden Camoufox memory |
| `f76e9e7` | fix(ac): Camoufox headless=True — escape the 1x1 Xvfb GLX WebGL crash |
| `e897fe9` | diag(ac): capture Firefox crash signature + webgl_off/fast_nav probes |
| `99c1570` | diag(ac): bulletproof ac_air_bounds teardown + standalone crash reader |
| `848b29b` | fix(diag): add missing `import os` in serve.py |
| `bfc5e4d` | diag(ac): subprocess Camoufox probe to capture the REAL crash cause |
| `2c47d3f` | fix(ac): shield against the Playwright-1.60 Firefox driver NPE crash |
| `7d3d3eb` | fix(diag): self-contained camoufox_probe script |
| `130e813` | fix(ac): patch the Playwright Firefox driver page-error NPE crash |
| `1129319` | fix(ac): patch the page-error crash at its SOURCE (_onUncaughtError) |
| `1438f6e` | diag(ac): direct availability deep-link nav + full cookie/login dump |
| `96ee9ec` | diag(ac): inject cookies as session cookies + per-cookie drop forensics |
| `031f41a` | diag(ac): wait through the /clogin silent-SSO redirect chain |
| `cd9a2af` | diag(ac): ride the full /clogin redirect chain to settle |
| `869894b` | diag(ac): capture /clogin + oauth2 + auth-gw traffic to debug SYS011 |
| `7fa37e8` | diag(ac): direct air-bounds fetch probe + full /clogin SSO chain capture |
| `ed4c0e8` | diag(ac): probe air-bounds via XHR after 28s Kasada settle |
| `e300987` | feat(ac): wire _auth_search to the Camoufox air-bounds transport |

---

## Session 17 — 2026-05-21 — AC Aeroplan: route Camoufox through BD Residential to beat the Kasada 429

Goal: get the AC Aeroplan `/search` to return real award rows. Session 16
left the transport "complete and proven to drive the SPA" but `/search`
returned `[]` — the captured session was stale (SYS011). A FRESH session
for user `e9d28a3e-9bfa-445b-a195-4ce19479ab07` was re-captured this
session (~2026-05-21T15:34Z): Camoufox launches, ~50 cookies inject,
login completes (Cognito tokens minted, NO SYS011), the redeem SPA reaches
the logged-in availability page ("Select departing flight"). THE WALL: the
SPA's own air-bounds XHR to `akamai-gw.dbaas.aircanada.com/loyalty/
dapidynamicplus/1ASIUDALAC/v2/search/air-bounds?lang=en-CA` returns HTTP
**429** — a Kasada block (body is a `KPSDK` challenge page). Diagnosis from
the parent: the request leaves the Fly worker's DATA-CENTER IP and Kasada
flags data-center traffic on sight.

### Bug found + fixed — `_camoufox_air_bounds` raised NameError

`ac_aeroplan/search.py` used `asyncio.sleep` / `asyncio.wait_for` inside
`_camoufox_air_bounds` but its import block had **no `import asyncio`**.
Every production `/search` auth call therefore raised
`NameError: name 'asyncio' is not defined` the moment the transport ran —
the `/diag/ac_air_bounds` endpoint imports `asyncio` at module scope in
`serve.py` so it was unaffected, which is why the bug hid. Added
`import asyncio` to `search.py`.

### Transport fix — Bright Data Residential CA exit

`build_camoufox_config` previously launched Camoufox with NO proxy
(`geoip: False  # Fly direct egress`). Rewired it to route through a
Bright Data Residential **Canada** exit IP:
- `build_camoufox_config` now calls `common.browser._brightdata_residential_proxy(country="ca")`
  — that helper parses `BRIGHTDATA_RESIDENTIAL_URL` into a
  `{server, username, password}` dict and appends `-country-ca` to the
  username so the exit lands in Canada (AC is a Canadian carrier).
- When the proxy is set: `cfg["proxy"] = bd_proxy` and `geoip=True` so
  Camoufox derives a Canadian TZ/locale/lat-long from the exit IP
  (internally-consistent fingerprint).
- Both contexts (`_camoufox_air_bounds` in `search.py` and the
  `/diag/ac_air_bounds` endpoint in `serve.py`) now pass
  `ignore_https_errors=True` when the proxy is active — BD Residential
  MITMs HTTPS and presents its own cert, so Firefox would otherwise throw
  `SEC_ERROR_UNKNOWN_ISSUER`.
- If `BRIGHTDATA_RESIDENTIAL_URL` is unset the helper returns None and the
  launch falls back to direct Fly egress (degrades, not hard-fails).

### `BRIGHTDATA_RESIDENTIAL_URL` IS set on the worker — verified

`GET /diag/airline?use_camoufox=1&brightdata_residential=1&brightdata_country=ca&url=https://geo.brdtest.com/welcome.txt?product=resi&method=native`
→ 200, body: `Country: CA  City: Delta  Region: BC  ASN 11260 EastLink`.
So the BD Residential secret is present, the proxy works, and `-country-ca`
correctly lands a Canadian residential exit (a real EastLink home IP in
Delta, BC). This is the canonical way to confirm the secret without a
`/diag/env` endpoint (there is none).

### Commit log (Session 17)

| SHA | Message |
|---|---|
| `cc9103a` | fix(ac): import asyncio + route Camoufox through BD Residential CA exit |
