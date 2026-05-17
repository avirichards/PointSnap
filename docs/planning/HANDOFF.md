# PointSnap — Conversation Handoff

**Date:** 2026-05-17
**Branch:** `claude/flight-points-platform-AP3St`
**Status:** Planning complete, ready to scaffold

---

## TL;DR

PointSnap is a new accuracy-first, enthusiast-focused points/miles flight search platform that aims to be the best tool on the market by combining Seats.aero's spreadsheet UX with point.me-level coverage and accuracy validation no competitor offers. Greenfield: this branch contains planning artifacts only — no application code yet.

Four parallel research agents have completed (competitive teardown, scraper architecture, Phase 1 data model, Cathay/LH program research). All four reports are preserved as separate files in `docs/planning/`. The next step is to scaffold the Next.js + Drizzle + Postgres + Redis + auth skeleton with the Phase 1 schema.

---

## Product Vision

PointSnap is a "points cockpit" for the FlyerTalk / r/awardtravel / Frequent Miler / OMAAT crowd. The product owner is obsessed with points and getting the best deal for flights. The two top frustrations with existing tools that PointSnap solves:

1. **No competitor covers every program.** Seats.aero is missing BA Avios, ANA, Cathay, LifeMiles, Korean SKYPASS — five of the most-loved enthusiast programs. PointSnap launches with all but Korean.
2. **None is 100% accurate.** Phantom availability plagues every cached tool. PointSnap mitigates with shadow-confirm bookability verification on top results, multi-source cross-checking, and transparent confidence scoring per result.

The favorite competitor UX is **Seats.aero's spreadsheet view with all cabin classes shown simultaneously** — sortable, dense, multi-column shift-sort, "Last Seen" timestamp. PointSnap replicates this and improves on it (bolder cabin tinting, multi-program collapse-by-flight, confidence badges in the table, mobile-first execution).

## Product Principles

1. **Truth over polish.** Show confidence, freshness, surcharges, partner pricing differences explicitly.
2. **Every result is actionable.** Deep links pre-filled where bookable online; phone-booking scripts for offline programs.
3. **The whole award ecosystem is one search.** Operating airline, ticketing program, transfer path, surcharges, routing rules — surfaced together.
4. **Historical memory is a feature.** Every search snapshot lives forever; trends, devaluations, sweet spots emerge from it.
5. **The user's wallet is a first-class concept.** Filter and price everything against the points they actually have.

---

## Locked Decisions

### Launch programs (13)

Coverage-gap focus, filling every gap Seats.aero has:

| # | Program | Code | Difficulty (1-5) | Build week | Notes |
|---|---|---|---|---|---|
| 1 | United MileagePlus | `UA_MP` | 3 | Week 6 | Akamai; mostly dynamic |
| 2 | Air Canada Aeroplan | `AC_AEROPLAN` | 5 (legal) | Week 9-10 | **Active litigation vs Seats.aero**; ship with hygiene |
| 3 | Alaska Mileage Plan | `AS_MILEAGEPLAN` | 2 | Week 4 | Easy; partner charts |
| 4 | American AAdvantage | `AA_AADVANTAGE` | 4 | Week 7-8 | Shape Security |
| 5 | Delta SkyMiles | `DL_SKYMILES` | 4 | Week 7-8 | DataDome; fully dynamic |
| 6 | British Airways Avios | `BA_AVIOS` | 2 | Week 4 | Distance-based chart |
| 7 | Air France/KLM Flying Blue | `AF_FLYINGBLUE` | 2 | Week 5 | Imperva; mostly chart |
| 8 | Lufthansa Miles & More | `LH_MILES_MORE` | 5 | **DEFERRED v1.1** | Partner-inferred at launch |
| 9 | ANA Mileage Club | `NH_ANA` | 3 | Week 6 | Login required; geo blocks |
| 10 | Cathay (Asia Miles) | `CX_CATHAY` | 4 | Week 7-9 | Akamai bootstrap-amortise |
| 11 | Avianca LifeMiles | `AV_LIFEMILES` | 2 | Week 5 | LATAM IPs help |
| 12 | Turkish Miles&Smiles | `TK_MILES_SMILES` | 3 | Week 6 | Phantom-availability prone |
| 13 | Virgin Atlantic Flying Club | `VS_FLYING_CLUB` | 1 | Week 3 | Easiest; validates pipeline |

### Tech stack

**Frontend / App:**
- Next.js 15 + TypeScript + Tailwind + shadcn/ui
- Clerk for auth
- Stripe for billing (wired but inactive at launch — built free)

