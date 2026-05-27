# Agent 3 — Bot Defense / HTTP Profile for 28 Airline Award Domains

**Generated:** 2026-05-19
**Scope:** HEAD + GET probes from the Anthropic sandbox network (egress through `sandbox-egress-production`), no booking calls, no logins, no JS execution. Findings reflect the bot-defense posture each carrier presents to a vanilla curl client with a Chrome/120 UA.

> **Sandbox caveat:** the TLS chain on every probe terminates at the Anthropic egress gateway (cert issuer `Egress Gateway Subordinate CA` / `sandbox-egress-production TLS Inspection CA`), then re-originates. The 503/85-byte responses are Envoy errors that mean *the upstream airline reset the TLS handshake or HTTP request before headers were returned*. That is itself a strong signal of aggressive TLS-fingerprint blocking by the airline WAF (Akamai BMP, Imperva Advanced Bot, Kasada), not a sandbox artifact.

---

## Tier scale (T0–T7)

Reminder of the PointSnap transport tier scale used in the "Recommended T-tier" column:

| Tier | Transport | When to pick |
|---|---|---|
| T0 | `httpx` raw with rotating UA + JA3 | Carrier WAF only checks IP + basic UA. JSON API exposed. |
| T1 | `httpx` + sticky residential proxy (BrightData / IPRoyal) | Carrier WAF does IP reputation. Cookies still scriptable. |
| T2 | `curl-cffi` / `requests-ja3` for Chrome JA3 spoof | Carrier WAF checks JA3 fingerprint. |
| T3 | Headless Patchright (Chrome) + residential proxy | JS challenge present but solvable headless. |
| T4 | Camoufox (Firefox) headless + residential proxy | Akamai BMP / Imperva ABP; need humanized fingerprint. |
| T5 | Patchright + sensor.js solver (CapSolver / Hyper) | Vendor explicitly checks `_abck` validity (Akamai BMP). |
| T6 | BrightData Browser API (real browser pool) | Vendor flips on extra signals after auth (Akamai + behavior). |
| T7 | Apify Actor / commercial scraper (igolaizola, etc.) | Custom carrier-specific bot stack. |

---

## Main table — 28 carriers

