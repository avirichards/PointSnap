# PointSnap Phase 0 Scaffold — Todo List

**Session goal:** Scaffold Next.js 15 + TS + Tailwind + shadcn/ui + Drizzle + Postgres (Neon) + Redis (Upstash) + Clerk + Stripe; deploy full Phase 1 schema with V1 improvements baked in; seed 13 launch programs + reference data; build cross-program spreadsheet view with mocked JFK→NRT data, SSE streaming API, confidence/freshness badges, and mobile-first responsive table.

**Branch:** `claude/flight-points-platform-AP3St-24G73`

---

## Phase A — Repository scaffold

- [ ] `pnpm create next-app@latest` with TS + Tailwind + App Router + ESLint + src-dir, non-interactive
- [ ] Install runtime deps: `drizzle-orm`, `postgres`, `@neondatabase/serverless`, `@upstash/redis`, `@clerk/nextjs`, `stripe`, `@tanstack/react-table`, `clsx`, `tailwind-merge`, `lucide-react`, `class-variance-authority`, `zod`
- [ ] Install dev deps: `drizzle-kit`, `tsx`, `vitest`, `@types/node`
- [ ] Initialize shadcn/ui (Slate base, Tailwind v4 mode, dark-mode default)
- [ ] Add shadcn components: `button`, `input`, `dropdown-menu`, `select`, `badge`, `toggle`, `tooltip`, `dialog`, `tabs`, `command`, `popover`, `calendar`, `separator`, `skeleton`
- [ ] `next.config.ts`: PWA manifest link, theme-color metadata, optimize-pkg-imports for lucide
- [ ] `public/manifest.webmanifest`, `public/icon-{192,512}.png` placeholders, `apple-touch-icon.png` placeholder
- [ ] Fonts: `next/font` Inter (sans) + JetBrains Mono (mono), wired into Tailwind theme
- [ ] Dark-mode toggle: class strategy, default dark, persist in `localStorage`
- [ ] `.env.local.example` with all required vars (DATABASE_URL, DATABASE_URL_UNPOOLED, UPSTASH_REDIS_REST_URL/TOKEN, CLERK_*, STRIPE_*)
- [ ] `.env.local` with placeholder values so dev server boots without real services
- [ ] `tasks/lessons.md` initialized

## Phase B — Drizzle schema (data backbone)

