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

## 2026-05-19 21:40 — Phase 2 diagnostics complete; user action required
**Status**: 🟡 (substantial progress; 3 user actions queued)

**Phase 2 plugin failure modes confirmed**:
| Plugin | Failure | Path forward |
|---|---|---|
| AC_AEROPLAN | HTTP 403 "Access Denied" (Akamai) — confirms March-2025 login wall | T5' user-auth-capture (Phase 2.5) |
| UA_MP | Page.goto Timeout 60s — Akamai TLS RST | T4 (Camoufox+BDR) + T5' |
| NH_ANA | row_count:0 via diag — likely login-required + aswbe-i Akamai | T4 + possibly T5' |
| DL_SKYMILES | row_count:0 via diag (used to 502, now 0 rows) — Akamai single-tier | T4 (Camoufox+BDR) |
| AA_AADVANTAGE | Akamai _abck stuck at ~-1~ from BD Residential | T6 WU (test pending secrets) or T5' |
| AA_AADVANTAGE_WU | Awaiting BRIGHTDATA_WU_TOKEN + BRIGHTDATA_WU_ZONE Fly secrets | User action |

**The pattern is consistent**: 5 plugins are blocked at Akamai's bot defense. The fixes split two ways:
1. **T6 BD Web Unlocker** — handles bot defense server-side (untested for AA, will test once secrets land). If it works for AA, it likely unlocks DL + NH too (similar Akamai single-tier).
2. **T5' user-auth-capture** — for programs that require login (AC, UA, BA, AF, LH, etc.). Phase 2.5 backend + frontend are now LANDED but blocked on the live-view URL question.

**User action items (3 to unblock major progress)**:
1. **Set Fly secrets** `BRIGHTDATA_WU_TOKEN` + `BRIGHTDATA_WU_ZONE` (1 min) → unblocks WU test for AA, DL, NH
2. **Resolve live-view URL question** — read `tasks/scraper-research/phase-2-5-live-view-research.md`; choose between 3 BD-native approaches OR commission worker-side screenshot streaming (1-2h to research / decide)
3. **Wire Clerk auth** into `/airlines` page (Agent C deferred; needs Clerk shell completed)