**Backend / Data:**
- Postgres (Neon, serverless) — durable store
- Drizzle ORM (TypeScript)
- Upstash Redis — hot cache
- ClickHouse — raw observation logs + analytics (Phase 2)

**Scraper / Live Pricing:**
- Python 3.12 + `curl_cffi` for API-replay (~8 of 12 launch programs)
- Patchright (Playwright fork, ~67% headless-detection reduction) for behavioral-biometric programs
- Camoufox (Firefox fork, 0% headless detection) as break-glass fallback
- BullMQ on Redis Cluster for per-program fan-out queues
- Temporal for shadow-confirm sagas (durable multi-step verification)
- IPRoyal residential proxies primary, Bright Data fallback
- CapSolver primary captcha vendor, 2Captcha fallback
- HashiCorp Vault for account secrets
- Fly.io Machines with per-program regional pinning (Phase 1)
- ECS Fargate (Phase 2 when >100K searches/day)

**Observability:** OpenTelemetry → Tempo + Prometheus + Loki + Grafana

### Pricing — built free, paywall hooks now, enabled later

- **At launch:** everything free
- **Paywall infrastructure built but disabled** in code (feature flag)
- **Future tiers** when activated:
  - Free: 60-day window, basic filters, single-program results
  - $4.99 day pass (AwardLogic-style underdefended price point)
  - $9.99/mo Pro / ~$89/yr Pro Annual
  - $19.99/mo Elite — GDS fare-class inventory, multi-origin, public API, 330-day search

### Risk decisions

- **Aeroplan: ship day 1.** Operational hygiene baked in: no AC trademarks in UI, disposable accounts only, stricter rate limits, ready kill switch. Air Canada lost the PI motion vs Seats.aero; case ongoing. User explicitly accepted this risk.
- **Lufthansa M&M direct scraper deferred to v1.1.** Launch with LH coverage via UA, AC, ANA, AV at partner-chart prices. Reasons: 7,000-mile minimum account balance ($6-10K one-time capex), highest legal posture of any program, Akamai is the most aggressive stack in airline-land, marginal user value of direct M&M over partner inference is moderate.

---

## Feature Inventory (the Enthusiast Cockpit)

### Search & Results
- Origin/dest/date/pax/cabin with flex calendar (±3 / week / month / "any time in 11 months")
- Live fanout to every program that can ticket the operating airline
- **All cabins (Y/W/J/F) per flight per program in a single row-set** (Seats.aero paradigm, native to schema)
- Cross-program comparison view, sortable by effective cost
- Multi-program collapse-by-flight ("LH 401: cheapest 60K via Aeroplan, +2 more programs")
- Mixed-cabin engine (per-program formulas: PRORATE_DISTANCE, HIGHEST_CABIN, PER_SEGMENT)
- Stopover / open-jaw wizard
- Routing playground (5th-freedom flights, allowed routings per program)
- Aircraft / product filters (A380, Emirates Apartments, Qatar Qsuite, ANA The Room, LH F throne)
- Family / group availability solver
- Hidden city awareness (warning + opt-in display)
- Saver vs anytime vs dynamic clearly labeled per result

### Wallet & Transfer Optimization
- Manual entry of balances across all transferable currencies (Chase UR, Amex MR, Cap1, Citi TY, Bilt, Marriott, Wells Fargo) + direct airline programs
- Transfer-path optimizer with active bonuses
- Active transfer bonus tracker (current + historical)
- Expiring points warnings
- "What would I have left?" post-redemption wallet preview

### Sweet Spot Intelligence
- Curated sweet spot library (~50 launch entries) with live-availability checking
- Daily premium-cabin leaderboard (cheapest current F and J worldwide, refreshed hourly)
- Sweet spot finder by wallet ("given my balances, what are the best redemptions right now?")

### Alerts & Monitoring
- Route watchers (any program, date or date range, cabin, max miles/surcharge)
- Drop alerts when price falls below threshold
- Availability prediction ("LH typically releases J ~14 days out")
- Devaluation watch
- Mistake fare / award glitch firehose (curated)

### Historical Data & Analytics
- Price history per (route, program, cabin)
- Availability heatmap
- Devaluation timeline per program
- "Best week to fly" based on historical low-points dates
- Per-program reliability score from booking outcomes feedback

### Earning & Cards
- Card recommender ("to book this redemption you need X more UR; here are current welcome bonuses")
- Welcome bonus tracker with historical highs
- Earning calculator per-spend / per-category / per-card