- [ ] `drizzle.config.ts` pointed at `./src/db/schema/index.ts`, dialect `postgresql`, driver `neon-http`, out `./drizzle/migrations`
- [ ] `src/db/index.ts` — client factory (Neon HTTP for serverless, postgres-js for Node scripts)
- [ ] `src/db/schema/reference.ts` — alliances, airlines, airports, aircraftTypes
- [ ] `src/db/schema/programs.ts` — programs, programPartnerships, transferableCurrencies, transferRatios, transferBonuses, valuations + cabinEnum, pricingModelEnum
- [ ] `src/db/schema/awardCharts.ts` — awardCharts, awardChartZones, zoneMemberships, awardChartCells, awardChartRules
- [ ] `src/db/schema/users.ts` — users, **userSubscriptionTier enum (free|day_pass|pro|elite)**, userWalletBalances, userCardHoldings, userWatchers, userAlerts, userNotificationPrefs
- [ ] `src/db/schema/searches.ts` — searches, searchResults, resultSegments **with `operating_flight_key` deterministic column**, resultCabinPrices, searchResultsHistory
- [ ] `src/db/schema/confidence.ts` — confidenceSignals, shadowConfirmations
- [ ] `src/db/schema/scrapers.ts` — scraperRuns, scraperErrors, bookingOutcomes
- [ ] `src/db/schema/sweetSpots.ts` — sweetSpots **with `tags` JSONB + GIN**
- [ ] `src/db/schema/adminAudit.ts` — adminAuditEvents (actor, entity_type, entity_id, action, diff JSONB, occurred_at)
- [ ] `src/db/schema/index.ts` — re-export all
- [ ] `drizzle-kit generate` runs cleanly (validates compilation, produces migration SQL)
- [ ] Hand-authored follow-up migration `0001_partition_history.sql` for `search_results_history` partitioning (raw SQL since Drizzle can't express it)

## Phase C — Seed data

- [ ] `src/db/seed/index.ts` — orchestrator, idempotent ON CONFLICT upserts
- [ ] `src/db/seed/alliances.ts` — Star, Oneworld, SkyTeam, None
- [ ] `src/db/seed/airlines.ts` — ~40 carriers focused on launch-program partners
- [ ] `src/db/seed/airports.ts` — ~150 hubs (top global, full ~3000 set is overkill for scaffold; flag for v1.1 OpenFlights sync)
- [ ] `src/db/seed/aircraftTypes.ts` — ~30 popular types (777-300ER, A380, A350-900/1000, 787-9/10, A330-300, 747-8, etc.)
- [ ] `src/db/seed/programs.ts` — 13 launch programs with `pricing_model` + `fuel_surcharge_passthrough` from research
- [ ] `src/db/seed/transferables.ts` — 7 currencies (Chase UR, Amex MR, Cap One Venture, Citi TY, Bilt, Marriott, Wells Fargo)
- [ ] `src/db/seed/transferRatios.ts` — full (currency × program) edge matrix
- [ ] `src/db/seed/transferBonuses.ts` — current May 2026 active bonuses (stub: 2-3 entries)
- [ ] `src/db/seed/valuations.ts` — internal cents-per-point for 13 programs + 7 currencies
- [ ] `src/db/seed/awardCharts.ts` — BA distance chart (7 bands × 4 cabins), ANA zone chart (zones + region memberships), CX/LH/AS/VS chart stubs, dynamic stubs for DL/UA-OWN/AA-OWN/TK
- [ ] `src/db/seed/awardChartRules.ts` — one row per program
- [ ] `src/db/seed/programPartnerships.ts` — full matrix with fare-class maps
- [ ] `src/db/seed/sweetSpots.ts` — ~20 launch sweet spots with tags (transcon, premium-cabin, intra-asia, etc.)
- [ ] `src/db/seed/README.md` — what's stubbed vs production-quality, what needs follow-up

## Phase D — Mock search + SSE API

- [ ] `src/lib/itineraryHash.ts` — canonical serializer + SHA256; unit tests in `src/lib/__tests__/itineraryHash.test.ts`
- [ ] `src/lib/effectiveCost.ts` — points × cpp + surcharge − transfer-bonus math; unit tests
- [ ] `src/lib/freshness.ts` — bucket `lastSeenAt` → 'fresh' | 'stale' | 'stale-critical' with color tokens
- [ ] `src/lib/confidence.ts` — score → bucket (Verified/High/Medium/Low/Chart-only) + badge spec
- [ ] `src/lib/features.ts` — tier → feature gate map (paywall infrastructure, all enabled at launch)
- [ ] `src/lib/types.ts` — `SearchResult`, `ResultCabinPrice`, `SearchStreamEvent` (`partial` | `program_done` | `confidence_update` | `complete`)
- [ ] `src/lib/mockSearch.ts` — curated JFK→NRT dataset, ~30 rows across 8 programs, stress patterns:
  - Y-only Spirit-like, J+F-only ANA, all-four EVA, surcharge-heavy BA via partner, surcharge-free Aeroplan, mixed-cabin (W+J), low-confidence outlier (recently moved by carrier), saver vs anytime distinction
- [ ] `src/app/api/search/route.ts` — SSE endpoint streaming results in per-program waves with simulated 200ms–8s latencies; emits `confidence_update` 3-5s after `program_done` to simulate shadow-confirm
- [ ] `src/lib/__tests__/mockSearch.test.ts` — verify mock matches schema shape

## Phase E — Spreadsheet UI

- [ ] `src/app/layout.tsx` — fonts, dark-mode root, theme-color, viewport
- [ ] `src/app/page.tsx` — redirect to /search
- [ ] `src/components/layout/site-header.tsx` — logo, nav, dark-mode toggle, account stub
- [ ] `src/components/search/search-form.tsx` — origin/dest typeahead, depart date, return date toggle, pax, min-cabin, flex selector
- [ ] `src/components/search/use-search-stream.tsx` — hook wrapping `EventSource`, accumulates results, surfaces per-program status (pending/done) + confidence upgrades
- [ ] `src/components/spreadsheet/results-table.tsx` — `@tanstack/react-table`, all-cabins-per-row layout
- [ ] `src/components/spreadsheet/columns.tsx` — Date, Program (logo+text), Operating airline, O→D + stops, Y/W/J/F (cabin-tinted cells), Seats, Surcharge, Duration, Last Seen (color-coded), Confidence (badge)
- [ ] `src/components/spreadsheet/cabin-cell.tsx` — tinted price cell with seats remaining
- [ ] `src/components/spreadsheet/last-seen-badge.tsx` — green ≤5m / yellow ≤1h / red >1h, relative time
- [ ] `src/components/spreadsheet/confidence-badge.tsx` — Verified / High / Medium / Low / Chart-only
- [ ] `src/components/spreadsheet/multi-program-row.tsx` — collapse-by-operating-flight ("1 flight, 3 ways to book") expander
- [ ] `src/components/spreadsheet/table-toolbar.tsx` — compress-rows toggle, filter inputs, multi-column sort indicator
- [ ] `src/app/search/page.tsx` — search shell with form + table, URL-persisted query state
- [ ] Mobile: frozen first two columns via CSS `position: sticky`, horizontal scroll, ~40px row height, ~32px in compress mode

## Phase F — Polish + handoff updates

- [ ] `README.md` — dev quickstart, env vars, scripts
- [ ] `docs/planning/HANDOFF.md` — append session changelog: V1 improvements applied, Korean SKYPASS deferred to Phase 3, calendar overlay tabled for Phase 2 commit, effective-cost module shipped
- [ ] `tasks/lessons.md` — none yet, placeholder
- [ ] Commit per phase, push to `claude/flight-points-platform-AP3St-24G73`
- [ ] Run `pnpm dev` and verify spreadsheet renders the curated dataset end-to-end (cabin tinting, sort, mobile responsive, dark mode)

## Verification

- [ ] `pnpm build` clean (no TS errors, no lint errors)
- [ ] `pnpm test` clean (itineraryHash, effectiveCost, mockSearch shape)
- [ ] Dev server boots, /search renders, SSE stream populates rows in waves
- [ ] Mobile viewport (375px wide) shows frozen first two columns + scrollable rest
- [ ] Dark mode default, toggle works, persists across reload
- [ ] Confidence badges + Last Seen colors visible
- [ ] No console errors

---

## Review (session 2, 2026-05-17)

### What landed
- **All of Phase A** (scaffold + deps + shadcn-style components + dark mode default + fonts + PWA + env)
- **All of Phase B** (full Drizzle schema across 9 files including all V1 improvements; migration 0000 generated cleanly; partition migration 0001 hand-authored)
- **All of Phase C** (alliances, ~40 airlines, ~150 airports, ~40 aircraft, 13 programs, 7 transferables, full ratio matrix, 3 sample bonuses, valuations, 20 sweet spots — all real, idempotent)
- **All of Phase D** (itineraryHash + effectiveCost + freshness + confidence + features + types + mockSearch + SSE API; 15 passing unit tests)
- **All of Phase E** (search form + spreadsheet with all-cabins-per-row, cabin-tinted cells, color-coded Last Seen, confidence badges, multi-program collapse with "+N more ways to book", compact-row toggle, multi-column shift-sort, mobile-responsive sticky first-two-columns, dark mode toggle persists via cookie)
- **All of Phase F** (README, HANDOFF.md changelog with deferral decisions, lessons.md, committed + pushed)

### What's NOT done (intentionally deferred)
- `program_partnerships` full N×M fare-class matrix seed — schema exists, easy fill-in when scrapers need it
- Award charts seed (BA distance / ANA zones / CX zones / VS chart) — schema exists, 1-day fill-in
- `/wallet`, `/admin`, Clerk sign-in/up — UI shells only
- `pnpm db:import-csv` for Seats.aero exports — committed roadmap, v1.1
- OpenFlights airport sync (~150 → ~3000 airports) — committed roadmap, v1.1
- First real scraper (Virgin Atlantic recommended) — next session

### Verification done
- `pnpm test` → 15/15 passing
- `pnpm typecheck` → clean
- `pnpm build` → clean (only ƒ-dynamic routes; expected since /search is interactive)
- `pnpm dev` → /search renders, /api/search streams SSE events end-to-end with real SHA256 hashes and correct operating_flight_keys; per-program waves visible with the expected p95-modeled latencies; BA correctly shows $580 YQ vs Aeroplan $0; cabin-tinted cells render; dark mode default applied via cookie + html class
- All 13 launch programs surface in the per-program status strip in the right order

### Branch state
- `claude/flight-points-platform-AP3St-24G73` — pushed to origin
- Clean working tree
- Single commit: `3feae10 scaffold PointSnap: Next.js 15 + Drizzle Phase 1 schema + cockpit UI`

---

## Session 4 — Virgin Atlantic scraper, day-1 (hard-coded response)

Branch: `claude/vs-scraper-day1-VlteK` (fast-forwarded to main).
Goal: prove the worker → DB → SSE → cockpit pipeline with a hard-coded VS response, verified on the Vercel preview URL.

- [ ] **Commit 1 — Worker skeleton.** `python-workers/` with `pyproject.toml` (httpx, psycopg[binary], fastapi, uvicorn, python-dotenv; skip patchright/playwright for day 1), README, .gitignore, package init files, `common/types.py`, empty `vs/` and `serve.py` placeholders, `Dockerfile` + `fly.toml`.
- [ ] **Commit 2 — VS plugin stub.** `python-workers/vs/search.py` exporting `async def search(origin, dest, date, cabin_filter) -> list[NormalizedResult]`. For JFK→LHR, return one DL-operated A359 J row at 90k VS miles + one Y row. Other O&D pairs return `[]`. Unit test for shape.
- [ ] **Commit 3 — DB writeback.** `python-workers/common/db.py` writing to `searches` + `search_results` (ON CONFLICT itin_hash/program/date) + `result_segments` + `result_cabin_prices`. `common/hash.py` Python port of `itineraryHash` matching JS canonical form bit-for-bit. Unit test confirms hash parity with JS fixture.
- [ ] **Commit 4 — HTTP bridge.** `python-workers/serve.py` FastAPI app: `GET /search?program=VS_FLYING_CLUB&origin=JFK&dest=LHR&date=YYYY-MM-DD` → run plugin → write to DB → return JSON list of `SearchResultRow`. Local smoke: `uvicorn serve:app --port 8001 && curl …`.
- [ ] **Commit 5 — Route wiring + Vercel preview verify.** `src/app/api/search/route.ts` swaps the `VS_FLYING_CLUB` mock emission for an HTTP call to `process.env.PYTHON_WORKER_URL`; falls back to mock if unset. All 12 other programs stay simulated. Deploy worker to Fly.io, set `PYTHON_WORKER_URL` in Vercel preview env, verify `/search` on the preview URL shows a real VS row alongside 12 sim rows.

### Open items needing user input mid-flight
- Neon `DATABASE_URL` for local dev (gitignored; previous session had it in `.env.local`). Worker can run plugin-only without DB; DB writeback test only happens on Fly.io.
- Fly.io API token + region preference for worker deployment.
- After Fly.io deploy, user sets `PYTHON_WORKER_URL` in Vercel preview-env vars scoped to this branch.

### Out of scope (session 5+)
Real Patchright scrape, IPRoyal proxies, CapSolver, other 12 programs, BullMQ queue.

---

## Review (session 3, 2026-05-17 — Neon live)

### What landed
- Real Neon URL written to `.env.local` (gitignored).
- Network policy in this env still blocks TCP 5432, so we applied schema + seed via the Neon HTTPS driver instead of `psql`. `scripts/applyBootstrap.ts` (already on branch) ran 153 statements cleanly. Tracked separately: revisit `psql` workflow if/when 5432 egress is opened.
- `pnpm db:bootstrap` → 39 base tables in `public` (33 schema tables + 6 monthly partitions `search_results_history_2026_02` … `_2026_07`).
- `pnpm db:seed` → idempotent. Final counts: programs=13, airports=132, airlines=39, sweet_spots=20, transfer_ratios=48. (Airports/airlines/ratios are a touch below the ~150/40/49 sketched in the handoff because the seed files were curated tighter; not a defect — schema slots are still in place for the v1.1 OpenFlights sync.)
- `pnpm typecheck && pnpm test && pnpm build` — all green. 15/15 unit tests pass. Build emits the 5 expected ƒ-dynamic routes (`/`, `/api/admin/seed`, `/api/search`, `/search`, `/_not-found`).
- Small fix: both `applyBootstrap.ts` and `src/db/seed/index.ts` now load env from `.env.local` first via `src/db/seed/_loadEnv.ts` (plain `dotenv/config` only reads `.env`). Required so the scripts work outside the Next runtime.

### Verification done
- Schema: `information_schema.tables` query confirms all 33 base tables + 6 partitions.
- Counts: verified via Neon HTTPS query (numbers above).
- App health: typecheck + test + build all clean.

### Not yet done (separate user steps)
- Vercel project import + env-var paste (instructions delivered in chat).
- First production deploy + `/search` smoke test + `/api/admin/seed?token=…` re-confirm (idempotent no-op, so safe).

### Suggested next-session targets (in priority order)
1. First real scraper — **Virgin Atlantic** (1/5 difficulty, no auth, light captcha, validates the pipeline). Python project skeleton + Patchright + IPRoyal trial proxies + result writeback to Postgres via the existing schema. 3-5 days.
2. CSV importer (`pnpm db:import-csv`) so real data is available before scraper-2 ships.
3. Award chart full seeds for BA + ANA + CX + VS so the "Chart-only" confidence badge has real chart data to fall back to.
4. `/wallet` page so the wallet-aware sort gets a UI surface to test.
5. Clerk sign-in / sign-up + `/admin` shell with the audit log feed.