**Final working state** (this session brought us from 2/13 → 2/13 working but with EVERYTHING else now diagnosed + infrastructure ready):
- ✅ VS_FLYING_CLUB (httpx, anonymous)
- ✅ AS_MILEAGEPLAN (httpx, anonymous, FK fix applied)
- 🚀 AA_AADVANTAGE_WU (wired, awaiting WU secrets)
- 🟡 5 plugins diagnosed (AC/UA/NH/DL/AA need T4/T5'/T6 migration)
- 🟡 5 plugins not yet probed (BA/AV/AF/TK/CX/LH)
- 🚀 Phase 2.5 backend + frontend landed end-to-end (DB, encryption, /auth/* routes, cockpit /airlines page); awaiting live-view URL decision to go live

**Total session spend**: ~$0.04 BD, $0 commercial, $0 IPRoyal. Substantial code progress.

**Re-engagement priority order**:
1. Set BD WU Fly secrets → test AA_AADVANTAGE_WU → if works, build same pattern for DL/NH/QR/CX/etc.
2. Decide on live-view URL approach → end-to-end test Phase 2.5 with AC Aeroplan
3. Wire Clerk auth so the /airlines page can identify users

## 2026-05-19 22:00 — All 4 strategies launched in parallel
**Status**: 🚀 (3 streams running)
**Outcome**: User authorized "try all strategies". Running 3 parallel streams covering all 4:
- **Stream 1 (Strategy A + B, me)**: WU secrets set via one-shot GH Action (commit 394e76d). Testing AA_AADVANTAGE_WU now. A = WU rollout; B = Camoufox+BDR per-plugin fallback where WU fails.
- **Stream 2 (Strategy C, agent)**: Build B6 JetBlue plugin. JetBlue is Fastly-only (lightest defense). Agent investigating the live jbrest.jetblue.com endpoint + transport.
- **Stream 3 (Strategy D, agent)**: Lift 60-day cap. Central `common/program_windows.py` registry + `/programs/meta` endpoint + cockpit calendar date-bounds.

WU secrets: BRIGHTDATA_WU_TOKEN + BRIGHTDATA_WU_ZONE=pointsnap_webunlock set via flyctl in the one-shot workflow. User confirmed BRIGHTDATA_WSS_URL already on Fly (Browser API zone `pointsnap`, $4 spent, 507MB used).

**Spent**: ~$0.04 BD so far. WU rate $1.50/CPM, $102 balance available.
**Next**: read AA_AADVANTAGE_WU test; if rows>0 → roll WU out to DL/NH/CX/QR/etc; delete one-shot workflow; if WU fails → Strategy B (Camoufox+BDR) for the Akamai-single-tier carriers

## 2026-05-20 18:00 — Strategies C + D complete; WU diagnosis; deploy backlog
**Status**: 🟡 (deploy catching up)

**Strategy C (JetBlue) ✅** — agent found the CURRENT endpoint (awardwiz's was dead). `POST jbrest.jetblue.com/bff/bff-service/bestFares/` via plain httpx, no proxy/browser. Verified live: JFK-LAX 2026-08-15 = 16,300 pts / 6 seats / $6 tax. Per-month award calendar, Y-cabin only (no Mint, no flight-level detail — mirrors VS calendar shape). Plugin = `b6_jetblue/`, committed aa71683.

**Strategy D (60-day cap) ✅** — `common/program_windows.py` registry (28 programs, window numbers cross-checked vs AwardFares/AwardWallet — 11 corrected). `/programs/meta` endpoint. Cockpit `search-form.tsx` date input now has min/max bounds. The 60-day cap is GONE — calendar allows up to 360 days. Date-sweep correctly NOT built (no plugin has a confirmed page-window cap; VS uses month-calendar, AS is single-date SSR).

**Strategy A (WU) — key finding**: Web Unlocker bypasses Akamai (wu_status 200, AA's API responds) BUT AA returns `error 309` = no session. WU needs a 2-step flow: GET homepage to mint session → POST API with cookies. Added `/diag/wu_probe` + `wu_request_json()` (format=json to get Set-Cookie headers back) to design the flow.

**Deploy backlog**: ~10 commits pushed in quick succession by 3 agents + parent. The deploy-workers.yml workflow has `cancel-in-progress: true`, so each push cancelled the running deploy → none completed. B6/`/programs/meta`/`/diag/wu_probe` not live yet. Pushes have now stopped; the aa71683-triggered deploy should complete. Retest in flight (bbm9f50kg).

**Follow-up flagged by JetBlue agent**: VS plugin returns `flight_number="CAL"` where tests expect `"3"` — VS parser drift. VS still returns rows so non-critical, but the flight_number field mapping is wrong. Queue for a fix.

Working state: VS ✅, AS ✅, B6 ✅ (pending deploy verify) = 3 plugins. AA still blocked (WU 2-step flow needed). 60-day cap lifted. Phase 2.5 backend+frontend landed.

**Spent**: ~$0.05 BD + ~1 WU request (~$0.0015).

## 2026-05-20 18:20 — WU multi-site probe: Strategy A validated
**Status**: ✅ (WU works for DL + CX; AA needs a render-wait override)

WU `format=json` probe results:
- **AA** — 502, `x-brd-error: waiting for selector "#weeklyCarousel" failed: timeout 90000ms` (`expect_element`). WU's per-site readiness check waits for AA's homepage carousel; Akamai challenge prevents it rendering. Fixable via WU wait-config, NOT a hard block.
- **DL delta.com** — ✅ 200, full Set-Cookie (AKA_A2, bm_ss, bm_mi, akaalb_*, Homepage, location)
- **CX cathaypacific.com** — ✅ 200, full Set-Cookie (bm_mi, bm_s)
- **example.com** — ✅ 200 (control)

**Conclusion**: WU bypasses Akamai for normal airline homepages (DL, CX confirmed). AA's homepage specifically chokes WU's render-readiness selector. Strategy A (WU rollout) is viable for the Akamai-single-tier carriers.

Path forward:
1. Build a generic WU 2-step transport (GET homepage → extract Set-Cookie → POST/GET award API with cookies)
2. Roll out to DL, CX first (WU-confirmed), then probe + roll out to NH/BA/AV/AF/LH/TK/UA
3. AA: override WU's `#weeklyCarousel` wait — try a non-homepage entry URL, or a WU request param to relax the element-wait

**Spent**: ~$0.06 BD (~6 WU requests at $1.5/CPM + smoke probes)

## 2026-05-20 19:00 — DL proof: WU 2-step disproven for DL; per-airline reality
**Status**: 🟡 (strategy refined)

**DL proof agent finding**: the WU 2-step (homepage GET → cookies → API POST) does NOT work for DL. Delta's Akamai BMP **edge-rejects POST** to `/shop/ow/search` (HTTP 444 Access Denied) regardless of cookies/format/body. WU clears GET (200 + real JSON error envelope) but POST is edge-blocked. Confirmed: `POST httpbin.org/post` via WU works fine → the 444 is Delta's Akamai, not WU.

**Crucial nuance — airlines fail DIFFERENTLY**:
- **DL**: award API EDGE-BLOCKS the WU POST (Akamai 444). WU 2-step dead for DL.
- **AA**: award API ACCEPTS the WU POST — returns app-level `error 309` ("no session"), a softer failure. AA's WU 2-step is still viable IF we can mint the session.

So there is no single silver bullet. Each Akamai airline's award endpoint either edge-blocks POST (needs in-page rendering) or accepts it (WU 2-step can work with the right session). Per-airline investigation required.

**Refined options for the ~10 Akamai airlines**:
1. **WU renders the RESULTS page directly** (untested) — single WU call loads the SPA results URL; the SPA fires its own award POST from INSIDE WU's Akamai-cleared browser session (not edge-blocked since it's same-session); results render to DOM; parse the HTML. Different from WU 2-step.
2. **T5' user-auth-capture** — Phase 2.5 infra is built; reliable but needs the user to log into each airline + the live-view URL question resolved.
3. Per-airline bespoke transport.

DL plugin rewritten to WU 2-step + documented as Akamai-walled (returns [] gracefully). AA WU agent still running — its result (does AA's softer 309 failure yield to a minted session?) shapes the rollout.

**Spent**: ~$0.10 BD (~10 WU requests + probes).

## 2026-05-20 19:20 — "Both in parallel": 5 agents dispatched
**Status**: 🚀 (5 streams running)
User chose to run the WU per-airline grind AND T5' auth-capture simultaneously.

Agents in flight:
- **AA** (`a2f51830`) — BD Browser API mint hedge for AA_AADVANTAGE_WU (mints spa_session_id via a real browser, sidesteps the WU zone Manual-Expect block)
- **WU W1** (`a38a6875`) — DL, CX, NH WU transport
- **WU W2** (`ae769d0c`) — UA, BA, AC WU transport
- **WU W3** (`a2edc65c`) — AF, LH, TK WU transport
- **T5'** (`ac4be0e7`) — resolve live-view URL, complete auth-capture end-to-end, AC proof

Coordination: each agent owns disjoint files (its own `python-workers/<plugin>/` dirs, or the `auth/`+cockpit subsystem). WU-grind agents investigate via `/diag/wu_probe` (no deploy) and commit code without deploy-testing — parent does one consolidated deploy + test.

Per-airline classification each WU agent produces: Pattern A (WU 2-step, API accepts POST), Pattern B (WU in-page render, API edge-blocks POST), or auth_required (login-gated → routes to T5').

**Spent so far**: ~$0.12 BD. 3 plugins live (VS/AS/B6), 60-day cap lifted, Phase 2.5 infra built.