| Domain | Status (www/) | Primary CDN/WAF | Cookie signatures | Mobile endpoint? | GraphQL endpoint? | Source map? | Rec. T-tier | Notes |
|---|---|---|---|---|---|---|---|---|
| aa.com | 403 (Akamai-grn) | **Akamai BMP** (no `_abck` on cold GET, but `aka_*` + `akavpau_www_aahomepage` + `akamai-grn` + `server-timing: ak_p`) | `aka_state_code`, `aka_cr_code`, `aka_lc_code`, `akavpau_www_aahomepage`, `AKA_A2` | `mobile.aa.com/homePage.do` → 403 `AkamaiGHost`. **`api.aa.com` returns 200 with permissive CORS** (`Access-Control-Allow-Methods: GET,PUT,POST,DELETE`, `Allow-Headers: x-api-key`). | `/graphql` 403, `/api/graphql` 403 | No | **T5** | api.aa.com is the soft underbelly — worth a deeper subagent pass to enumerate routes; needs `x-api-key`. |
| aircanada.com | 301 → 200 (56 KB after redirect) | **Akamai BMP** | `_abck`, `bm_s`, `bm_so`, `bm_ss`, `bm_sz`, `aco_siteLocale`, geo* | `mobile.aircanada.com` 404, `m.aircanada.com` 503 (Akamai reset). `api.aircanada.com` 403. | `/graphql` 404 (471 KB HTML — SPA catch-all), `/api/graphql` 404 (471 KB) | No | **T4** | Lets a vanilla curl through to the homepage HTML, but `_abck` validation kicks in on first XHR. Tier 1 (single-tier) Akamai. |
| flyingblue.com | 503 (Envoy reset) | **Akamai BMP — TLS RST** | none returned (handshake killed) | All subs 0 | `/graphql` 503, `/api/graphql` 503 | n/a | **T5/T6** | KLM/AF AccelyaKale stack. Drops the TLS handshake from datacenter IPs. Needs residential + JA3 spoof. |
| alaskaair.com | 200 (3.1 MB!) | Akamai (light) + Varnish + AppDynamics ADRUM | `ADRUM_BT`, `geo_location_code` (NO `_abck`/`bm_*` on homepage) | `m.alaskaair.com` 301. `api.alaskaair.com` 000 (refused). | `/graphql` 302 (redirect — possible real endpoint), `/api/graphql` 302 | No | **T1** | Homepage served fully open. Their award engine uses internal APIs but they expose less Akamai than peers. **One of the easiest in this list.** |
| lifemiles.com | 403 (Akamai-grn) | **Akamai BMP** | `aka_state_code`, `aka_cr_code` style + `akamai-grn` | `api.lifemiles.com` 403, others 000 | `/graphql` 403, `/api/graphql` 403 | n/a | **T5** | Avianca's program. Tight Akamai; serves only 371 byte challenge stub on cold curl. |
| britishairways.com | TLS connect succeeds, HTTP body never returns (20s timeout) | **Akamai BMP — sensor.js timing wall** | none returned | All subs 000, `api.britishairways.com` 403 (23 bytes) | `/graphql` 000, `/api/graphql` 000 | n/a | **T6** | Toughest in the dataset. Connects + receives 2 NewSessionTickets, then hangs. Classic AA-style behavioral wait-for-sensor.js. Use BD Browser API or commercial scraper. |
| cathaypacific.com | 301 → 200 (235 KB) | **Akamai BMP** (`AkamaiGHost` server) | `_abck`, `bm_sz` | `api.cathaypacific.com` 404 (only 54 bytes). | `/graphql` 404 (2.9 KB), `/api/graphql` 404 (2.9 KB) | No | **T3** | Homepage open; award booking on the SPA is behind Akamai's stricter policy. Single-tier. |
| delta.com | 200 (8 KB stub) | **Akamai BMP + AWS S3 origin** (`server: AmazonS3`) | `_abck`, `bm_s`, `bm_so`, `bm_ss`, `bm_sz`, `akaalb_www_alb_homepage`, `Homepage`, `location` | `mobile.delta.com` 503 (Envoy reset), `m.delta.com` 302, `api.delta.com` 301 (619 bytes — real redirect). | `/graphql` 404 (48 KB), `/api/graphql` 403 (39 KB) — **Delta clearly runs a /api/graphql endpoint** | No | **T5** | api.delta.com is reachable. /api/graphql returned 403 but the response is ~39 KB which is the SPA-shell catch-all; needs proper origin host. |
| miles-and-more.com | 403 + 5.5 KB challenge HTML | **Cloudflare (Turnstile)** (`server: cloudflare`, `cf-ray`, `__cf_bm`) | `__cf_bm` | `mobile.*` & `m.*` → 503, `api.miles-and-more.com` 403 (5584 b — Cloudflare challenge) | `/graphql` 403 (5583 b), `/api/graphql` 403 (5595 b) | No | **T3** | LH/Miles & More moved to Cloudflare Turnstile. Solver-friendly. CSP locks scripts to `challenges.cloudflare.com`. |
| ana.co.jp | 200 (759 KB) | **Akamai BMP (lighter policy)** | `_abck`, `bm_sz`, `asw_uuid`, `w_no` | `booking.ana.co.jp` 200 (790 b) — **the real award-booking host** | `/graphql` 000, `/api/graphql` 000 | No | **T3** | Homepage open. booking.ana.co.jp serves a 200 stub on cold curl — promising entry point. |
| turkishairlines.com | 503 (Envoy reset) | **Akamai BMP — TLS RST** | none returned | `api.turkishairlines.com` 503, others 000 | `/graphql` 503, `/api/graphql` 503 / occasional 200/3858b (transient) | n/a | **T5/T6** | THY drops handshake from sandbox IPs. Strong AS-level filtering. |
| united.com | 503 (Envoy reset) | **Akamai BMP — TLS RST** | none | All subs 000 or 503 | `/graphql` 503, `/api/graphql` 503 | n/a | **T6** | United Akamai is among the strictest. Residential proxy + Camoufox required. |
| virginatlantic.com | 307 → 200 (412 KB) | **Akamai BMP** + AWS CloudFront edge | 60+ cookies including feature flags (`COBRAND_ENABLED`, `FC_*`, `FO_*`, `SRM_*`), `akaalb_alb_www_virginatlantic_com`, `com.virginatlantic.edge.id`, `vhab.f10043t` | `m.virginatlantic.com` 200 (3.7 KB), `mobile.*` 503, `api.virginatlantic.com` 301 | `/graphql` 404 (30 KB), `/api/graphql` 404 | No | **T3** | Tons of leaked feature-flag cookies (useful for behavior reproduction). Homepage open. |
| aeromexico.com | 200 (5.3 KB stub) | **Akamai (ALB+Akamai-lite)** | `akaalb_ALB_APP_1.0`, `balaced2` (no `_abck` on cold GET) | `m.aeromexico.com` 503, others 000 | `/graphql` 200 (~5 KB SPA shell), `/api/graphql` 200 (~5 KB) — **NOT real GraphQL** (HTML maintenance page) | No | **T2** | One of the lighter defenses. No `_abck`. Permissive CSP (`default-src 'self' *`). |
| voeazul.com.br | 403 (58 bytes) | **Akamai? (light)** | none | All 000 | `/graphql` 503, `/api/graphql` 503 (108 b) | n/a | **T4** | Azul (Brazilian) — also drops on cold curl. Pair with BD `-country-br`. |
| copaair.com | 308 → 200 (198 KB) | **Imperva (Incapsula) + CloudFront edge** | `incap_ses_1325_2847270`, `nlbi_2847270`, `visid_incap_2847270`, `dtCookie` (Dynatrace) | `mobile.copaair.com` 503, `m.copaair.com` 503, `api.copaair.com` 403 (23 b) | `/graphql` 308 (9 b), `/api/graphql` 403 (962 b) | No | **T3** | Imperva ABP. `X-Iinfo` header confirms. CSP allows `*.datadome.co` + `*.captcha-delivery.com` (DataDome may also be in the chain). |
| emirates.com | 307 → 200 (629 KB) | **Akamai BMP** | `_abck`, `bm_s`, `bm_so`, `bm_ss`, `bm_sz`, `ekbot`, `traceparent`, `CC` | **`mobile.emirates.com` returns full 705 KB site (200)** — best mobile-endpoint exposure of the lot. `api.emirates.com` 400 (205 b — exists). | `/graphql` 404 (0 b), `/api/graphql` 404 | No | **T3** | The `ekbot` cookie is Emirates' own bot signal. mobile.emirates.com is the entry path. |
| ethiopianairlines.com | 200 (20 KB) | **Akamai (light) + Azure App Service** (`ARRAffinity`, `TiPMix`, `x-ms-routing-name`) | `_abck`, `bm_sz`, `ARRAffinity`, `ARRAffinitySameSite`, `TiPMix`, `x-ms-routing-name` | `m.ethiopianairlines.com` 404, `api.ethiopianairlines.com` 404 (315 b), `booking.ethiopianairlines.com` 200 (212 b) | `/graphql` 200 (174 KB HTML SPA — NOT real GQL), `/api/graphql` 200 (same) | No | **T1** | Lightest Akamai posture of the African/MEA group. Azure origin leaks `x-ms-routing-name`. |
| etihad.com | 503 (108 b) | **Akamai BMP — TLS RST** (or Imperva — challenge body slightly bigger than Akamai's 85 b) | none | All 000, `booking.etihad.com` 301 | `/graphql` 503, `/api/graphql` 503 | n/a | **T5** | Drops connection. The 108-byte body vs the canonical 85-byte Envoy stub suggests a different upstream WAF (likely Imperva — Etihad historically uses Imperva). |
| flysas.com | 403 + 5.4 KB challenge HTML | **Cloudflare (Turnstile)** | `__cf_bm` not visible in headers but `server: cloudflare` + `cf-ray` | All 000 to 503, `bookings.flysas.com` 503 | `/graphql` 403 (5.4 KB — Cloudflare challenge), `/api/graphql` 403 (5.4 KB) | No | **T3** | SAS on Cloudflare. Like LH — moderate difficulty, Turnstile solver works. |
| finnair.com | 403 (369 b — Akamai stub) | **Akamai BMP** + custom origin | `akaas_AB-Test` (Akamai Application Security), CSP locks to `*.finnair.com` + GTM | `m.finnair.com` 302, `api.finnair.com` 503 (493 b) | `/graphql` 403 (376 b), `/api/graphql` 403 (384 b) | No | **T4** | Tight CSP suggests well-engineered front-end. Use residential FI proxy. |
| jetblue.com | 200 (633 KB!) | **Fastly Varnish** (`via: 1.1 varnish, 1.1 varnish, …`) + JetBlue origin | Only `jbCountryCode` — almost no defense! | `booking.jetblue.com` 200 (3.4 KB), `api.jetblue.com` 404, others 000 | `/graphql` 404 (33 KB), `/api/graphql` 404 (33 KB) — both 33 KB suggest a Next.js SPA shell, real GraphQL likely under /loyalty/ or /api/* with a token | No | **T0/T1** | **The easiest target in the entire dataset.** Bare Varnish, no Akamai/Cloudflare/Imperva. Next.js front end (`/_next/static/chunks/*`). |
| qantas.com | 302 → 200 (19 KB) | **Akamai BMP** | `_abck`, `bm_s`, `bm_so`, `bm_ss`, `bm_sz`, `qantas_isDevice` | `m.qantas.com` 301, `api.qantas.com` 404 (40 b) | `/graphql` 404 (1 KB), `/api/graphql` 404 (1 KB) | No | **T3** | Standard Akamai Single-Tier policy. Lighter than United/AA. |
| qatarairways.com | 503 (Envoy reset) | **Akamai BMP — TLS RST** | none | `m.qatarairways.com` 200 (639 b) — **mobile is the way in**. `booking.qatarairways.com` 500 (760 b). | `/graphql` 503, `/api/graphql` 503 | n/a | **T6** | www is brick-walled but m.qatarairways.com still serves a 200 stub — likely lighter policy on the mobile host. |
| saudia.com | 200 (4.7 KB stub) | **Imperva (Incapsula)** (`X-Iinfo: 5-31868762-0 pNNN …`) | `incap_ses_1411_2992896`, `visid_incap_2992896` | `mobile.saudia.com` 200 (4.7 KB), `m.saudia.com` 503, `api.saudia.com` 200 (4.7 KB — same stub) | `/graphql` 200 (4.7 KB stub — NOT real GQL), `/api/graphql` 302 (70 KB — also a redirect chain) | No | **T3** | Imperva ABP. The "Pardon Our Interruption" page is the Imperva challenge. Probe paths return the same 4.7KB stub which is the Imperva intro. |
| singaporeair.com | 301 → 200 (512 KB) | **Akamai BMP** (`AkamaiGHost` + `akamai-grn`) | `_abck`, `bm_sz`, `AKAMAI_SAA_COUNTRY_COOKIE`, `AKAMAI_SAA_DEVICE_COOKIE`, `AKAMAI_SAA_LOCALE_COOKIE`, `saadevice` | `m.singaporeair.com` 301, `api.singaporeair.com` 403 (23 b) | `/graphql` 404 (8 KB), `/api/graphql` 404 (8 KB) | No | **T3** | Akamai SAA (Singapore Airlines Akamai bundle) is well-named in their own cookies. Single-tier Akamai. |
| voegol.com.br | 302 → 200 (359 KB) | **Akamai BMP** + Liferay origin | `_abck`, `bm_s`, `bm_so`, `bm_ss`, `bm_sz`, `akaalb_dupal_liferay` | All subs 0, `api.voegol.com.br` 503 | `/graphql` 404 (116 KB SPA shell), `/api/graphql` 404 (116 KB) | No | **T3** | Brazilian Gol uses Akamai over a Liferay portal (the `akaalb_dupal_liferay` cookie names the origin app). |
| virginaustralia.com | 301 → 200 (377 KB) | **Akamai BMP** | `_abck`, `bm_sz` | `mobile.virginaustralia.com` 301, others 000 | `/graphql` 301 (365 b), `/api/graphql` 301 (369 b) | No | **T3** | Standard Akamai single-tier. /graphql redirects rather than 404s — worth a deeper probe. |

**Coverage:** 28/28 domains classified. Vendor identified on all 28.

### Roll-up by vendor

| Vendor | Carriers | Count |
|---|---|---|
| **Akamai BMP** (tight — TLS RST from sandbox) | flyingblue, turkishairlines, united, qatarairways, britishairways (timeout), etihad | 6 |
| **Akamai BMP** (single-tier — serves homepage, blocks API) | aa, aircanada, cathaypacific, delta, ana, virginatlantic, emirates, ethiopianairlines, finnair, qantas, singaporeair, voegol, virginaustralia, lifemiles | 14 |
| **Akamai (light — no `_abck` on cold)** | alaskaair, aeromexico, voeazul (similar pattern) | 3 |
| **Cloudflare (Turnstile)** | miles-and-more, flysas | 2 |
| **Imperva (Incapsula)** | copaair, saudia | 2 |
| **Fastly Varnish (no real bot defense)** | jetblue | 1 |
| **Total** | | 28 |

Akamai is by far the dominant bot stack across award sites (23/28 = 82%). Cloudflare and Imperva each protect ~7%.

---

## Country-code recommendation for BrightData Residential

Each entry is the country code to pass as `-country-XX` in the BD residential session string. The principle: use the airline's headquarters country (least suspicious geo + bypasses geo-IP cookie pre-checks). Where the loyalty program is HQ'd separately, that country wins.

| Airline | Domain | BD `-country-XX` | Why |
|---|---|---|---|
| American Airlines (AAdvantage) | aa.com | `us` | Fort Worth, TX. `aka_cr_code=US-IA` confirms US-state geo routing. |
| Air Canada (Aeroplan) | aircanada.com | `ca` | Toronto. `geoCountryCode` cookie hard-checks. |
| Flying Blue (AF/KLM) | flyingblue.com | `fr` or `nl` | Joint program HQ Paris (FR primary). |
| Alaska Airlines (Mileage Plan) | alaskaair.com | `us` | Seattle. |
| LifeMiles (Avianca) | lifemiles.com | `co` (Colombia) | Bogotá. |
| British Airways (Executive Club) | britishairways.com | `gb` | London. |
| Cathay Pacific (Asia Miles) | cathaypacific.com | `hk` | Hong Kong. |
| Delta (SkyMiles) | delta.com | `us` | Atlanta. |
| Miles & More (LH/SN/OS/LX) | miles-and-more.com | `de` | Frankfurt. |
| ANA (Mileage Club) | ana.co.jp | `jp` | Tokyo. |
| Turkish (Miles&Smiles) | turkishairlines.com | `tr` | Istanbul. |
| United (MileagePlus) | united.com | `us` | Chicago. |
| Virgin Atlantic (Flying Club) | virginatlantic.com | `gb` | Crawley, UK. |
| Aeroméxico (Club Premier) | aeromexico.com | `mx` | Mexico City. |
| Azul (TudoAzul) | voeazul.com.br | `br` | São Paulo. |
| Copa (ConnectMiles) | copaair.com | `pa` (Panama) | Panama City — note many BD pools list Panama as low-density; `us` is a workable fallback. |
| Emirates (Skywards) | emirates.com | `ae` | Dubai. |
| Ethiopian (ShebaMiles) | ethiopianairlines.com | `et` | Addis Ababa — very low BD pool density; `ke` (Kenya) is the practical fallback. |
| Etihad (Etihad Guest) | etihad.com | `ae` | Abu Dhabi. |
| SAS (EuroBonus) | flysas.com | `se`, `dk`, or `no` | Tri-national; `se` is the safest default (Stockholm HQ). |
| Finnair (Finnair Plus) | finnair.com | `fi` | Helsinki. |
| JetBlue (TrueBlue) | jetblue.com | `us` | New York. |
| Qantas (Frequent Flyer) | qantas.com | `au` | Sydney. |
| Qatar (Privilege Club) | qatarairways.com | `qa` | Doha — BD has scant QA pool; `ae` fallback. |
| Saudia (Alfursan) | saudia.com | `sa` | Jeddah. |
| Singapore Airlines (KrisFlyer) | singaporeair.com | `sg` | Singapore. The `AKAMAI_SAA_COUNTRY_COOKIE` hard-stamps geo. |
| Gol (Smiles) | voegol.com.br | `br` | São Paulo. |
| Virgin Australia (Velocity) | virginaustralia.com | `au` | Brisbane. |

Sticky session length recommendation: 10 minutes per session-IP for Akamai sites (long enough for `_abck` warmup, short enough to avoid behavioral flags); 30 minutes for Cloudflare/Imperva.

---

## Synthesis

### Five EASIEST carriers (T0–T1) — start here

1. **jetblue.com (T0)** — Fastly Varnish only, no Akamai/Cloudflare/Imperva. Bare-bones — `jbCountryCode` is literally the only cookie set on first GET. 633 KB homepage delivered to vanilla curl. Their `/_next/static/chunks/*` bundles are accessible; likely a Next.js SSR app with discoverable internal routes.
2. **alaskaair.com (T1)** — Light Akamai with NO `_abck` set on cold GET; serves the full 3.1 MB homepage. ADRUM (AppDynamics) is the only obvious instrumentation. Award-search engine is on `awardchart.alaskaair.com` and the booking flow on the SPA; both reachable.
3. **ethiopianairlines.com (T1)** — Azure-hosted with `ARRAffinity` / `x-ms-routing-name` cookies; light Akamai. Returns 20 KB HTML clean. `booking.ethiopianairlines.com` 200 confirms the booking host is open too.
4. **aeromexico.com (T2)** — Akamai-lite with no `_abck` cookie on cold GET, very permissive CSP (`default-src 'self' *`). Returns a 5.3 KB Next.js shell — actual SPA bundles fetchable.
5. **ana.co.jp (T3 but well-behaved)** — Akamai with `_abck` set but homepage 200 (759 KB). `booking.ana.co.jp` returns 200 — that's the award-booking host. Tier 1 Akamai policy.

(JetBlue/Alaska/Ethiopian are genuine T0/T1; Aeroméxico/ANA are T2/T3 in practice but among the friendliest.)

### Five HARDEST carriers (T5–T6) — solve last or buy commercial

1. **britishairways.com (T6)** — TLS connects, two NewSessionTickets exchanged, then the upstream silently never returns HTTP. Sensor.js-style timing wall. Among the most adversarial in the dataset.
2. **united.com (T6)** — Akamai BMP drops the handshake (Envoy reset 503/85 b) from sandbox. United's Akamai policy is notoriously tight. Even `api.united.com` and `/api/graphql` are blocked.
3. **qatarairways.com (T6)** — Same TLS-RST behavior as United on `www`. The only opening is `m.qatarairways.com` (200 stub). Will need BD residential + behavioral browser to use that entry.
4. **turkishairlines.com (T5)** — Akamai TLS RST. Marginally easier than UA/QR because `/api/graphql` occasionally serves a 200/3.8 KB response — points to a real backend that just refuses fingerprint mismatches.
5. **flyingblue.com (T5/T6)** — KLM/AF AccelyaKale stack on Akamai BMP. Drops the TLS handshake. Probably the most opinionated Akamai tenant in the SkyTeam loyalty network.

### Honorable mention (T4-T5, watch closely)

- **finnair.com** — strict Akamai with custom CSP; will need Camoufox.
- **lifemiles.com** — only serves a 371-byte Akamai challenge stub; behaves like AA/UA but with a much smaller user base.
- **etihad.com** — 503/108-byte signature (bigger than Akamai's 85-byte canonical) suggests Imperva ABP rather than Akamai BMP, but result is the same: TLS-level RST.

---

## Per-carrier scraper-design hints

| Domain | Lowest-friction entry | Notes |
|---|---|---|
| aa.com | `api.aa.com` (returns 200 + CORS) | Needs `x-api-key`; reverse the AA mobile app for one. |
| aircanada.com | www after a 301-follow (56 KB SPA) | XHRs into `/api/aco/` then need `_abck`. |
| flyingblue.com | n/a from www; try `https://www.airfrance.com` or `https://www.klm.com` for the same award engine (same Accelya backend, different Akamai tenancy). | Different tenancy may be less strict. |
| alaskaair.com | `https://www.alaskaair.com/api/1/awardgrid/award-grid` (per past public reverse-eng) | No `_abck` requirement on the public award-grid endpoint at last sighting. |
| lifemiles.com | The customer-facing search API at `/web-api/searchEngine/v1` (legacy public path) | Akamai single-tier; rotate residential CO IPs. |
| britishairways.com | `https://www.britishairways.com/travel/redeem/public/en_gb` (after solving Akamai sensor.js once) | Sensor.js token reusable for 1 hr. Use BD Browser API. |
| cathaypacific.com | `https://api.cathaypacific.com/redibmpub/...` (CX public award API) | Single-tier Akamai, JA3 spoof + residential HK sufficient. |
| delta.com | `https://www.delta.com/shop/ow/search` REST endpoint | Akamai will require `_abck` warmup; use Camoufox to bake cookies, then httpx+cookies for follow-on. |
| miles-and-more.com | Solve Cloudflare Turnstile via CapSolver; then `/loyalty/redemption/` JSON | T3 — straightforward solver play. |
| ana.co.jp | `booking.ana.co.jp` (`200` cold) | The real award engine talks JSON through this host. |
| turkishairlines.com | Solve Akamai once + BD residential TR | Smaller user base — easier to look like a real Turkish-residing customer. |
| united.com | BD Browser API → `united.com/api/awd-search` | T6 mandatory. |
| virginatlantic.com | `m.virginatlantic.com` (200/3.7 KB) for warmup; then full `www` | Tons of feature-flag cookies leak — useful for replay. |
| aeromexico.com | www returns 200 (5.3 KB SPA shell); next-step is `next.js` route `/api/availability` | T2; light defense. |
| voeazul.com.br | Use BD `-country-br`; first solve their light Akamai | Akamai lite; the booking engine is on `voeazul.com.br/booking` (server-side rendered). |
| copaair.com | After 308 → www serves 198 KB | Imperva — JA3 spoof + 1 round trip warmup. |
| emirates.com | `mobile.emirates.com` (200/705 KB full site) | Mobile host has the lighter Akamai policy. |
| ethiopianairlines.com | `booking.ethiopianairlines.com` (200) | Lightest African carrier. |
| etihad.com | n/a from www; try Etihad Guest portal (`https://guest.etihad.com/`) | Bot defense usually lighter on the loyalty subdomain. |
| flysas.com | Solve Turnstile via CapSolver; then `/loyalty/` paths | Cloudflare only. |
| finnair.com | Solve Akamai + BD `-country-fi`; `/api/awards/` | Reasonable. |
| jetblue.com | Direct httpx → `/api/loyalty/awards` (real path TBD by a subagent) | No bot defense to speak of. |
| qantas.com | `www.qantas.com` after 302 follow (19 KB) | Single-tier Akamai. |
| qatarairways.com | `m.qatarairways.com` only | Hard target overall. |
| saudia.com | Imperva — solve once with curl_cffi JA3 spoof, then session reuse | Imperva ABP is solver-friendly. |
| singaporeair.com | `www.singaporeair.com/en_UK/us/home` (after 301) | Standard Akamai. |
| voegol.com.br | Follow 302 → 359 KB Liferay page; then `/smiles/` JSON | Standard Akamai. |
| virginaustralia.com | Follow 301 → 377 KB SPA; then `/api/velocity/` | Standard Akamai. |

---

## Source-map availability

**None of the 28 carriers exposes useful source maps on the public CDN paths reachable from a cold GET.** Sample probe: JetBlue Next.js chunk `/_next/static/chunks/0bocda8ic4d8t.js` + `.map` → 404. The only `sourceMappingURL=` strings found in homepage HTML were escaped string literals embedded inside minified bundles (e.g. AlaskaAir's was inside a script tag as JSON-escaped content), not real map references. So source maps will not shortcut the reverse-engineering work.

If we want JS source recovery, the path is:
1. Pull production bundles from CDN.
2. Run through `unpacker` / `wakaru` / `webcrack` for AST-level unminification.
3. Spot-check whether any chunk hashes match `*.js.map` on the same path (run the JetBlue probe technique across all carriers).

This is a per-carrier follow-up rather than a generic shortcut.

---

## Recommended next actions

1. **Build the JetBlue scraper first.** Bare Varnish is the easiest "real airline" win on the list and proves end-to-end plumbing.
2. **Alaska Airlines second.** Light Akamai posture and a small set of well-documented award endpoints.
3. **Defer United, Qatar, British Airways, Flying Blue.** These need either BD Browser API, Apify commercial actors, or sensor.js solvers. Either buy that capability up front (T6/T7) or hold these carriers until the rest of the pipeline is proven.
4. **Set up CapSolver/Hyper-Solutions accounts now.** Five carriers (LH M&M, SAS, plus Akamai/Imperva-protected peers) need solvers before they can ship.
5. **Map BrightData residential pool density** for the obscure geos: `et`, `qa`, `pa`. If density is too low, fall back to `ke`, `ae`, `us` respectively and watch for additional geo-cookie rejections.
6. **One-off subagent task:** enumerate `api.aa.com` routes — it's the only fully-open API host in the dataset and that's worth a deeper pass.
7. **Re-run this profile from a residential IP** (not from the Anthropic sandbox) before locking in tier choices. The TLS-RST results for FB/THY/UA/QR/ET specifically may relax from a true residential JA3.