### Booking Handoff
- Deep links with maximum pre-fill
- Phone-booking scripts for offline programs (LifeMiles, ANA partner, etc.)
- Bookability confidence badges per result (Verified / High / Medium / Low / Chart-only)

### Power User Tools
- Browser extension overlaying PointSnap data on airline.com searches
- API access (paid Elite tier, post-launch)
- CSV / JSON export of any search
- Bulk route comparison
- Dark mode + dense table UI as default

### Community (Phase 3+)
- Sweet spot wiki with edit history
- Trip reports linked to actual bookings
- Per-program rule corrections crowdsourced
- Mistake fare submissions

---

## Phased Build Plan

### Phase 0 — Foundation (week 1-2)
- Monorepo scaffold: Next.js 15 + TS + Tailwind + shadcn/ui + Drizzle + Postgres + Redis + Clerk + Stripe
- Phase 1 data model deployed (full schema, see `04-data-model.md`)
- Internal admin UI for editing chart data, sweet spots, transfer bonuses
- Seed: 13 launch programs with metadata, partnerships, transfer ratios, valuations
- Reference data: top ~3000 airports, ~80 airlines, ~60 aircraft types

### Phase 1 — MVP enthusiast search (week 3-10)
- Scraper pipeline scaffold + plugin protocol
- Build programs in difficulty order: VS (Week 3, validates pipeline) → AS, BA, KrisFlyer-style (Week 4) → AV, AF (Week 5) → UA, TK, NH (Week 6) → AA, DL (Week 7-8) → CX (Week 7-9) → AC (Week 9-10, last, after legal review)
- Cross-program comparison view with all-cabins spreadsheet UX
- Flex date calendar
- Wallet entry + transfer-path optimizer
- Confidence scoring + shadow-confirm for top 3 results
- Deep links + phone scripts
- Sweet spot library (~50 curated entries)
- Historical snapshots starting day one
- LH coverage via partner programs (UA/AC/NH/AV at partner-chart prices)

### Phase 2 — The cockpit (week 11-20)
- Route watchers + alert engine (email, push, SMS)
- Premium-cabin leaderboard
- Stopover / open-jaw wizard
- Aircraft / product filters
- Browser extension v1
- LH M&M direct scraper (v1.1)
- 4-tier paywall enabled

### Phase 3 — Intelligence layer (week 21-32)
- Availability prediction ML model
- Devaluation tracker + impact analysis
- Card recommender + welcome bonus tracker
- Family/group availability solver
- Routing playground with 5th-freedom suggestions
- Mistake fare firehose
- 14 more programs (total 27)

### Phase 4 — Community + API + scale (month 8+)
- Sweet spot wiki
- Public API (paid Elite tier)
- Trip reports
- Remaining long-tail programs
- Native mobile app

---

## Data Model Highlights

See `04-data-model.md` for the full Drizzle schema. Architectural backbone:

- **Operating flight = canonical unit.** Same physical flight stored once; each ticketing program references it via `search_results` rows. UA 79 ticketed via UA/AC/NH/AV = four `search_results` rows pointing at distinct `result_segments` sets (no cross-program segment sharing — different scrapers observe slightly different metadata).
- **`result_cabin_prices` is the spreadsheet table.** One row per `(search_result, cabin)`. Flight with Y+J+F open = 3 rows. Hot query joins this and pivots in API layer = all cabins per flight per program in one indexed lookup. Cabin enum ordered `Y < W < J < F` so `cabin >= 'J'` is a single range scan.
- **Unified award chart model.** One `award_chart_cells` table covers zone×zone (ANA), region (LH), distance bands (BA Avios), and dynamic (DL — chart row with zero cells, lookup short-circuits to scraped price).
- **History is append-only, monthly-partitioned.** `search_results_history` partitioned by `observed_at`, JSONB-flattened cabin prices = one row per snapshot regardless of cabin count. 36-month rolling retention.
- **Confidence engine is event-sourced.** `confidence_signals` log per-result signal contributions (freshness, multi-source agreement, shadow-confirm outcome, program reliability, user reports, anomalies).
- **Sweet spots first-class.** JSONB origin/dest patterns with GIN indexes, wallet-gated queries built into index design.

**Storage projection:** ~12 programs × ~100k itineraries/day × forever = 400M+ history rows in year one. Monthly partition pruning keeps this tractable; proxy/scraping costs dwarf storage costs.

---

## Scraper Architecture Highlights

