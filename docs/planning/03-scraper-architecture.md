# PointSnap Live-Pricing & Scraper Service Architecture

> Phase 1 target: sub-15s fan-out award search across 12 frequent flyer programs, Seats.aero-style spreadsheet output (Y/W/J/F per flight per program), with a confidence engine and shadow-confirm verification. Most accurate award engine on the market.

---

## 1. Per-Program Intelligence Matrix

This is the heart of the system. Each program is a separate beast; we treat each as a versioned plugin owning its own session/parser/captcha pipeline.

| # | Program | Endpoint type (observed in OSS / network tab reports) | Login req. | Anti-bot stack (reported) | Mobile API alt. | ToS / Legal history | Practical difficulty (1=easy, 5=nightmare) |
|---|---|---|---|---|---|---|---|
| 1 | United MileagePlus | Internal JSON POST to `/api/flight/...` style endpoints behind united.com, observed by `lg/awardwiz`, `superflyer/ual` | No (guest search works) | Akamai Bot Manager + sensor.js TLS fingerprinting; reCAPTCHA v2 invisible on auth flows | iOS app uses same JSON over TLS pinning — possible but pinning is annoying | Standard ToS no-scrape clause; AwardWallet C&D in 2012; sued The Points Guy historically | 3 |
| 2 | Air Canada Aeroplan | Internal JSON API; previously enumerated by `flightplan-tool`, `pburka/aeroplanner` | Yes (functional search requires login; partner search shows more when logged in) | Akamai + reCAPTCHA Enterprise on login; account-fraud lockouts common | Mobile app uses same JSON, often less defended | **Sued Seats.aero Oct 2023** in D. Del. for CFAA + trademark, $75K actual / $2M statutory; PI denied — case ongoing | **5** (active litigation) |
| 3 | Avianca LifeMiles | JSON API; `ak2912/Lifemiles` and `lifemiles.com` developer console show clean REST | Yes for award search (must be logged in to see Star Alliance inventory) | Light reCAPTCHA v2 on login; geo-throttling — LATAM IPs see more inventory faster | `api.auth.lifemiles.net` mobile auth flow | Standard ToS; no public lawsuits | 2 |
| 4 | Air France / KLM Flying Blue | NDC-flavored JSON; AF-KLM has an official Developer Portal (rate-limited, not for award search but useful for cash); award search uses an internal endpoint | No | Imperva/Incapsula + light reCAPTCHA; mostly fingerprint-based | Mobile uses NDC | Standard ToS | 2 |
| 5 | Virgin Atlantic Flying Club | "Reward Flight Finder" JSON endpoint; `vseats.io` and `seatspy.com` openly scrape it | No | Light (Cloudflare WAF default); occasionally hCaptcha on suspicious patterns | `ba_rewards`-style iOS API exposed | Standard ToS; quiet historically | 1 |
| 6 | Alaska Mileage Plan (Atmos) | JSON POST to internal availability endpoint; `lg/awardwiz` scrapes successfully | No | Cloudflare Bot Management; relatively forgiving | iOS app uses GraphQL — Alaska has been moving to it | Standard ToS; Alaska runs an official developer portal for API partners | 2 |
| 7 | American AAdvantage | Internal JSON (`booking.aa.com` flow); `Sekinal/aa_contest`, `tszumowski/aa_flight_search_tool`, `yocontra/aa-rewards` all hit it | No | Shape Security / F5 Distributed Cloud Bot Defense (formerly Shape); JS challenges; PerimeterX/HUMAN on some flows | iOS API present | Sent C&Ds to AwardWallet/MileWise 2012; sued The Points Guy 2018 over AAdvantage account ToS | 4 |
| 8 | Delta SkyMiles | Internal JSON; aggressive dynamic pricing means values change minute-to-minute | No | DataDome + reCAPTCHA Enterprise; one of the harder stacks | Mobile API is heavily certificate-pinned | Standard ToS; sent 2012 C&Ds | 4 |
| 9 | British Airways Avios | Documented private API in `timrogers/ba_rewards` (Avios Flight Finder iOS app), `adamgilman/britishairways-python` | No | Confusing CAPTCHA system that FlyerTalk has complained about; appears to be hCaptcha + custom | iOS Flight Finder API is well-understood | IAG developer portal exists but is partner-gated | 2 |
| 10 | Turkish Miles&Smiles | Internal JSON; recent (2024–2025) move to dynamic award pricing per-segment | Yes (login required for partner award search) | Light (Imperva), but session/account lockouts aggressive | Mobile app — moderately defended | Standard ToS | 3 |
| 11 | ANA Mileage Club | Internal JSON; `Makoto-winter/Find_ANA_Award_Availability` (Selenium), `lexande/awardsearch` (Star Alliance via ANA) | Yes (login required for Star Alliance partner search — the valuable one) | Light Akamai; aggressive geo blocks outside Japan; session timeouts ~5 min | Mobile app weaker | Standard ToS | 3 |
| 12 | Singapore KrisFlyer | Internal JSON behind `singaporeair.com` award search; `flightplan-tool` supports | Yes (for partner awards) | Light; Cloudflare default; reCAPTCHA on login | Mobile app well-defined, but SIA has an official KrisPass/KrisFlyer API for partners — not for award search | Standard ToS | 2 |

