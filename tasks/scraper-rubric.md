# PointSnap Scraper Transport Rubric

**Phase 0 output.** Per-airline transport recommendation derived from 8 parallel research agents. Drives every transport decision in Phases 1-3.

> **Status: 6 of 8 agents complete as of 2026-05-19 17:30.** Pending: Agent 4 (mobile API mapping) + Agent 6 (community knowledge). Rubric will be refined when those land.

## Transport tiers

| Code | Transport | Cost/req | Notes |
|---|---|---|---|
| T0 | `httpx` direct | $0 | Plain JSON API, no bot wall |
| T1 | `httpx` + IPRoyal residential | ~$0.0005 | IP-reputation gate but otherwise open |
| T2 | `curl_cffi impersonate=firefox135` | ~$0.0005 | TLS/JA3 fingerprint gate; no JS execution needed |
| T3 | Camoufox + Fly egress (Sekinal recipe) | ~$0.001 | Akamai BMP single-tier; cookie-mint pattern. **AA verified 2026-05-19** |
| T4 | Camoufox + BD Residential (country-targeted, sticky) | ~$0.005 @ $8/GB | Akamai BMP tight, DataDome, hard walls. **SSL/MITM issue still open** |
| T5' | User-initiated auth capture (cookie replay) | ~$0.001 | Login-required + MFA-gated (Phase 2.5). **20/23 programs require this** |
| T6 | Mobile API endpoint | ~$0.001 | Web hard-walled but mobile is open (EK, QR, NH confirmed) |
| T7 | Commercial fallback (seats.aero only) | $0.30-1.00 | **Only seats.aero returns award prices**; user rejected at $9.99/mo retail |
| T8 | Partner-airline backdoor (cross-check only) | varies | Triangulation, never primary |

## Per-airline rubric (Phase 0 confirmed)