See `03-scraper-architecture.md` for the full design. Key topology:

- Per-program isolated worker pools (one blocked program ≠ all blocked)
- Plugin protocol: every program implements `async def search(origin, dest, date, cabin_filter) -> list[NormalizedFlight]`
- BullMQ priority lanes: `paid-user-live` > `free-user-live` > `cache-warming` > `shadow-confirm`
- Per-program proxy isolation, geo-targeted (LATAM for LifeMiles, JP for ANA, DE for LH-via-partners, etc.)
- ~135 account inventory across auth-required programs at launch (Aeroplan 40+, Turkish 30, Cathay 30-50, ANA 15, Singapore 10, etc.)
- Shadow-confirm engine on Temporal (durable saga: load search → reprice → seat-select → fare-quote → abandon before payment)
- Per-program TTLs calibrated to inventory volatility: dynamic programs 60-120s, chart programs 5-30min
- Sub-15s SLA met by running shadow-confirms async via Temporal and streaming via SSE
- **Cost model:** $0.072/search at 100/day → $0.0074/search at 1M/day. At 10K/day (realistic Year 1) = ~$5.4K/mo. At 1M/day = ~$220K/mo.

---

## Competitive Insights (Key Takeaways)

See `02-competitive-teardown.md` for the full report.

- **Seats.aero coverage gaps**: missing BA Avios, ANA, Cathay, LifeMiles, Korean SKYPASS. PointSnap covers all but Korean at launch.
- **PointsYeah won NerdWallet's 2026 best-tool award.** Steal: cash-vs-points calendar overlay, premium-cabin % indicator, multi-origin/multi-destination, "Daydream Explorer" anywhere + activity-tag picker.
- **Every competitor's mobile app is bad.** Seats.aero's is roasted in App Store reviews; Roame's exists but shallow; AwardTool has no mobile. Mobile-first execution is the most underdefended high-value wedge.
- **Point.me's killer feature**: step-by-step transfer + booking instructions with screenshots; transfer-bonus-aware effective cost ("60K Aeroplan = 48K Amex MR after 25% bonus"). Replicate both.
- **Roame's wallet-input filter** ("only show me what I can book"). Nobody combines this with transfer-bonus math. We will.
- **AwardLogic's $4.99 day pass** = underdefended pricing tier. Adopt when paywall activates.
- **ExpertFlyer's GDS fare-class inventory** ("J7" = 7 J seats for sale). Reserve for Elite tier.
- **Air Canada is suing Seats.aero (CFAA + Lanham Act, D. Del., Oct 2023, PI denied, case ongoing).** Real risk; Aeroplan operational hygiene exists for this reason.

### Seats.aero UX spec to replicate (and improve)

- Sticky-header table, 36-40px row height
- Columns: `Date | Program | Operating Airline | O→D | Y | W | J | F | Seats | Taxes | Duration | Last Seen | Direct`
- Multi-column shift-sort
- Inline column filters under headers
- Sidebar/top filter bar (departure airports, arrival airports, airlines, max points, days of week, max stops, cabin checkboxes, direct only, fee max)
- Cabin tinting (Y=neutral, W=light, J=stronger, F=accent/gold) — **make bolder than Seats.aero**
- Calendar/Explore view drops into spreadsheet pre-filtered to chosen date
- Mobile: collapse to card view with cabin chips stacked horizontally — **PointSnap should ship a real mobile table view with frozen first two columns, not just a degraded card view**

### Top product gaps to exploit

1. Best mobile award-search app, period
2. Phantom-availability scoring visible per row
3. Multi-ticketing-program collapse + expand on the same operating flight
4. Wallet engine with transfer-bonus math fused into the spreadsheet
5. Coverage of programs Seats.aero is missing
6. Stopover + open-jaw engineering
7. Member-only availability awareness
8. Day-pass pricing tier
9. Static-chart "should cost" reference layer fused with live results
10. Email/inbox itinerary import + balance + expiration tracking (AwardWallet replacement built-in)

---

## Cathay & Lufthansa Research (Key Takeaways)

See `05-cathay-lufthansa-research.md` for the full report.

**Cathay Asia Miles (4/5 difficulty, 3-week build, ships at launch):**
- Akamai bootstrap-then-amortise captcha (~1 per 20 calls)
- 30-50 accounts with **unique mobile numbers** (binding constraint — no VoIP per community reports)
- Account warmup: standard ($0 capex beyond SIM pool)
- Sweet spots: CX F HKG-JFK at 110-125K, JL F at T-360, intra-Asia J 30-50K RT
- Recommended stack: Patchright bootstrap + curl_cffi replay within 20-call checksum window