**Aggregate difficulty ordering (hardest → easiest):**
Aeroplan (legal risk) > Delta (DataDome) > American (Shape) > United (Akamai) > Turkish, ANA (auth + geo) > LifeMiles, Flying Blue, KrisFlyer, Alaska, BA > Virgin Atlantic.

> Note: Cathay (CX) and Lufthansa M&M (LH) are covered separately in `05-cathay-lufthansa-research.md`. The launch list of 13 programs swaps KrisFlyer (SQ) for Cathay (CX) and adds LH M&M with a deferred direct-scraper plan.

---

## 2. High-Level Architecture

```
                 ┌─────────────────────────────────────────────────────────────┐
                 │                       PointSnap API                          │
                 │  (Next.js BFF + GraphQL gateway, sub-15s SLA, SSE stream)    │
                 └───────────────┬──────────────────────────────┬──────────────┘
                                 │                              │
                       ┌─────────▼─────────┐          ┌─────────▼──────────┐
                       │   Search Planner   │          │  Confidence Engine │
                       │  (fan-out per OD,  │          │  (post-merge scorer)│
                       │   per program)     │          └─────────┬──────────┘
                       └─────────┬─────────┘                    │
                                 │ enqueues 12 jobs / search    │
                       ┌─────────▼─────────────────────────────▼──────────┐
                       │              BullMQ (Redis Cluster)                │
                       │  Priority lanes: paid > free > warming > shadow   │
                       └─────────┬─────────────────────────────┬──────────┘
                                 │                             │
       ┌─────────────────────────┼─────────────────────────────┼────────────────────────────┐
       │           Per-program worker pools (12 isolated)                                    │
       │  ┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────┐    │
       │  │ united │ │aeroplan│ │lifemiles│ │flyingbl│ │ virgin │ │ alaska │ │   aa    │ ...│
       │  └───┬────┘ └───┬────┘ └────┬────┘ └────┬───┘ └────┬───┘ └────┬───┘ └────┬────┘    │
       │      │          │           │           │          │          │          │         │
       │      ▼          ▼           ▼           ▼          ▼          ▼          ▼         │
       │  [curl_cffi   [Patchright [curl_cffi  [curl_cffi [iOS-API   [curl_cffi  [Patchright│
       │   + cookies]   browser]   + LATAM     + cookies] replay]    + cookies]   + Shape  │
       │                            geo]                                          solver]  │
       └─────┬──────────┬───────────┬──────────┬──────────┬───────────┬──────────┬─────────┘
             │          │           │          │          │           │          │
             ▼          ▼           ▼          ▼          ▼           ▼          ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │  Shared infrastructure layer                                        │
        │  • Proxy router (per-program pools, geo-targeted)                   │
        │  • CAPTCHA broker (CapSolver primary, 2Captcha fallback)            │
        │  • Account/session vault (Vault + Redis; encrypted cookie jars)     │
        │  • Result normalizer → unified Flight/Cabin/Price schema            │
        │  • Redis result cache (per-program TTL)                             │
        │  • ClickHouse for raw observation logs (analytics + ML training)    │
        └─────────────────────────────────┬──────────────────────────────────┘
                                          │
                       ┌──────────────────▼──────────────────┐
                       │       Shadow-Confirm Engine          │
                       │  Top-N results → drive to ticketing  │
                       │  page → abandon → score              │
                       └──────────────────────────────────────┘
```

---

## 3. Worker Stack: Language & Runtime

**Decision: Python 3.12 + `curl_cffi` for API-replay scrapers, Python + Patchright (Playwright fork) for browser-required programs.**

