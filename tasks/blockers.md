# PointSnap Scraper Recovery — Execution Blockers

Append-only escalation log. **If this file is empty, nothing needs human input.**

When an agent hits a blocker it can't resolve via the rules in the plan's "Failure handling decision tree," it appends here. The user reads this file when checking back; agents read this file before retrying a previously-blocked task.

Format:
```
## YYYY-MM-DD HH:MM — <plugin or task>
**Blocker**: <one sentence>
**Attempted**: <list of tiers + verbatim errors>
**Suggested next**: <2-3 concrete experiments user can authorize>
**Cost so far**: <BD spend $X, commercial spend $Y>
```

---

<!-- Active blockers below. Most recent at bottom. -->

## 2026-05-19 19:05 — AA_AADVANTAGE — Sekinal pattern stalled at cookie mint

**Blocker**: AA's Akamai BMP refuses to issue AA-app cookies (XSRF-TOKEN, spa_session_id) from BD Residential US IPs. `_abck` stays at `~-1~` (untrusted) for 120s+ wait. Without those cookies, the curl_cffi API replay can't authenticate `/booking/api/search/itinerary`.

**Attempted (all from this session 2026-05-19, verbatim verdicts in scraper-log.md)**:
1. T3 Camoufox + Fly egress + form-fill (pre-Phase-0) — `challenge_unresolved`
2. T3 Camoufox + Fly egress + Sekinal deep-link XHR-capture (30s wait) — `xhr_timeout`
3. T3 Camoufox + Fly egress + Sekinal deep-link (90s wait + mouse motion) — `xhr_timeout` × 3, `_abck=~-1~` throughout
4. T4 Camoufox + BD Residential US + homepage→deep-link — SEC_ERROR_UNKNOWN_ISSUER on 2nd goto (BD MITM cert state contamination)
5. T4 Camoufox + BD Residential US + deep-link only — Akamai visible BMP challenge interstitial (`sec-if-cpt-container`, tile-puzzle UI)
6. T4 Camoufox + BD Residential US + homepage + cookie-mint + curl_cffi replay (60s wait) — `no_cookies`
7. Same as #6 with 120s wait — `no_cookies`, `_abck=~-1~`, no XSRF-TOKEN or spa_session_id minted

**Diagnosis**: BD Residential US IP pool is Akamai-flagged for AA. `_abck` minting stops at `~-1~` regardless of wait time. AA's app cookies (XSRF-TOKEN, spa_session_id) are gated behind sensor.js scoring requiring `_abck=~0~`. Sekinal claims their Camoufox setup works without proxy, suggesting they run from a real residential ISP (clean IP reputation).

**Suggested next experiments — need user authorization for any commercial spend**:
1. **BD Web Unlocker** (different BD product, the user-configured WU API from earlier session) — handles bot defense server-side, returns clean HTML/JSON. Not yet wired into the worker; would need a new `common/bd_wu.py` helper. Estimated effort: 1-2 hours. **Recommended as lowest-friction next try.**
2. **BD ASN-targeting** (`-asn-7018` AT&T, `-asn-22773` Cox, etc.) — narrow to specific cleaner ISP subsets of BD's pool. Try US-AT&T (the geo test showed AT&T was the ASN, but no specific filter applied). Estimated effort: 30 min.
3. **BD state-targeting** (`-state-ny`, `-state-ca`, etc.) — larger regional pools might have less prior-scraper history. Estimated effort: 30 min.
4. **Alternative residential providers** (Smartproxy ~$8/GB, NetNut ISP ~$15/GB, SOAX ~$8/GB) — Akamai reputation varies by pool. Each is a new Fly secret + browser_page() branch. Estimated effort: 2-3 hours per provider.
5. **Hyper Solutions sensor-data SaaS** (~€100/mo per Phase 0 Agent 7) — Akamai BMP solver, delivers valid `_abck` via API. Defeats the gate that BD residential triggers. Most expensive but most reliable.
6. **`api.aa.com` direct probe** (Phase 0 Agent 3 + 4 finding) — HTTP/2 CORS gateway with `x-api-key` header. Undocumented routes might be lighter-defended. Estimated effort: 1-2 hours of API enumeration.

