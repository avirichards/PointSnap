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
