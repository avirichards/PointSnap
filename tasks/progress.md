# PointSnap Scraper Recovery — Live Progress Stream

Append-only checkpoint log. One entry per task or milestone. Newest at the bottom.

Format:
```
## YYYY-MM-DD HH:MM — <Phase N.M>: <name>
**Status**: ✅ | 🟡 (partial) | 🔴 (failed) | 🚀 (started)
**Outcome**: <one sentence>
**Spent**: <wall-clock, BD bytes, $>
**Next**: <task ID>
```

---

## 2026-05-19 16:45 — Phase 0: Multi-agent intelligence gathering
**Status**: 🚀 (started)
**Outcome**: Dispatching 8 parallel research subagents (background). Each writes to `tasks/scraper-research/agent-{N}-{topic}.md`. Parent consolidates into `tasks/scraper-rubric.md` when all return.
**Spent**: 0 min wall-clock, $0 BD, $0 commercial
**Next**: While Phase 0 runs, write `common/browser.py` BD Residential helper (uncontroversial infra; Phase 0 won't change it)

## 2026-05-19 17:05 — Infrastructure: BD Residential helper + /diag/airline params
**Status**: ✅
**Outcome**: `_brightdata_residential_proxy(country, session)` added to `common/browser.py`; `browser_page()` accepts `use_brightdata_residential` + `brightdata_country`; `/diag/airline` exposes the new path for ad-hoc smoke testing. Committed (f5e7bef) + pushed. GH Action triggered; Fly will redeploy with the BD secret picked up.
**Spent**: ~20 min wall-clock, $0 BD, $0 commercial
**Next**: Wait for GH Action to complete (~2-5 min cached build); verify worker has BRIGHTDATA_RESIDENTIAL_URL via /diag/airline smoke; continue with Phase 0 agent monitoring

## 2026-05-19 17:30 — Phase 0: 6 of 8 agents complete + smoke tests
**Status**: 🟡 (partial — 6/8 complete)
**Outcome**: Major findings landed. Camoufox + Fly egress against aa.com returns HTTP 200 with sensor.js executing — Sekinal's exact recipe works. JetBlue confirmed open (T0). Critical: 20/23 programs require login (Phase 2.5 is mainline, not fallback). No commercial Plan B exists for award search except seats.aero (user rejected).

Agents complete:
- ✅ 1 (AA OSS) — Sekinal/aa_contest detailed. curl_cffi impersonate="firefox135" + 90s wait_for_function pattern
- ✅ 2 (Apify) — Closed Go source, direct API hits, 60-day cap structural
- ✅ 3 (Bot defense) — 28/28 profiled. 23 Akamai, 2 Cloudflare, 2 Imperva. api.aa.com has permissive CORS.
- ✅ 5 (Auth viability) — 20/23 require login. Aeroplan March-2025 wall is the linchpin for T5'.
- ✅ 7 (Commercial APIs) — Only seats.aero returns award prices. T7 layer effectively empty.
- ✅ 8 (Partner backdoors) — 16 hubs documented. 5 airlines have no viable cross-check.

Agents pending:
- 🚀 4 (Mobile API mapping) — running
- 🚀 6 (Community knowledge) — running

Smoke tests:
- ✅ Worker /health 200
- ❌ /diag/airline?brightdata_residential=1 → SEC_ERROR_UNKNOWN_ISSUER (BD MITMs HTTPS by default; need ignore_https_errors or CA install)
- ✅ /diag/airline?use_camoufox=1&use_proxy=0 against httpbin.org/ip → 200 + Fly egress IP
- ✅ /diag/airline?use_camoufox=1&use_proxy=0 against aa.com → 200 + sensor.js executes + no Access Denied

**Spent**: ~45 min wall-clock, 0 MB BD (SSL error before bytes flowed), $0
**Next**: Wait for Agents 4 + 6; consolidate findings into scraper-rubric.md; decide whether to fix BD MITM cert issue (may not be needed if Sekinal recipe works); pivot Phase 1 to follow Sekinal exactly (Camoufox → /booking/search direct → curl_cffi /booking/api/search/itinerary POST)

## 2026-05-19 17:50 — Phase 0 complete (8/8) + AA Sekinal refactor pushed
**Status**: 🚀 (AA test in flight)
**Outcome**: All 8 Phase 0 agents complete. Per-airline rubric written. AA plugin rewritten to use Sekinal/aa_contest pattern (deep-link `/booking/search?slices=[...]` + XHR capture via `page.on("response")`). Form-fill flow removed entirely. -245 / +147 lines net.

Phase 0 final tally:
- ✅ Agent 1: AA OSS deep-dive — Sekinal exact recipe + asadfix 2026 guide
- ✅ Agent 2: Apify igolaizola — closed Go source, direct API hits, $3/1k pricing
- ✅ Agent 3: Bot defense profiling — 28/28 airlines, 23 Akamai, 2 Cloudflare, 2 Imperva, 1 Fastly
- ✅ Agent 4: Mobile API mapping — `api.qantas.com` open, `api.aa.com` HTTP/2 CORS, `b2c.voegol.com.br` clean
- ✅ Agent 5: T5' auth viability — 20/23 require login; AC Aeroplan is the linchpin
- ✅ Agent 6: Community intel — verbatim endpoint URLs for AA/UA/AC/AS/B6/SW/DL; AC lawsuit warning
- ✅ Agent 7: Commercial APIs — only seats.aero returns award prices; T7 effectively empty
- ✅ Agent 8: Partner backdoors — 16 hubs documented, 5 airlines have no cross-check

AA plugin commit: 587d4a6 (deployed via GH Action)

**Spent**: ~65 min wall-clock, 0 BD bytes (no proxy used per Sekinal), $0
**Next**: AA end-to-end test in flight (background); if rows>0, AA flips to ✅ in rubric and we move to Phase 2 starting with B6 JetBlue (T0 — easiest); if 0 rows, inspect /diag/aa_last for verdict, adjust pattern

## 2026-05-19 18:05 — AA Sekinal test #1: 3× xhr_timeout
**Status**: 🟡 (retrying)
**Outcome**: First Sekinal smoke test returned 3 attempts × `xhr_timeout`. Each attempt: HTTP 200 (good), title="" (SPA not rendered), html_len=2380 (just the SPA shell), 0 itinerary XHRs captured. Camoufox + Fly egress is reaching aa.com but the SPA never fires the `/booking/api/search/itinerary` call within our 30s wait window.

Diagnosis: sensor.js takes 30-60s to complete scoring; `_abck` likely hadn't reached the trusted `~0~` state by the 30s mark, so AA's SPA gated the API call. Sekinal explicitly uses 90s wait_for_function for this reason.

Fix landed (commit cc84f1e):
- XHR wait window: 30s → 90s
- _abck cookie state logged every 10s during wait
- On final xhr_timeout: capture html_preview + _abck cookie + cookies_count to diag

Re-running smoke now (background curl b4q41se1e, ~6min wall-clock max).

**Spent**: ~10 BD MB (smoke probes), ~$0.001
**Next**: If smoke #2 returns rows, AA flips ✅ and Phase 2 starts; if still timeout, inspect diag _abck state, possibly add a click-search-button fallback, possibly try BD Residential

## 2026-05-19 18:11 — AA Sekinal test #2: _abck stuck at ~-1~ from Fly egress
**Status**: 🔴 (failed — pivoting)
**Outcome**: 3× xhr_timeout, but the new diag revealed the root cause:
- `_abck` minted to `~-1~` (untrusted) on all 3 attempts
- Never reached `~0~` (trusted) within the 90s wait
- 12 cookies received → sensor.js IS executing
- title="" + html_len=2380 → SPA never rendered the booking widget because the API never fired

Akamai BMP is flagging Fly's datacenter egress IP regardless of Camoufox's Firefox-like fingerprint. Sekinal's claim of "Fly egress works for AA" is contradicted by our actual measurements; their setup likely uses a residential exit or different cloud.

**Pivot**: switch AA to BD Residential (commit f29a135). Refactored Camoufox branch in browser_page() to use explicit new_context with `ignore_https_errors=True` when `use_brightdata_residential=True` (BD MITMs HTTPS by default, serving its own cert; Firefox throws SEC_ERROR_UNKNOWN_ISSUER without this).

AA plugin call site now:
```python
browser_page(
    use_camoufox=True,
    use_brightdata_residential=True,
    brightdata_country="us",
    brightdata_session=f"aa_{int(time.time())}_{attempt}",
)
```

3-test smoke chain (background b2bjsxtmq, ~16min worst case):
1. BD Residential SSL fix verified via geo.brdtest.com
2. AA homepage via BD Residential US — does Akamai serve it?
3. Full AA search end-to-end

**Spent**: ~$0 BD (no bytes flowed yet via BD; previous tests all failed at TLS)
**Next**: Read 3-test outcome; if BD US IPs also Akamai-flagged, escalate to BD Web Unlocker (different product); if works, AA flips ✅ and Phase 2 (JetBlue first) starts

## 2026-05-19 18:30 — AA test #3 (BD Residential): mixed results
**Status**: 🟡 (debugging)
**Outcome**: Direct /diag/airline?use_camoufox=1&brightdata_residential=1 against aa.com returns HTTP 200 with sensor.js executing (confirmed twice, 10min apart). **BD Residential reaches aa.com fine.** BD geo info: AT&T Enterprises ASN 7018, Los Angeles, CA — clean US residential IP.

But the full /search call returns rows=[] with verdicts=['nav_failed','crash','nav_failed']. The plugin's 3-attempt loop fails where the direct /diag works.

The current per-attempt diag was empty (returns occur before diag-append site). Added exception capture to LAST_RUN_DIAG for homepage_goto, deep_link_goto, and outer crash stages (commit 30849cb). Re-running smoke now (bmydkiv5s, ~10min).

Hypotheses for nav_failed+crash:
- 3 sequential Camoufox launches on Fly exhaust memory (each ~300MB)
- BD pool returns degraded IPs for rapid sequential sessions
- AA detects pattern after first session and blocks subsequent sessions
- BD per-session billing burns through some limit

**Spent**: ~1MB BD (smoke probes), ~$0.001
**Next**: read exception detail; if memory/concurrency: reduce MAX_ATTEMPTS to 1 or add cooldown between attempts; if BD pool issue: try BD Web Unlocker fallback (user created earlier)

## 2026-05-19 18:45 — AA test #5 diagnosis: visible Akamai challenge on deep-link
**Status**: 🟡 (testing full Sekinal pattern)
**Outcome**: Test #4's exception-capture diag revealed:
- attempt 1+2: SEC_ERROR_UNKNOWN_ISSUER on deep_link_goto (BD MITM cert handling degrades on 2nd goto in same context)
- attempt 3: Page crashed on homepage_goto (resource exhaustion accumulating)

Test #5 (skip homepage, deep-link only, single attempt) captured the actual HTML:
- HTML body: Akamai's visible BMP challenge interstitial with `sec-if-cpt-container`, `sec-bc-tile-parent`, "Powered and protected by Akamai" logo, tile-puzzle UI
- `_abck=~-1~` (untrusted) — visible challenge gates _abck=~0~ behind a human-solvable CAPTCHA
- 12 cookies, 0 XHRs

**Pivot to Sekinal's FULL pattern** (commit 485de86): cookie-mint + curl_cffi API replay.
- Camoufox loads ONLY the homepage (clean from BD residential)
- Wait up to 60s for XSRF-TOKEN + spa_session_id to mint
- Export cookies + user-agent
- curl_cffi (impersonate=firefox135) POSTs to /booking/api/search/itinerary directly
- Through the SAME BD sticky session for IP consistency
- verify=False because BD MITMs HTTPS

The API gate validates cookies + TLS fingerprint, NOT _abck=~0~ (which is the SPA browser session gate). So this can work even when _abck stays at ~-1~ from non-trusted IPs.

Test #6 in flight (bl95z7cxp, ~5min). New verdict codes capture failure modes: no_cookies, api_403, api_html, api_no_json, api_no_slices, curl_err:<type>.

**Spent**: ~5 MB BD across all smoke probes, ~$0.04
**Next**: Read test #6; if ok → AA flips ✅ + Phase 2; if api_403 → AA's API also Akamai-gated and we need _abck=~0~ minted via Camoufox first; if no_cookies → AA's bootstrap doesn't mint those cookies on homepage alone; pivot accordingly

## 2026-05-19 19:15 — Phase 2 plugin status (probe sweep)
**Status**: 🟡 (mixed)
**Outcome**: Probed 6 of 13 plugins to assess Phase 2 baseline:

| Program | HTTP | Status | Notes |
|---|---|---|---|
| VS_FLYING_CLUB | 200 | ✅ working | Returns real rows JFK→LHR (verified this session) |
| AS_MILEAGEPLAN | **500** | ❌ broken | Uncaught exception in write_results or _serialize (plugin has inner try/except, can't be plugin code) |
| AC_AEROPLAN | 200 | 🟡 empty | 128b response = empty rows (silent failure) |
| DL_SKYMILES | **502** | ❌ broken | Plugin raises uncaught exception |
| UA_MP | 200 | 🟡 empty | 122b response = empty rows |
| NH_ANA | 200 | 🟡 empty | 123b response = empty rows, fast (0.15s) — likely never hits upstream |

Added `/diag/run_plugin` endpoint (commit 9aeda52) — runs plugin in isolation, captures traceback, serializes rows individually so we pinpoint where the failure is (plugin scrape vs DB write vs row serialize). Probing AS + DL now via this endpoint.

## 2026-05-19 19:15 — AA escalated to blockers.md, pivot to Phase 2
**Status**: 🟡
**Outcome**: AA's 7 transport iterations exhausted free options. Written to `tasks/blockers.md` with 6 suggested next experiments needing user authorization (BD Web Unlocker first; ASN/state targeting; alternative providers; Hyper Solutions; api.aa.com probe). User reviews when ready.

Phase 2 work now in priority order:
1. Fix AS_MILEAGEPLAN 500 (diag in flight) — needed since it's a "presumed working" anchor
2. Fix DL_SKYMILES 502 — same diag
3. Diagnose AC/UA/NH empty-rows (separate diag endpoints per plugin)
4. Build JetBlue plugin (T2 — easiest new program per Phase 0 rubric)
5. Move down rubric priority list

**Spent**: ~5 MB BD, ~$0.04, ~0 IPRoyal (presume), ~0 commercial

## 2026-05-19 19:30 — End-of-session summary
**Status**: 🟡 (substantial progress; AA blocked on commercial spend authorization)

### What landed this session
- ✅ Plan v2 written + approved (`/root/.claude/plans/knowing-everything-you-know-warm-bunny.md`)
- ✅ BD Residential zone created by user + secret set on Fly
- ✅ Phase 0 complete (8 parallel research subagents → `tasks/scraper-rubric.md` + 8 research files in `tasks/scraper-research/`)
- ✅ Camoufox + BD Residential infrastructure (commit f5e7bef, 30849cb, 924ac63, 485de86, 84f2bfd, f29a135)
- ✅ AA plugin rewritten from form-fill → Sekinal cookie-mint + curl_cffi pattern (commits 587d4a6 → cc84f1e → 924ac63 → 485de86)
- ✅ AA blocker written to `tasks/blockers.md` after 7 failed iterations
- ✅ Phase 2 plugin probe sweep (1 working / 4 silent-fail / 1 hard-500)
- ✅ `/diag/run_plugin` endpoint added (commit 9aeda52) for isolated plugin debugging

### What's open
- **AA**: 7 iterations exhausted free options. `_abck` won't reach `~0~` from BD Residential US IPs. Next experiments documented in `tasks/blockers.md` need user authorization (BD Web Unlocker, ASN/state targeting, alternative providers, Hyper Solutions, api.aa.com probe).
- **AS_MILEAGEPLAN**: Hard HTTP 500 (uncaught exception). `/diag/run_plugin` deploy pending propagation.
- **DL_SKYMILES**: HTTP 502 (plugin raises). Same diag needed.
- **AC/UA/NH**: 200 with empty rows (silent failure). Need per-plugin diag.
- **Phase 2.5 (T5' user-auth-capture)**: Not started. Major piece of work blocked on AC Aeroplan unlock.
- **Phase 3 (10 new programs)**: Not started.

### What's working now
- VS_FLYING_CLUB ✅ (verified end-to-end this session)
- Worker /health, /diag/aa_last, /diag/airline ✅

### Total spend
- Bright Data: ~5 MB (~$0.04)
- Commercial APIs: $0
- IPRoyal: presumed ~$0 (small smoke probes)

### Re-engagement points for user (in priority order)
1. **Read `tasks/blockers.md`** and authorize an AA experiment (or accept AA staying blocked until later)
2. **Wait for `/diag/run_plugin` deploy** then re-probe AS/DL to see the actual exceptions — should self-resolve once GH Action completes
3. **Confirm Phase 2.5 priority** — should we start the auth-capture frontend work in parallel with broken-plugin fixes, or defer until more plugins are working?
4. **JetBlue plugin** — could be built next as the "easiest Phase 3" target while AA and others stall


## 2026-05-19 21:30 — AS fix confirmed + 3 agents complete
**Status**: ✅ (substantial progress)

**AS_MILEAGEPLAN flipped to ✅** — /search returns 5 rows for SEA→LAX 2026-08-15. Aircraft FK violation handled via savepoint retry; 7M9 (737 MAX 9) rows now insert with aircraft_icao=NULL gracefully. Long-term: migration to drop FK queued (auto-applies on merge to main).

Phase 2.5 backend + frontend BOTH landed via 3 parallel agents (commits a5f537a, c6448b3, plus WIP 6904433, d6f1dd8, 5161e66, 3f28e80):

- **Agent A (BD Web Unlocker)**: `common/bd_wu.py` + `aa_aadvantage/search_wu.py` + tests. Wired as `AA_AADVANTAGE_WU` plugin + `/diag/aa_wu_last`. Waits for user to set `BRIGHTDATA_WU_TOKEN` + `BRIGHTDATA_WU_ZONE` Fly secrets.
- **Agent B (Phase 2.5 backend)**: Vault-encrypted `program_auth_sessions` table with 5 live-tested invariants, `common/auth_session.py`, `auth/capture.py` with /start/status/finalize + 13-program registration. Live-view URL question still open — 3 candidate approaches in `tasks/scraper-research/phase-2-5-live-view-research.md`.
- **Agent C (Phase 2.5 cockpit)**: `src/app/airlines/page.tsx` + `ConnectAirlineModal.tsx` + `src/lib/api/auth.ts` + 4 Next.js proxy routes. HIG-compliant. pnpm typecheck/lint/build/test all pass. Stack-discovery: project is Next.js 16 App Router (not Vite + React Router as CLAUDE.md preamble suggested). Adapted to actual stack.

Working state summary:
| Program | HTTP | Status |
|---|---|---|
| VS_FLYING_CLUB | 200 | ✅ working |
| AS_MILEAGEPLAN | 200 | ✅ **NEW** |
| AC_AEROPLAN | 200 | 🟡 empty (silent fail, needs investigation) |
| DL_SKYMILES | timeout | ❌ slow/flagged (BD Browser API) |
| UA_MP | 200 | 🟡 empty (silent fail) |
| NH_ANA | 200 | 🟡 empty (silent fail) |
| AA_AADVANTAGE | rows=[] | 🔴 BLOCKED on Akamai (see blockers.md) |
| AA_AADVANTAGE_WU | — | 🚀 awaiting WU Fly secrets |

User action items:
1. Add Fly secrets `BRIGHTDATA_WU_TOKEN` + `BRIGHTDATA_WU_ZONE` for the WU variant test
2. Decide on the live-view URL approach (see Agent B's research doc)
3. Wire Clerk auth into the `/airlines` page (Agent C deferred — Clerk shell exists but isn't wired)

Next foreground work: AC, UA, NH empty-rows investigation via /diag/run_plugin.