**Cost so far this session**: ~5 MB BD across smoke probes, ~$0.04. No commercial APIs touched.

**Recommended path**: Pivot AA to backlog. Move to Phase 2 (JetBlue, AS, VS) while AA waits for user authorization on which experiment to fund. Resume AA when authorized.

## 2026-05-20 19:00 — AA_AADVANTAGE_WU — WU 2-step blocked on a BD zone setting (1-click user fix)

**Blocker**: The WU two-step session-mint is built and working end-to-end EXCEPT it can only mint a `mobile.aa.com` cookie jar — which lacks `spa_session_id` — so AA's award API still returns error 309 ("no session"). Minting the SPA jar that *does* have `spa_session_id` requires WU to render a `www.aa.com` page, which is blocked by a Bright Data zone setting the user must toggle.

**What works now (verified on deployed worker, `claude/review-scraper-strategy-CXHmM`, commit 62bcc9d)**:
- `aa_aadvantage/search_wu.py` rewritten as a real 2-step flow: WU-GET an aa.com page to mint cookies → WU-POST `/booking/api/search/itinerary` with the jar.
- **WU CAN render `mobile.aa.com/booking`**: `wu_http_status:200`, `target_status:200`, 76 KB HTML, 15-cookie jar incl `XSRF-TOKEN`, `JSESSIONID`, `bm_s`, `bm_sz`, `AKA_A2`. Re-confirmed across 3 deployed runs.
- WU-POST to AA's award API reaches AA's backend cleanly: `wu_status:200`, `target_status:200`, AA's JSON returned. AA's Akamai permits the POST (unlike DL — see Session 12, DL's Akamai edge-rejects POST with 444).

**What's blocked (the two findings that stop it)**:
1. **WU cannot render any `www.aa.com` page.** WU applies a stale per-site render-readiness rule to the *entire* `www.aa.com` host — it waits for selector `#weeklyCarousel` (a homepage element AA's Akamai challenge prevents rendering), so every `www.aa.com/*` GET 502s after 90 s: `x-brd-error: waiting for selector "#weeklyCarousel" failed: timeout 90000ms exceeded`, `x-brd-error-code: expect_element`. Confirmed for `/`, `/booking/`, `/booking/find-flights`, `/booking/flights/choose-flights`, `/booking/flights/start.do`, `aileron-view`. (`/booking/api/search/dual/elementsConfig` got `reject_block` "captcha or protection page found" instead.)
2. **The fix for #1 — `x-unblock-expect` override — is disabled on the zone.** WU lets a caller override that selector wait by sending an `x-unblock-expect` header (e.g. `{"body": true}` to just wait for the page body). The code sends exactly that. WU rejects it: `wu_http_status:200`, `target_status:400`, `x-brd-error: "Manual expect is not enabled for this zone"`, `x-brd-error-code: feature_not_active`. The `pointsnap_webunlock` WU zone does not have the "Manual Expect" advanced feature enabled.
3. **AA's API does not bootstrap the session.** Tested whether AA's error-309 response *issues* the missing session cookie (POSTed via `format=json` to read AA's `Set-Cookie`). It does not — `api_set_cookie_names: []`, AA returns `{"error":"309",...,"slices":[]}` (95 bytes) and sets zero cookies. So `spa_session_id` cannot be "earned" from the API; it must come from a rendered SPA page.

Net: AA's award API needs `spa_session_id` (Sekinal names it + `XSRF-TOKEN` the two critical cookies — `agent-1-aa-oss-deep-dive.md`). `spa_session_id` is minted only by the `www.aa.com` booking SPA's bootstrap, and WU can't render `www.aa.com` because the override that would defeat the stale `#weeklyCarousel` wait is a disabled zone feature.

**Suggested next — #1 is a ~1-minute user action that likely unblocks everything**:
1. **Enable "Manual Expect" (a.k.a. custom `expect` element) on the `pointsnap_webunlock` WU zone** in the Bright Data dashboard → zone → Advanced settings / Custom Headers & Cookies. Once on, the code's existing `www_findflights` mint strategy (`x-unblock-expect: {"body": true}`) will let WU render `www.aa.com/booking/find-flights`, which should mint `spa_session_id`; the code already prefers that jar and folds it into the POST automatically — **no further code change needed**. Re-run `curl 'https://pointsnap-workers.fly.dev/search?program=AA_AADVANTAGE_WU&origin=JFK&dest=LAX&date=2026-08-15'` and check `/diag/aa_wu_last`: the `www_findflights` strategy should flip from `feature_not_active` to a real cookie jar. NB: enabling custom headers/cookies makes WU bill 100% of requests (success + failure) on that zone.
2. **If Manual Expect can't be enabled or still doesn't mint `spa_session_id`** (the SPA may set it via client-side JS, which WU's `format=json` Set-Cookie capture would miss): switch to BD **Browser API** (zone `pointsnap`, env `BRIGHTDATA_WSS_URL`) for the mint step only — a real headless browser runs the SPA's JS, so `spa_session_id` lands in `page.context.cookies()`. Then hand that jar to the existing WU POST. Effort: ~1-2 h, touches only `search_wu.py`.
3. **Ask BD support to fix the stale `#weeklyCarousel` rule for aa.com** — their per-site readiness check is years out of date (AA's homepage has no `#weeklyCarousel`). If BD updates it to a current selector, plain WU GET of `www.aa.com` pages would render with no override needed.

**Cost so far this session**: ~15-20 WU requests (mint probes + 3 deployed test searches) at $1.50/CPM ≈ $0.03. No commercial APIs.

**Code state**: `search_wu.py` is complete, instrumented (`/diag/aa_wu_last` shows every mint strategy + POST attempt forensically), and correct — it will start returning rows the moment the WU zone's Manual Expect setting is enabled OR the mint step is moved to Browser API. Nothing in the plugin is broken; it's purely blocked on the BD zone capability.

## 2026-05-20 19:40 — AA_AADVANTAGE_WU — BD Browser API mint rung built; mints `spa_session_id` but WU-replayed POST still gets 309

**Blocker**: Suggested-next #2 from the entry above is now built and deployed — the AA WU plugin has a BD Browser API mint rung that DOES mint `spa_session_id`. But `AA_AADVANTAGE_WU` still returns 0 rows: AA's award API answers error 309 ("no session") on the WU POST **even when the POST carries a real `spa_session_id` + `XSRF-TOKEN`**. The session a browser mints is not portable to a Web-Unlocker-replayed POST.

**What was built (commits `91d2d97`/`b1de16f` on `claude/review-scraper-strategy-CXHmM`)**:
- `aa_aadvantage/search_wu.py` gained rung B in the mint ladder: `_mint_via_browser_api()` / `_mint_browser_once()`. It opens `browser_page(use_brightdata=True)` (real headless Chromium on BD's farm, CDP, zone `pointsnap`), navigates `https://www.aa.com/booking/find-flights`, polls `page.context.cookies()` until BOTH `XSRF-TOKEN` and `spa_session_id` are present, exports the jar. Runs only when the WU-GET strategies fail to mint `spa_session_id` (gated to avoid burning Browser-API bandwidth). The existing ladder folds the jar into the WU award POST.

**What works (verified across ~6 deployed runs)**:
- **BD Browser API CAN render `www.aa.com/booking/find-flights`** — on a clean exit IP it returns HTTP 200 with the real "Book flights" SPA form (not Access Denied), final URL `/booking/search/find-flights`.
- **BD Browser API CAN mint `spa_session_id`** — a successful render yields a ~56-cookie jar with `XSRF-TOKEN` + `spa_session_id` + `JSESSIONID`. This was the open question from the entry above; answer: yes, a real browser's SPA bootstrap mints `spa_session_id` and it lands in `page.context.cookies()`.
- The mint ladder correctly selects the Browser API jar over the `mobile.aa.com` floor when it has `spa_session_id` (`minted_via: browser_api_findflights`, `spa_sid_present: true` in the POST diag).

**What's blocked (the two findings that stop it)**:
1. **AA's award API rejects the WU-replayed POST with error 309 even with a valid `spa_session_id`.** Run with `minted_via: browser_api_findflights`, `spa_sid_present: true`, `sent_xsrf: true` → AA returned `{"error":"309",...,"slices":[]}` (95 bytes), `api_new_cookie_names: []`. The session is minted by a BD **Browser API** Chromium on exit IP A; the award POST is replayed by BD **Web Unlocker** through a different exit IP B with a freshly WU-solved Akamai context. AA binds the session to the originating browser's Akamai `_abck` device + IP, so the cookie jar alone — even a complete one — does not satisfy `/booking/api/search/itinerary` from a different transport. `spa_session_id` is necessary but **not sufficient**; the request must also originate from the device/IP that minted it.
2. **BD Browser API's AA render success is probabilistic (~50%).** Per the Akamai BMP taxonomy (this file, "Akamai BMP response taxonomy"), AA hard-denies a large share of BD's exit pool. Observed: some runs all 3 Browser-API mint tries draw HTTP 403 Access Denied IPs (rung mints nothing, falls back to the `mobile.aa.com` 309 jar); other runs try 1 lands a clean IP and mints `spa_session_id`. The 3-try retry rides this out ~50% of the time — but see #1: even a *successful* mint still 309s on the POST, so more retries don't help.

Net: the BD Browser API rung solved exactly the problem it was scoped to solve (mint `spa_session_id`), but exposed a deeper truth — AA's session is **transport-bound**, not just cookie-bound. Handing a browser-minted jar to a separate WU POST cannot work for AA regardless of which cookies the jar has.

**Suggested next — the WU two-step is architecturally a dead end for AA; the search must happen *inside* the browser session**:
1. **Do the whole search inside the BD Browser API browser (in-page XHR capture), not WU-replay.** Instead of mint-jar → WU-POST, keep the search in the SAME Chromium session that minted `spa_session_id`: after `/booking/find-flights` renders, fill the origin/dest/date form (or navigate the SPA's search deep-link) and let the SPA fire `/booking/api/search/itinerary` itself, then capture the JSON via `page.on("response")`. This is the Sekinal pattern (`agent-1-aa-oss-deep-dive.md`) — the session, `_abck`, IP, and the API call all share one browser context, so no 309. Effort: ~2-4 h, a near-rewrite of `search_wu.py`'s step 2 (or a new `search.py` variant). Risk: BD Browser API's ~50% Akamai hard-deny rate caps reliability; needs retries. NB: the existing `search.py` already attempts an in-page-ish flow via Camoufox+BD-Residential — but that stalls at cookie mint (entry above). BD Browser API renders `find-flights` where Camoufox+BDR didn't, so a BD-Browser-API in-page search is genuinely a new, untried path.
2. **If BD Browser API in-page search is too unreliable (~50% deny)**: the Hyper Solutions Akamai BMP SaaS (~€100/mo, this file's references table) remains the only path that delivers a valid `_abck` to a plain HTTP client — which would let the curl_cffi replay in `search.py` authenticate. Most expensive, most reliable.
3. **Partner-site cross-check** (Alaska `alaskaair.com`, already working via the AS plugin) shows a subset of AA award inventory — not comprehensive, but a stopgap the user has previously declined as a replacement.

**Cost this session**: ~6 deployed `/search` runs (each: a few WU requests + up to 3 BD Browser API page loads, image/css/font-blocked). BD Browser API is bandwidth-billed; ~$0.05-0.15 total. No commercial APIs.