**Lufthansa Miles & More (5/5 difficulty — hardest of all 14, deferred to v1.1):**
- Akamai (case-studied by Akamai themselves) with multi-stack challenges per search
- **7,000-mile minimum account balance to query** → ~$210/account × 20-30 accounts = $6-10K one-time capex
- p95 latency target 20-40s per search (3-5x slower than everything else)
- 1-3 captcha challenges per search routine
- T-2-to-T-4 partner-F release window (tightened from historical T-14)
- LH/LX/OS own-metal switched to dynamic pricing 3 June 2025
- Recommended stack: full Patchright with behavioral priming, Camoufox secondary, IPRoyal DE/AT/CH residential
- **Launch posture: ship LH coverage via partner programs at partner-chart prices; direct M&M scraper post-launch v1.1**

---

## Open Questions / Decisions Still to Make

1. **Commercial partnership with Seats.aero / Roame** for fallback inventory vs. scrape everything ourselves? Defer; decide at month 3.
2. **Public API tier** at launch vs Elite-tier only? Defer; decide at month 6.
3. **Korean SKYPASS** — was on the Seats.aero gap list but not in the launch 13. Add to Phase 3 expansion?
4. **Singapore KrisFlyer** — dropped from launch list in favor of Cathay. Reassess for v1.1?
5. **Mobile app** — native iOS/Android or PWA at launch? Recommendation: PWA at launch (faster shipping), native in Phase 3.
6. **Legal review** for Aeroplan and AA before going live? Strongly recommend, even though decision is "ship day 1."

---

## Critical Files

- `docs/planning/HANDOFF.md` ← you are here
- `docs/planning/02-competitive-teardown.md` — full agent report on every major competitor
- `docs/planning/03-scraper-architecture.md` — full scraper system design with per-program intelligence matrix
- `docs/planning/04-data-model.md` — full Drizzle schema + ERD + partitioning + index design
- `docs/planning/05-cathay-lufthansa-research.md` — per-program research for CX + LH

---

## Repo State

- Branch: `claude/flight-points-platform-AP3St`
- Commits: planning docs only (no application code yet)
- App code: none — scaffolding is the next step
- Remote: configured (`origin` → GitHub `avirichards/PointSnap`)

---

## Next Session — What To Do

1. **Invoke the `using-superpowers` skill** (user reports it should be installed in their environment).
2. **Read `docs/planning/HANDOFF.md` and the four supporting docs** to load full context.
3. **Scaffold the application skeleton:**
   - `pnpm create next-app@latest` with TypeScript + Tailwind + App Router + ESLint + src-dir
   - Add shadcn/ui (initialize with Slate base color), Drizzle, postgres-js, Neon serverless driver, Upstash Redis client, Clerk, Stripe SDK
   - Set up `src/db/schema/` with the full Phase 1 schema from `04-data-model.md` (reference, programs, awardCharts, users, searches, confidence, scrapers, sweetSpots)
   - Set up `drizzle.config.ts` pointing at Neon (env vars: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`)
   - Create `src/db/seed/` with the 13 launch programs metadata, partnerships, transfer ratios, valuations
   - Create the internal admin UI shell at `/admin` for editing programs, partnerships, sweet spots, transfer bonuses
   - Stub the scraper plugin protocol in `workers/programs/_protocol.py` (Python service, separate deployment)
4. **First feature to build:** the cross-program comparison view (the Seats.aero-style spreadsheet) backed by mocked data — get the UX right before plumbing scrapers.

---

## Prompt to Start the New Conversation

Copy-paste this into a fresh Claude Code session on the same branch:

> Continue the PointSnap project. First, invoke the `using-superpowers` skill. Then read `docs/planning/HANDOFF.md` and all supporting files in `docs/planning/` to load full context. We're on branch `claude/flight-points-platform-AP3St`. The product spec, competitive teardown, scraper architecture, Phase 1 data model, and Cathay/Lufthansa research are all complete and committed. The next step is to scaffold the Next.js 15 + TypeScript + Tailwind + shadcn/ui + Drizzle + Postgres (Neon) + Redis (Upstash) + Clerk + Stripe skeleton with the full Phase 1 schema and seed data for the 13 launch programs, then build the cross-program spreadsheet comparison view (Seats.aero-style, all-cabins-per-row) backed by mocked data. Develop on the existing branch.