Rationale:
- `curl_cffi` (Python binding for curl-impersonate) is the de facto standard for TLS/JA3/JA4/HTTP-2 fingerprint impersonation. It handles Akamai sensor.js + DataDome's TLS-layer detection that vanilla `requests`/`httpx` cannot. About 7–8 of our 12 programs (Virgin, LifeMiles, Flying Blue, KrisFlyer, BA, Alaska, Turkish, parts of ANA) can be hit headlessly via curl_cffi — cheap and fast (50–200ms per request).
- For Aeroplan, AA, Delta, United we need a real browser to defeat behavioral biometrics (mouse curves, scroll cadence). **Patchright** (Playwright fork with C++-level CDP-leak patches) is preferred over vanilla Playwright + playwright-extra — `playwright-stealth` v1 stopped working against 2024+ DataDome; Patchright is actively maintained, ~67% headless-detection reduction, and remains a drop-in for the Playwright API. Camoufox (Firefox fork, 0% headless detection) is the fallback for the hardest sites, accepting its higher RAM cost.
- Node + Playwright was a serious contender. We pick Python because: (a) `curl_cffi` has no Node equivalent of equal maturity; (b) Python's data-processing stack (pyarrow, polars) is better for the normalizer; (c) most existing OSS award scrapers (`Sekinal/aa_contest`, `ak2912/Lifemiles`, `tszumowski/aa_flight_search_tool`) are Python — we can port logic faster.
- Go was considered for the high-volume curl_cffi-style workers (it has `bogdanfinn/tls-client`). We reject it for v1 because Python + curl_cffi is faster to iterate on, and the hot path is network-bound, not CPU-bound. We may rewrite the top-3 highest-QPS workers in Go in v2.

**Package layout (per program):**
```
workers/programs/<program>/
  ├── plugin.toml            # version, schema, kill-switch flag, TTLs
  ├── session.py             # cookie/JWT acquisition, refresh, pool checkout
  ├── client.py              # curl_cffi or Patchright client wrapper
  ├── search.py              # the actual search call
  ├── parse.py               # raw response → normalized Flight schema
  ├── captcha.py             # program-specific captcha hook
  ├── shadow_confirm.py      # drive-to-ticketing implementation
  └── tests/cassettes/       # vcr.py recorded fixtures for offline parser tests
```
Every plugin implements an `AwardScraper` protocol: `async def search(origin, dest, date, cabin_filter) -> list[NormalizedFlight]`. The orchestrator never sees program-specific code.

---

## 4. Containerization & Orchestration

**Decision: Docker images per program plugin, deployed on Fly.io Machines (Phase 1) with a planned migration to AWS ECS Fargate (Phase 2 when >100K searches/day).**

- **Fly.io for Phase 1** because: per-program Machines can be pinned to specific regions (LifeMiles workers in `gru`/`bog`, ANA workers in `nrt`, Turkish in `ist`-adjacent `fra`), scale-to-zero is built-in for low-traffic programs, Anycast routing keeps API latency tight, and the ops surface is one CLI. Pricing per shared-1x-2GB machine is ~$5/mo idle.
- **Reject Railway**: no native background workers, dashboard-first not GitOps-first, fewer regions.
- **Reject k8s for Phase 1**: nobody on a small team wants to manage 12 isolated NodePool/Namespace pairs with HPA, KEDA, network policies, and per-program IP-egress NAT gateways before product-market fit.
- **Phase 2 → ECS Fargate** when we need: (a) per-program NAT/egress IP isolation via dedicated subnets, (b) tighter integration with Secrets Manager for account rotation, (c) finer-grained autoscaling on SQS depth. Migration is mechanical because everything is already Dockerized.

Each program gets its own Fly App (`pointsnap-worker-united`, …). One blocked program never poisons the others' networking, IAM, or scaling.

---

## 5. Queue Topology

**Decision: BullMQ on Redis Cluster (3-node, ElastiCache or Upstash).**

Rationale:
- **Per-program search job fan-out**: an incoming user query becomes 12 jobs in 12 program queues. Each program queue has its own concurrency cap (e.g., united.concurrency=20, aeroplan.concurrency=4 because of risk + cost). One program lagging never blocks another — its jobs queue, others' jobs drain.
- **Reject SQS** despite AWS-nativeness: per-program FIFO+priority semantics are clunky in SQS, and we benefit from BullMQ's first-class job dependencies, repeatable jobs (cache warmer), and rate limiters per queue.
- **Reject Temporal** for fan-out: overkill for stateless search jobs (avg duration 1–10s). We will use Temporal for the *shadow-confirm* workflow specifically (see §10), because that is a multi-step durable saga (load search → reprice → seat-select → fare-quote → abandon) that benefits from event-replay durability.
- **Reject RabbitMQ**: extra ops burden, no compelling feature win over BullMQ at our scale.

