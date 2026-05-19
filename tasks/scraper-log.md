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
