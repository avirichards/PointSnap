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