**Job shape:** `{search_id, user_tier, origin, dest, date, cabin_filter, deadline_ts}` — note `deadline_ts`, not retry count. Workers that pull a job past deadline immediately ACK + emit a `deadline_miss` metric (saves doing work nobody is waiting for).

**Retry / DLQ:**
- Transient (HTTP 5xx, timeout): exponential backoff (250ms / 1s / 4s), max 3 tries within the deadline budget.
- Captcha required: route to captcha-broker subqueue, return when solved or timeout.
- 401/403 (session burned): mark session dead in vault, retry once with a fresh session from the pool.
- 429 / WAF block: increment `block_rate` metric for that proxy, retire proxy, retry once with fresh proxy + fresh session. If 3 consecutive blocks across different proxies → trip the program circuit breaker.
- Terminal: DLQ → ClickHouse for analysis, alert if DLQ rate > 2% per program per 5min.

**Priority lanes (per program, 4 lanes):**
1. `paid-user-live` (priority 1, deadline 12s)
2. `free-user-live` (priority 2, deadline 8s — fail fast to cache)
3. `cache-warming` (priority 5, run during low-traffic hours)
4. `shadow-confirm` (priority 3, deadline 30s, only top-N results)

---

## 6. Proxy Strategy

**Decision: IPRoyal residential as primary at ~$1.75–$7/GB depending on volume, Bright Data as the premium fallback for the hardest programs (Aeroplan, Delta, AA, United) at ~$2.50–$4/GB. Datacenter IPs only for the auth-free, lightly-defended programs (Virgin, KrisFlyer, BA, Alaska) via Oxylabs DC at $50/mo bundles.**