| Program | Domain | Bot defense | Primary T | Secondary T | Auth req'd? | Mobile path | T5' priority | Notes |
|---|---|---|---|---|---|---|---|---|
| **VS_FLYING_CLUB** | virginatlantic.com | Akamai single-tier | T0 ✅ | T1 | required | m.virginatlantic.com 200 | **high** | **WORKING via httpx** (60 cookies leak feature flags). T5' will unlock award search per Agent 5. |
| **AS_MILEAGEPLAN** | alaskaair.com | Akamai light (no _abck cold) | T0 ✅ | T1 | optional | m.alaskaair.com 301 | low | **WORKING via httpx**. One of 3 anonymous-OK programs. |
| **AA_AADVANTAGE** | aa.com | Akamai BMP single-tier | T3 | T4 | email OTP | mobile.aa.com 403, **api.aa.com 200 with `x-api-key` CORS** | medium | **Sekinal pattern verified.** Camoufox loads homepage 200. Deep-link `/booking/search?slices=...` + XHR capture pattern. api.aa.com is a soft underbelly worth deeper probe. |
| **AC_AEROPLAN** | aircanada.com | Akamai BMP single-tier | T5' | T3 | **REQUIRED (March-2025 wall)** | mobile 404 | **CRITICAL** | **The linchpin for T5'.** AC built login wall specifically to stop scrapers. No anonymous path. |
| **DL_SKYMILES** | delta.com | Akamai BMP single-tier | T3 | T4 | required + SMS/push | api.delta.com 301 (real redirect), /api/graphql 403 (real endpoint) | high | Real GraphQL endpoint exists. Worth deeper probe. |
| **UA_MP** | united.com | Akamai BMP tight (TLS RST) | T4 | T7 | required + security Q | All subs 000/503 | high | Toughest US carrier. Residential + Camoufox required. |
| **BA_AVIOS** | britishairways.com | Akamai BMP tight (sensor.js timing wall) | T4 | T6 | required + TOTP | All subs 000 | medium | Connects + receives NewSessionTickets, then hangs. Classic AA-style behavioral wait. |
| **AF_FLYINGBLUE** | flyingblue.com | Akamai BMP tight (TLS RST) | T4 | T6 | required + SMS | All subs 0 | high | KLM/AF stack drops handshake from datacenter IPs. Residential + JA3 spoof required. |
| **LH_MILES_MORE** | miles-and-more.com | **Cloudflare Turnstile** | T3 | T2 | required + SMS | All subs 503 | high | Different vendor: Cloudflare not Akamai. Solver-friendly. CSP locks to `challenges.cloudflare.com`. |
| **TK_MILES_SMILES** | turkishairlines.com | Akamai BMP tight (TLS RST) | T4 | T6 | required + SMS | api 503 | high | AS-level filtering from datacenter IPs. |
| **NH_ANA** | ana.co.jp | Akamai BMP lighter policy | T3 | T6 | required + SMS | **booking.ana.co.jp 200** | medium | Real award-booking host on mobile-style subdomain. Lighter policy. |
| **CX_CATHAY** | cathaypacific.com | Akamai BMP single-tier | T3 | T4 | required + SMS | api 404 (only 54 bytes) | medium | Homepage open; SPA behind stricter Akamai policy. |
| **AV_LIFEMILES** | lifemiles.com | Akamai BMP single-tier | T4 | T2 | required + multi-method | api 403, others 000 | medium | Tight; only 371-byte challenge stub on cold curl. |
| **AM_CLUB_PREMIER** | aeromexico.com | Akamai light (no _abck cold) | T2 | T1 | optional | m.aeromexico.com 503 | low | **One of 3 anonymous-OK programs.** No `_abck`. Permissive CSP. |
| **AD_AZUL_TUDOAZUL** | voeazul.com.br | Akamai light | T4 | T2 | required + SMS | All 000 | medium | Brazilian; pair with BD `-country-br`. |
| **CM_CONNECTMILES** | copaair.com | **Imperva (Incapsula)** | T3 | T4 | required + SMS | mobile 503, api 403 | medium | `X-Iinfo` header confirms Imperva. CSP includes DataDome refs (chained?). |
| **EK_SKYWARDS** | emirates.com | Akamai BMP single-tier | T6 (mobile) | T3 | required + SMS | **mobile.emirates.com 705 KB full site** | medium | **Best mobile-endpoint exposure.** `ekbot` cookie is their own bot signal. |
| **ET_SHEBAMILES** | ethiopianairlines.com | Akamai light + Azure | T1 | T3 | required + SMS | booking.ethiopianairlines.com 200 | low | **Lightest Akamai posture of African/MEA group.** Azure origin leaks `x-ms-routing-name`. |
| **EY_GUEST** | etihad.com | Akamai/Imperva TLS RST (108b stub ≠ Akamai 85b) | T4 | T6 | optional | All 000, booking.etihad.com 301 | low | **One of 3 anonymous-OK programs.** Different upstream WAF (108b vs Akamai's 85b). |
| **SK_EUROBONUS** | flysas.com | **Cloudflare Turnstile** | T3 | T2 | required + SMS | All 0 to 503 | medium | Like LH: Cloudflare not Akamai. Solver-friendly. |
| **AY_FINNAIR_PLUS** | finnair.com | Akamai BMP + custom origin | T4 | T2 | required + SMS | m.finnair.com 302 | medium | Tight CSP. Use BD `-country-fi`. |
| **B6_TRUEBLUE** | jetblue.com | **Fastly Varnish only** | T0 | T1 | required + SMS | booking.jetblue.com 200 | low | **EASIEST TARGET in the dataset.** Bare Varnish, no Akamai/Cloudflare/Imperva. Only cookie: `jbCountryCode`. |
| **QF_FF** | qantas.com | Akamai BMP single-tier | T3 | T4 | partial (anon = partial Classic only) | m.qantas.com 301 | medium | Lighter than UA/AA. Anonymous works for partial Classic Reward. |
| **QR_PRIVILEGE** | qatarairways.com | Akamai BMP tight (TLS RST) | T6 (mobile) | T4 | required + SMS | **m.qatarairways.com 200** | medium | www is brick-walled but mobile serves 200 stub. |
| **SV_ALFURSAN** | saudia.com | **Imperva (Incapsula)** | T3 | T4 | required + SMS on every login | mobile.saudia.com 200 | low | Imperva ABP. SMS on every login = painful. |
| **SQ_KRISFLYER** | singaporeair.com | Akamai BMP single-tier | T3 | T4 | required + SMS | m.singaporeair.com 301 | medium | Akamai SAA bundle (named in their own cookies). |
| **G3_GOL_SMILES** | voegol.com.br | Akamai BMP + Liferay | T4 | T2 | required + SMS | All subs 0 | medium | Brazilian; uses Akamai over Liferay portal. |
| **VA_VELOCITY** | virginaustralia.com | Akamai BMP single-tier | T3 | T4 | required + SMS | mobile 301 | medium | Standard Akamai single-tier. /graphql redirects (not 404) — worth probe. |

## Vendor roll-up (Agent 3)

| Vendor | Carriers | Count |
|---|---|---|
| Akamai BMP tight (TLS RST from sandbox) | flyingblue, turkishairlines, united, qatarairways, britishairways, etihad | 6 |
| Akamai BMP single-tier (homepage open, API blocked) | aa, aircanada, cathaypacific, delta, ana, virginatlantic, emirates, ethiopianairlines, finnair, qantas, singaporeair, voegol, virginaustralia, lifemiles | 14 |
| Akamai light (no `_abck` on cold) | alaskaair, aeromexico, voeazul | 3 |
| Cloudflare Turnstile | miles-and-more, flysas | 2 |
| Imperva (Incapsula) | copaair, saudia | 2 |
| Fastly Varnish only | jetblue | 1 |

## Auth-required roll-up (Agent 5)

- **Required + MFA (20)**: AC, AF/KL, AV, BA, CX, DL, LH, NH, TK, UA, VS, AD, CM, EK, ET, SK, AY, B6, QR, SV, SQ, G3, VA
- **Partial (1)**: QF (anonymous = partial Classic Reward only)
- **Anonymous OK (3)**: AS Mileage Plan, AM Aeromexico, EY Etihad Guest
- **AA**: anonymous OK for award search; account login optional (email OTP only — no SMS)

## Country-geo map (for BD Residential `-country-XX`)

Used by `_brightdata_residential_proxy(country=...)`:

| Airline(s) | Country code |
|---|---|
| AA, AS, B6, UA, DL | `us` |
| AC | `ca` |
| BA, VS | `gb` |
| AF/KL | `fr` (or `nl`) |
| LH | `de` |
| TK | `tr` |
| NH | `jp` |
| CX | `hk` |
| AV | `co` |
| AM | `mx` |
| AD, G3 | `br` |
| CM | `pa` |
| EK, EY | `ae` |
| ET | `et` |
| SK | `se` |
| AY | `fi` |
| QF, VA | `au` |
| QR | `qa` |
| SV | `sa` |
| SQ | `sg` |

## Implementation priority (Phase 1 → 3)

**Phase 1 (AA)**: Sekinal recipe — Camoufox loads `/booking/search?slices=[...]` deep-link → XHR captures `/booking/api/search/itinerary` response → existing `_parse_xhr` parses. **No proxy needed** (Sekinal pattern; Fly egress works).

**Phase 2 priority order** (easiest first, builds momentum + validates T-tier rubric):
1. **B6 JetBlue** (T0 — easiest in dataset; bare Varnish) — PROVE T0 path works
2. **AS Alaska** (already working, T0) — verify existing implementation still good
3. **VS Virgin Atlantic** (already working, T0) — verify
4. **AA AAdvantage** (T3) — Phase 1 outcome
5. **AM Aeromexico** (T2) — light Akamai, anonymous-OK
6. **ET Ethiopian** (T1) — lightest Akamai
7. **NH ANA** (T3) — booking.ana.co.jp lighter policy
8. **CX Cathay** (T3) — single-tier
9. **QF Qantas** (T3) — partial anon path
10. **SQ Singapore** (T3) — standard single-tier
11. **G3 GOL** (T4) — Brazilian; needs `-country-br`
12. **VA Velocity** (T3) — standard single-tier
13. **AD Azul** (T4) — Brazilian
14. **EK Emirates** (T6 mobile) — `mobile.emirates.com` is the entry
15. **AV LifeMiles** (T4) — tight single-tier
16. **DL SkyMiles** (T3) — has real /api/graphql
17. **CM Copa** (T3 Imperva)
18. **SV Saudia** (T3 Imperva)
19. **LH M&M** (T3 Cloudflare Turnstile)
20. **SK EuroBonus** (T3 Cloudflare Turnstile)
21. **AY Finnair** (T4)
22. **AF/KL Flying Blue** (T4 TLS RST)
23. **TK Turkish** (T4 TLS RST)
24. **BA Avios** (T4 — behavioral wait)
25. **QR Qatar** (T6 mobile — m.qatarairways.com)
26. **EY Etihad** (T4)
27. **UA MileagePlus** (T4 — toughest US)

**Phase 2.5 priority (T5' user-auth-capture)**, parallel with Phase 2:
1. **AC Aeroplan** — the reason T5' exists; non-negotiable
2. **UA MileagePlus** — security questions (simplest modal flow, no SMS)
3. **LH M&M + SK EuroBonus** — possibly one capture unlocks both (Star Alliance TravelID)
4. Then iterate

**Phase 3 (new programs)**: Most are already covered above (we have 28-airline rubric; existing 13 + 15 net-new).

**Phase 4 (lift 60-day cap)**: Most plugins enforce the cap at the API layer (per Agent 2 — Apify's structural cap). T5' authenticated sessions are the primary mechanism for past-60-day queries.

## Notes on commercial / T7

- Only **seats.aero** returns award prices (Agent 7). User rejected at $9.99/mo retail.
- Commercial T7 fallback is effectively empty for award search.
- **Resilience must come from scraping-stack diversity**: Camoufox + sensor-data services (Hypersolutions for Akamai) + Imperva-specific solvers for UA + multi-IP proxy pools + partner cross-checks (Agent 8).

## Notes on partner cross-checks (Agent 8 — T8)

- **Aeroplan + (BA Avios + Asia Miles)** = the two strongest cross-check clusters (ROI per scrape).
- 5 airlines have NO good cross-check: KE, DL own-metal pricing, GA, AS as operating carrier, TK.
- Tag matrix cells `existence_only` vs `price_capable` — AF/KL/DL via SkyTeam are existence-only.