- **Per-program proxy pools, fully isolated.** Each program has its own IPRoyal sub-user with its own bandwidth bucket and rotation policy. One program burning its pool never bleeds into another's.
- **Geo-targeting where it matters:**
  - LifeMiles → Colombia, Brazil, Mexico residential (LATAM IPs see better Star Alliance inventory and don't trigger fraud)
  - ANA → Japan residential (English-locale ANA outside Japan throttles partner search)
  - Aeroplan → mix of CA + US residential
  - Flying Blue → FR + NL residential
  - Turkish → DE + TR residential (sometimes geoblocks suspicious origins)
  - KrisFlyer → SG residential
  - All others → US residential
- **Sticky sessions** of 5–10 minutes for the logged-in programs (LifeMiles, Aeroplan, Turkish, ANA, KrisFlyer) so the auth cookie stays bound to the same IP — TLS-fingerprint + cookie + IP must all agree.
- **Rotation budget per program** stored in Redis (token-bucket); when burned, worker degrades to cache.

---

## 7. CAPTCHA Solving

**Decision: CapSolver as primary (lowest cost + highest reCAPTCHA Enterprise success rate ~90%+), 2Captcha as fallback (broader coverage, human-in-loop for novel challenges), NopeCHA browser extension shipped inside Patchright containers as a *third* fallback for ad-hoc UI captchas.**

Per-solve cost estimates:
| Challenge | CapSolver | 2Captcha |
|---|---|---|
| reCAPTCHA v2 | ~$0.80 / 1K | ~$2.99 / 1K |
| reCAPTCHA v3 | ~$1.50 / 1K | ~$2.99 / 1K |
| reCAPTCHA Enterprise | ~$2.00 / 1K | ~$5.99 / 1K |
| hCaptcha | ~$1.20 / 1K | ~$2.99 / 1K |
| FunCaptcha / Arkose | ~$3.00 / 1K | ~$8.99 / 1K |
| DataDome JS challenge | ~$3.50 / 1K | ~$8.99 / 1K |

**Unit-economics impact:** At 1M searches/day and a 5% captcha-hit rate across all programs (50K solves/day), CapSolver costs ~$60–$150/day = $1.8–$4.5K/mo. If we let it climb to 20% (bad fingerprint hygiene), it's $7–$18K/mo. Budgeting target: keep captcha-rate < 3% per program by investing in good fingerprints + warm sessions upstream.

---

## 8. Session & Account Management

**Decision:** HashiCorp Vault (or Doppler if we want a SaaS) for account secrets; Redis-backed encrypted cookie/JWT pool with checkout/return semantics.

Account farming requirements per program:
| Program | Login req? | Accounts needed (target) | Notes |
|---|---|---|---|
| United | No | 0–5 (some endpoints get more data logged in) | Use guest where possible |
| Aeroplan | Yes | 40+ | High burn risk; rotate aggressively; expect monthly attrition |
| LifeMiles | Yes | 20 | Cheap to create, low attrition |
| Flying Blue | No | 5 | Mostly guest |
| Virgin Atlantic | No | 0 | Reward Flight Finder is unauth |
| Alaska | No | 5 | Mostly guest |
| American | No | 5 | Mostly guest |
| Delta | No | 5 | Mostly guest |
| British Airways | No | 5 | Mostly guest |
| Turkish | Yes | 30 | Account lockouts frequent; need spares |
| ANA | Yes | 15 | Tight session timeouts |
| KrisFlyer | Yes | 10 | Moderate |

**Total account inventory v1: ~135 accounts.** We use a managed account-farming vendor (e.g., one of the gray-market services that resell verified accounts with real-name + KYC where required) at roughly $5–$20/account, monthly burn 5–10%. Budget: ~$200–$800/mo recurring.

**Warm vs cold sessions:** A background warmer job ("cache-warming" priority lane) keeps a target of N warm sessions per program at all times. A "warm" session has: fresh cookies < 30min old, recently passed a captcha, paired with a still-healthy proxy IP. Cold sessions are bootstrapped only when warm pool runs dry. Rule of thumb: aim to never serve a paid-user search from a cold session.

---

## 9. Browser Fingerprinting Strategy

**For curl_cffi workers:** use the `impersonate="chrome124"` (or current latest) preset; rotate UA + Accept-Language to match the proxy's geo locale (FR proxy → `fr-FR`, etc.). Pin JA3 + Akamai + HTTP/2 fingerprint per session and only rotate when retiring the session.

**For Patchright/Camoufox workers:**
- Per-session randomized: viewport (sampled from real-world distribution — 1920x1080, 1366x768, 1440x900, etc.), UA, timezone (matched to proxy geo!), accept-language, WebGL vendor/renderer, canvas noise, AudioContext noise, screen color depth.
- Persistent identity within a session lifetime (e.g., 30 min) — flicker is a tell.
- Realistic mouse trajectories via `playwright-extra-plugin-recaptcha` style human movement, plus 200–800ms randomized think-times.
- Use `curl_cffi` for sub-requests that the page does after initial load when possible — saves browser CPU.

**When to use which:**
- API-replay (curl_cffi) when the program exposes a clean JSON endpoint AND the anti-bot is at most TLS + simple JS challenges → United (sometimes), LifeMiles, Flying Blue, Virgin, Alaska, BA, KrisFlyer, ANA-when-warmed.
- Real browser (Patchright) when the anti-bot does behavioral biometrics → Aeroplan, Delta, AA, sometimes United.
- Camoufox as the "break glass" option when Patchright starts getting detected on Delta / AA — accept the 5x RAM cost.

---

## 10. Confidence Engine

The differentiator. Every result we emit carries a 0–100 score and a coarse label.

**Inputs:**
1. **Data freshness** (40% weight): seconds since the underlying observation. Linear decay from 100 (just-now) to 0 (older than program TTL).
2. **Multi-source agreement** (25%): if the same flight is found via two programs that share inventory (e.g., United operating segment seen by both Aeroplan and LifeMiles award searches), confidence increases. Disagreement (one says J avail, another says no J) decreases.
3. **Shadow-confirm outcome** (20%): did our shadow-confirm engine successfully drive this exact flight+cabin to the ticketing screen? Yes = +20, No = -10, Not yet attempted = 0.
4. **Historical ticketing success rate** (10%): rolling 30-day P(book succeeds | we showed it bookable) per program × route-bucket. Programs with phantom availability problems (Turkish, AA partner) get systematically lower priors.
5. **Inventory volatility prior** (5%): dynamic-pricing programs (Delta, Turkish, AA) inherently get a slight penalty vs chart-based (Alaska, Virgin partner chart).

**Output bucketing:**
- 90–100 → **Verified** (shadow-confirmed within last N minutes, freshness < 60s)
- 75–89 → **High**
- 50–74 → **Medium**
- 25–49 → **Low** (show with warning)
- < 25 → **Chart-only** (we derived the price from a chart; we have no live evidence)

Confidence score is computed at result-merge time, *after* fan-out completes, so cross-program agreement is visible.

---

## 11. Shadow-Confirm Engine

**Goal:** verify bookability without buying tickets. Run on Temporal (durable workflows because each shadow-confirm is a 5–8 step saga).

**Mechanics per program (high level):**
1. Resume an existing logged-in session for the program.
2. Re-search the exact OD+date.
3. Click through to flight selection for the specific itinerary.
4. Advance through fare/cabin selection, passenger details (with synthetic passenger data — see legal §13), to the final pricing screen.
5. Capture the actual mileage + tax/fee figures the airline quotes.
6. **Abandon before payment.** Do NOT enter payment. Do NOT submit booking.
7. Emit `shadow_confirm.{program, route, cabin, success, observed_miles, observed_taxes}`.

Per-program implementation notes:
- **Aeroplan:** highest legal-risk program to shadow-confirm given active litigation — we run shadow-confirm here at lowest frequency, only on paid-user top-3 results, and only with disposable accounts not linked to real members.
- **Delta:** dynamic pricing means re-quotes can change between search and shadow → that itself is a useful signal we surface ("price was X at search, Y at confirm").
- **AA:** known for phantom partner availability — shadow-confirm is most valuable here.
- **Turkish:** known for phantom availability post-search → shadow-confirm is essential.

**Frequency budget:** at most ~3 shadow-confirms per user search, only on the top-3 by relevance, with results cached for 5 minutes (key = `shadow:{program}:{flight_no}:{date}:{cabin}`). This caps cost.

---

## 12. Caching (Redis)

**Per-program TTLs (calibrated to inventory volatility):**

| Program | Search TTL | Shadow-confirm TTL |
|---|---|---|
| Delta (fully dynamic) | 60s | 3min |
| American (dynamic) | 90s | 5min |
| Turkish (dynamic) | 90s | 5min |
| United (mostly dynamic) | 120s | 5min |
| Aeroplan (chart) | 5min | 10min |
| LifeMiles (chart) | 10min | 15min |
| Alaska (chart) | 10min | 15min |
| Flying Blue (mostly chart) | 5min | 10min |
| Virgin (chart) | 15min | 30min |
| BA (chart) | 15min | 30min |
| ANA (chart) | 30min | 60min |
| KrisFlyer (chart) | 30min | 60min |

**Cache key shape:**
`search:{program}:v{schema_version}:{origin}:{dest}:{date}:{cabin_filter}:{geo_bucket}` — geo bucket included because some programs return different inventory by point-of-sale.

**Stampede protection:** single-flight via Redis `SETNX` lock + `BLPOP` waiter list. First request acquires the lock and runs the live scrape; concurrent requesters block on a key like `wait:{cache_key}` for up to `deadline_ts - now`, then either get the result or fall through to chart-derived data.

---

## 13. Observability & Per-Program Kill Switch

Stack: OpenTelemetry → Tempo (traces) + Prometheus/Mimir (metrics) + Loki (logs) + Grafana. ClickHouse for cold raw observation history.

**Per-program metrics (cardinality: {program, lane, proxy_pool}):**
- `scrape.success_rate` (target > 95%)
- `scrape.latency_p50/p95/p99`
- `captcha.solve_rate` and `captcha.cost_usd`
- `block.rate` (HTTP 4xx WAF + captcha-required signals)
- `session.pool_size_warm` / `session.checkout_failures`
- `proxy.bandwidth_used_gb`
- `cost.per_search_usd`
- `shadow_confirm.success_rate`
- `confidence.median` of emitted results

**Alert thresholds (PagerDuty for severe, Slack for warn):**
- Block rate > 10% for 5 min → **critical** → auto-trip kill switch
- Success rate < 80% for 10 min → critical
- p95 latency > 12s for 5 min → warn
- Captcha cost > 2x daily baseline → warn
- Warm-pool exhausted for > 2 min → critical
- Cost-per-search > 2x program baseline for 15 min → warn

**Per-program kill switch:** a config flag in Consul/Redis (`program.united.enabled = false`). The orchestrator skips that program at fan-out time; the API returns chart-derived data with confidence=Low and a UI badge "live data temporarily unavailable for this program." Tripped automatically by the block-rate alert; can be manually flipped by ops.

---

## 14. Cost Model

Estimated unit cost of one full 12-program parallel search, assuming reasonable cache hit rates after warm-up:

| Component | Per search @ 100/day | Per search @ 10K/day | Per search @ 1M/day |
|---|---|---|---|
| Proxy bandwidth (avg ~3MB live, mostly cached) | $0.012 | $0.0085 | $0.0035 |
| CAPTCHA (3% rate × ~$0.0015 avg) | $0.0001 | $0.0001 | $0.0001 |
| Compute (Fly machines / Fargate) | $0.020 | $0.004 | $0.0015 |
| Accounts (amortized monthly burn) | $0.020 | $0.0002 | $0.000002 |
| Shadow-confirm (3 per search × cost) | $0.005 | $0.003 | $0.0015 |
| Redis + ClickHouse + observability | $0.015 | $0.002 | $0.0008 |
| **Total per search** | **~$0.072** | **~$0.018** | **~$0.0074** |
| **Daily total** | **$7** | **$180** | **$7,400** |
| **Monthly run-rate** | **~$210** | **~$5.4K** | **~$220K** |

Notes: dominated by proxies + compute at scale. At 1M/day we'll be on committed-spend proxy contracts at $1.75/GB or below, and Fargate Savings Plans. The shadow-confirm budget is the biggest knob — restricting it to paid users only roughly halves variable cost.

---

## 15. Legal & Risk

**Per-program risk ranking (highest to lowest):**

1. **Aeroplan — extreme.** Active CFAA + Lanham Act suit vs Seats.aero in D. Del. (October 2023). PI denied but suit ongoing. Mitigations: (a) never reuse Air Canada logos/trademarks anywhere in UI ("Air Canada Aeroplan" as bare text only); (b) implement aggressive rate-limiting *for Aeroplan specifically*; (c) be ready to disable Aeroplan support on legal demand; (d) avoid impersonating mobile app traffic to keep CFAA exposure minimal; (e) consult counsel before launch.
2. **American — high.** Has form (C&D to AwardWallet 2012, suit vs The Points Guy 2018 over account-based access). Mitigations: prefer unauth flows, never use real customer accounts, do not access AAdvantage member account pages.
3. **Delta, United — medium.** Both sent 2012 C&Ds, both quiet since. Standard scrape-clause ToS.
4. **Everyone else — medium-low.** Standard "no automated access" clauses, no public lawsuits.

**Cease-and-desist playbook:**
1. **Within 24h:** Engage counsel. Trip kill switch for the program (graceful degradation to chart data).
2. **Within 48h:** Send acknowledgment. Document our access patterns + good-faith mitigations (rate limiting, no account abuse, no trademark misuse).
3. **Within 7 days:** Offer technical meeting — propose an official partner API or paid data feed; many carriers will say no but the offer is recorded and useful in court (Seats.aero used this exact tactic).
4. **If sued:** Brief defense centered on (a) hiQ v LinkedIn (CFAA does not reach publicly accessible data); (b) good-faith load minimization; (c) lack of cognizable damage; (d) the result of Air Canada v Seats.aero PI ruling.
5. **Pre-emptive:** Maintain a robots.txt-compatible egress identification header on opt-in basis, so we have evidence we are not hiding maliciously.
6. **Public messaging:** Pre-write a statement. The Seats.aero / Air Canada conflict generated significant favorable press for the scraper — being on the consumer-friendly side is itself a defense.

---

## 16. Failure Modes & Graceful Degradation

| Failure | Detection | Response |
|---|---|---|
| Program X blocked (high block rate) | Block rate alert | Trip kill switch → serve last-known cached result with confidence label "Low – cached"; chart-derived fallback if no cache |
| CAPTCHA vendor down | Capsolver 5xx rate > 20% for 1min | Auto-failover to 2Captcha; if both down, programs requiring captcha degrade to cache |
| Proxy provider rate-limited | 429 from proxy endpoint, not target | Failover IPRoyal → Bright Data per-program; degrade if both saturated |
| Account pool exhausted | Warm-pool < 25% target for 2 min | Pause new logged-in searches for that program; cold sessions kick in; alert ops to top up accounts |
| Redis cluster failover | Sentinel-detected | BullMQ degrades gracefully (in-flight jobs replay); cache miss spike absorbed by rate-limited live scrape |
| Hard SLA miss (search > 15s) | Deadline timer in orchestrator | Return partial results from programs that completed; mark missing programs with "Pending" UI state and stream remainder via SSE |
| Anti-bot vendor changes (Akamai/DataDome upgrade) | Sudden block-rate spike on multiple programs simultaneously | Auto-trip affected programs; on-call engineer fingerprint-rotation playbook (rotate UA presets, refresh curl_cffi version, re-record fixtures); chart-only fallback for the duration |

---

## 17. Hot-Path Latency Budget (sub-15s SLA)

```
T+0ms    User query hits API
T+50ms   Search Planner enqueues 12 jobs (BullMQ)
T+100ms  Workers pick up jobs (warm pool, no cold start)
T+200ms  Workers check Redis cache; hits return immediately
         (typical: 4–7 of 12 programs cached, sub-300ms total)
T+200ms..T+11000ms  Live scrapes for cache misses run in parallel
         Per-program p95 latency targets:
           - Virgin, BA, Alaska, KrisFlyer:    <2s  (curl_cffi)
           - LifeMiles, Flying Blue, ANA:      <4s  (curl_cffi + login)
           - United, Turkish:                  <6s  (mixed)
           - AA, Delta:                        <9s  (Patchright)
           - Aeroplan:                         <11s (Patchright + captcha)
T+11000ms Results merged, normalized, confidence-scored
T+11500ms Top-3 shadow-confirms kicked off in background (do not block)
T+12000ms Initial response streamed (SSE) to client
T+...     Shadow-confirm results stream as they complete; UI updates
          confidence badges live (Verified upgrade from High)
```
We achieve sub-15s by treating shadow-confirm as fully async and accepting initial confidence-by-correlation rather than confidence-by-verification.

---

## 18. Build Sequencing (Pragmatic)

Build order (rough effort weeks per program shown for one engineer):
1. **Week 1–2:** Platform skeleton — BullMQ, plugin protocol, normalizer schema, Fly deploy.
2. **Week 3:** Virgin Atlantic (easiest, validates pipeline end-to-end).
3. **Week 4:** Alaska + BA + KrisFlyer (all easy, similar curl_cffi pattern).
4. **Week 5:** LifeMiles + Flying Blue (login complexity).
5. **Week 6:** United + Turkish + ANA (auth + harder anti-bot).
6. **Week 7–8:** American + Delta (Patchright + CAPTCHA pipeline).
7. **Week 9–10:** Aeroplan **(legal review first)** — last because of risk and litigation exposure.
8. **Week 11:** Confidence engine + cross-program correlation.
9. **Week 12:** Shadow-confirm engine on Temporal, paid-tier only.

Phase-1 launch target: 8 easiest programs live publicly with confidence labels; Aeroplan/Delta/AA/United behind a "Pro" tier with legal disclosure and stricter rate limits.

---

## 19. Open Questions / Decisions to Revisit

- Whether to support Aeroplan at all given litigation. **Decision: ship day 1 per user direction**, with operational hygiene baked in.
- Whether to commercially partner with `seats.aero` or `roame.travel` for fallback inventory rather than scraping everything ourselves on day one.
- Whether to ship a public API. Doing so creates additional ToS exposure (downstream redistribution) but is a real revenue lane.

---

Sources:
- [AwardWiz GitHub (lg/awardwiz)](https://github.com/lg/awardwiz)
- [Flightplan tool](https://github.com/flightplan-tool/flightplan)
- [united-scraping](https://github.com/mike-park/united-scraping), [superflyer/ual](https://github.com/superflyer/ual)
- [Aeroplanner (pburka)](https://github.com/pburka/aeroplanner)
- [ak2912/Lifemiles](https://github.com/ak2912/Lifemiles)
- [zbloss/airfrance-klm-api](https://github.com/zbloss/airfrance-klm-api)
- [Sekinal/aa_contest](https://github.com/Sekinal/aa_contest), [tszumowski/aa_flight_search_tool](https://github.com/tszumowski/aa_flight_search_tool), [yocontra/aa-rewards](https://github.com/yocontra/aa-rewards)
- [timrogers/ba_rewards](https://github.com/timrogers/ba_rewards), [adamgilman/britishairways-python](https://github.com/adamgilman/britishairways-python)
- [Makoto-winter/Find_ANA_Award_Availability](https://github.com/Makoto-winter/Find_ANA_Award_Availability), [lexande/awardsearch](https://github.com/lexande/awardsearch)
- [Air Canada lawsuit coverage – LoyaltyLobby](https://loyaltylobby.com/2023/10/21/air-canada-sues-award-search-website-seats-aero-in-federal-court-for-computer-fraud-trademark-infringement/), [Proskauer analysis](https://www.proskauer.com/blog/another-web-scraping-dispute-focused-on-travel-data)
- [curl_cffi](https://github.com/lexiforest/curl_cffi)
- [Patchright stealth Playwright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), [Camoufox](https://camoufox.com/stealth/)
- [CapSolver pricing](https://docs.capsolver.com/en/pricing/)
- [BullMQ vs other queues – OneUptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-vs-other-queues/view), [Temporal](https://temporal.io/)
- [Fly.io vs Railway 2026](https://thesoftwarescout.com/fly-io-vs-railway-2026-which-developer-platform-should-you-deploy-on/)
