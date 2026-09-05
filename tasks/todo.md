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

- [x] **Commit 1 — Worker skeleton.** `python-workers/` scaffolded with `pyproject.toml`, README, Dockerfile, fly.toml, `common/types.py` dataclasses mirroring SearchResultRow.
- [x] **Commit 2 — VS plugin stub.** `vs/search.py` returns hard-coded JFK→LHR result on VS3 (B789), Y + J cabin prices. Other O&D returns `[]`. 3 tests green.
- [x] **Commit 3 — DB writeback.** `common/hash.py` Python port verified bit-for-bit equal to JS canonical hash. `common/db.py` writes search_results / result_segments / result_cabin_prices via psycopg with ON CONFLICT idempotency. Skipped when `PYTHONWORKERS_SKIP_DB=1` (or no DATABASE_URL).
- [x] **Commit 4 — HTTP bridge.** `serve.py` FastAPI app: `GET /search?program=…&origin=…&dest=…&date=…` runs the plugin, persists, returns camelCase SearchResultRow JSON ready for SSE forwarding. 11/11 pytest green.
- [x] **Commit 5 — Route wiring.** `src/app/api/search/route.ts` calls `${PYTHON_WORKER_URL}/search` for VS when env var is set; mock fallback on missing var or error; shadow-confirm skips worker-backed programs. typecheck + build + 15/15 vitest green. Smoke-tested locally end-to-end (uvicorn + next dev).
- [ ] **Deploy worker to Fly.io + flip Vercel env var + verify on Vercel preview.** **Deferred to session 5+** (when real Patchright scraping needs a long-running host). For day-1, the hard-coded VS response now lives inline in `src/app/api/search/route.ts` — same data, no Python middleman, no Fly dependency. The `python-workers/` code stays in the repo as the session-5 template.

### Status at end of session 4 (post-cleanup, Supabase live, Fly deferred)
- 10 commits pushed to `origin/claude/vs-scraper-day1-VlteK` (DB migration, UI pages, inline VS, Fly removal).
- **Database**: migrated Neon → Supabase. Project `cgoyetahoktqupkcvrli`, region us-east-1. 39 tables + 6 partitions + 108 indexes + 1 extension + seeds (4 alliances, 39 airlines, 132 airports, 40 aircraft, 13 programs, 7 currencies, 48 ratios, 6 bonuses, 40 valuations, 20 sweet spots).
- **JS driver**: postgres-js + drizzle-orm/postgres-js (replaces neon-http). Works against both Neon (legacy) and Supabase; the cockpit picks up the env var.
- **Cockpit**: `/api/search` now ships VS_FLYING_CLUB JFK→LHR data inline (Y at 10k+$420, J at 47.5k+$720, VS3 B789 segment). Other 12 programs continue from mock dataset. Real Patchright scrape replaces the inline hardcode in session 5+.
- **New UI**: `/wallet` (lists 7 transferable currencies from DB), `/admin` (audit log feed), `/sign-in`, `/sign-up` (Clerk-detect placeholder forms). Header nav enabled for all.
- **Fly.io**: app + tokens + workflow + secret all deleted in cleanup. python-workers/ code stays in the repo for session 5 redeployment.
- **Connectors saved** (active in next session): Supabase MCP + Vercel MCP.
- **Vercel env var**: user updated `DATABASE_URL` to the Supabase connection string and redeployed.

### Next-session pickup order
1. **Verify on Vercel preview**: open `/search`, search JFK→LHR for any date, confirm VS Flying Club row shows ~10k miles Y + ~47.5k miles J. Then open `/wallet`, confirm the 7 currencies render from Supabase (Chase UR, Amex MR, etc.).
2. **HIG polish pass** on the cockpit and new pages using `apple-hig` skill — likely tweaks to mobile breakpoint behavior, touch-target sizes, dark-mode contrast on freshness/confidence badges.
3. **OpenFlights airport sync** (132 → ~3000 airports). Improves search-form autocomplete coverage.
4. **Begin session 5** (real Patchright scrape for VS) only on explicit ask. Needs IPRoyal proxies + CapSolver paid signups first.

### Things still pending user action
- Rotate Supabase DB password, service_role key, and PAT (all pasted into chat earlier — transcript security).
- Old Neon project: delete it once Vercel preview is confirmed reading from Supabase (then we no longer pay for Neon).

### Out of scope (later sessions)
Real Patchright scrape, IPRoyal proxies, CapSolver, BullMQ queue, shadow-confirm engine on Temporal, browser extension, paywall enablement, Lufthansa direct scraper (v1.1).

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

---

## Session 5 — Render-service migration (Bright Data CDP)

**Branch:** `claude/review-scraper-strategy-CXHmM`

**Supersedes** the speculative "Session 5: real Patchright scrape for VS, needs IPRoyal + CapSolver" guidance from Session 4. VS already works on httpx+IPRoyal. The actual Session 5 problem is the **other 11 plugins** stuck behind Akamai.

### Goal
Replace the failing `IPRoyal + ScraperAPI` transport for the 11 currently-blocked plugins with **Bright Data Scraping Browser** (CDP-compatible hosted Chromium). Unblock AA, AC, UA, DL, BA, AF, LH, TK, NH, CX, AV. Keep VS, AS unchanged (httpx + IPRoyal works).

### Architecture decision
Bright Data Scraping Browser is a hosted Chromium speaking CDP. Patchright's existing `async_playwright().chromium.connect_over_cdp(WSS_URL)` connects to it instead of launching local Chromium. Bright Data handles proxy + Akamai/Imperva/DataDome bypass server-side.

**The plugin contract doesn't change** — `browser_page()` still yields a `page` object; downstream code (warmup → login → goto → XHR capture) is identical because the CDP-attached browser behaves like a local one. This is a transport swap, not a refactor.

**Why Bright Data over ZenRows** (market research, 2026-05-18):
- ZenRows: $69/mo minimum, 70% success rate on independent benchmarks, no pay-as-you-go.
- Bright Data Scraping Browser: $8/GB pay-as-you-go, no minimum, CDP-compatible, documented Akamai/Imperva/Cloudflare bypass, $500 deposit-match on new accounts.
- Fallback if BD fails on AA/DL/UA: **Scrapfly** ($30/mo hard-capped, 97% Akamai bypass in Scrapeway benchmark, also CDP-compatible, failed requests free).

### Cost model
~$8/GB pay-as-you-go. With heavy-resource blocking (images/css/fonts/media), each search costs ~1-3 MB → $0.008-0.024/search. Personal volume 100-500 searches/mo → $1-12/mo. Set $25/mo soft cap in Bright Data dashboard.

### Tech stack
Patchright `connect_over_cdp()`, Bright Data Scraping Browser (WSS), env-driven config (`BRIGHTDATA_WSS_URL`), pytest for smoke tests, existing per-plugin `search()` unchanged.

### Files to create / modify
- **Modify:** `python-workers/common/browser.py` — add `use_brightdata` branch in `browser_page()`
- **Modify:** `python-workers/serve.py` — add `?provider=brightdata` to `/diag/airline` endpoint
- **Modify:** `python-workers/.env.example` — add `BRIGHTDATA_WSS_URL`
- **Modify:** each blocked plugin's `search.py` (11 files) — swap `use_scraperapi=True` → `use_brightdata=True`
- **Create:** `python-workers/tests/test_browser_brightdata.py` — smoke test for CDP path
- **Create:** `tasks/captured-responses/` — directory for raw XHR samples per plugin
- **Create:** `tasks/kb-drafts/all-11-programs-live.md` — KB draft (per CLAUDE.md rule 10)

---

### Phase 0 — Account setup (USER ACTION REQUIRED — gates Phase 1)

- [ ] **0.1** User signs up for Bright Data: https://brightdata.com → create Scraping Browser zone → copy WSS URL (format `wss://brd-customer-<ID>-zone-<ZONE>:<PASSWORD>@brd.superproxy.io:9222`).
- [ ] **0.2** User adds to `.env.local`: `BRIGHTDATA_WSS_URL="wss://..."`
- [ ] **0.3** User pastes WSS URL into chat so Claude can mirror it into Fly secrets when worker is redeployed: `fly secrets set BRIGHTDATA_WSS_URL="wss://..." -a pointsnap-worker`
- [ ] **0.4** User sets Bright Data soft cap at $25/mo (Account → Billing → Spending limits) to protect against runaway searches.
- [ ] **0.5** User confirms ready → Claude proceeds to Phase 1.

### Phase 1 — Add CDP path to `browser_page()`

- [ ] **1.1 Write failing smoke test**

Create `python-workers/tests/test_browser_brightdata.py`:

```python
"""Smoke test that browser_page(use_brightdata=True) connects to Bright Data
Scraping Browser via CDP and returns a usable page. Skips if BRIGHTDATA_WSS_URL
is not configured."""
import os
import pytest
from common.browser import browser_page


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("BRIGHTDATA_WSS_URL"),
    reason="BRIGHTDATA_WSS_URL not configured",
)
async def test_brightdata_loads_httpbin():
    async with browser_page(use_brightdata=True, timeout_ms=30_000) as page:
        await page.goto("https://httpbin.org/headers", wait_until="domcontentloaded")
        body = await page.content()
        assert '"User-Agent"' in body, "httpbin.org/headers should return JSON with UA"


@pytest.mark.asyncio
async def test_brightdata_requires_env_var(monkeypatch):
    monkeypatch.delenv("BRIGHTDATA_WSS_URL", raising=False)
    with pytest.raises(RuntimeError, match="BRIGHTDATA_WSS_URL"):
        async with browser_page(use_brightdata=True):
            pass
```

- [ ] **1.2 Run test, expect failure**

```bash
cd python-workers && pytest tests/test_browser_brightdata.py -v
```

Expected: both tests fail/error because `use_brightdata` kwarg doesn't exist on `browser_page()`.

- [ ] **1.3 Implement `use_brightdata` branch**

Edit `python-workers/common/browser.py`. Add `use_brightdata: bool = False` to the kwargs of `browser_page()` (around line 102). Inside `async with async_playwright() as pw:` (line 141), add an early-return branch BEFORE the existing local-Chromium logic:

```python
async with async_playwright() as pw:
    if use_brightdata:
        wss_url = os.environ.get("BRIGHTDATA_WSS_URL")
        if not wss_url:
            raise RuntimeError("BRIGHTDATA_WSS_URL env var not configured")
        # Connect to Bright Data Scraping Browser via CDP. They handle the
        # proxy + Akamai/Imperva/DataDome bypass server-side. Bandwidth-
        # billed (~$8/GB); always block heavy resources to keep ~$5-15/mo
        # at personal volume.
        browser = await pw.chromium.connect_over_cdp(wss_url)
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1366, "height": 768},
            locale="en-US",
        )
        page = await ctx.new_page()
        page.set_default_timeout(timeout_ms)

        async def _block_heavy(route):
            if route.request.resource_type in (
                "image", "stylesheet", "font", "media", "manifest"
            ):
                await route.abort()
            else:
                await route.continue_()
        await page.route("**/*", _block_heavy)

        try:
            yield page
        finally:
            try:
                await ctx.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                await browser.close()
            except Exception:  # noqa: BLE001
                pass
        return
    # existing local-Chromium logic unchanged from here
```

- [ ] **1.4 Run tests, expect pass**

```bash
cd python-workers && pytest tests/test_browser_brightdata.py -v
```

Expected (with WSS env var set in `.env.local`): both tests pass. The httpbin test takes 5-15s.
Expected (without WSS env var): `test_brightdata_requires_env_var` passes, `test_brightdata_loads_httpbin` skipped.

- [ ] **1.5 Commit**

```bash
git add python-workers/common/browser.py python-workers/tests/test_browser_brightdata.py
git commit -m "feat(scraper): add Bright Data CDP path to browser_page()"
```

### Phase 2 — Diag endpoint support for ad-hoc provider testing

- [ ] **2.1 Add `?provider=` param to `/diag/airline`**

Edit `python-workers/serve.py` (handler at ~line 199-237). Replace the body with:

```python
@app.get("/diag/airline")
async def diag_airline(
    url: str,
    provider: str = "iproyal",  # iproyal | scraperapi | brightdata
    timeout_ms: int = 30_000,
):
    kwargs: dict = {"timeout_ms": timeout_ms}
    if provider == "scraperapi":
        kwargs["use_scraperapi"] = True
        kwargs["scraperapi_premium"] = True
    elif provider == "brightdata":
        kwargs["use_brightdata"] = True
    elif provider == "iproyal":
        pass  # default
    else:
        raise HTTPException(400, f"unknown provider: {provider}")

    try:
        async with browser_page(**kwargs) as page:
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            return {
                "ok": True,
                "status": resp.status if resp else None,
                "url": page.url,
                "title": await page.title(),
                "provider": provider,
            }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "provider": provider}
```

- [ ] **2.2 Local smoke test**

```bash
cd python-workers && uvicorn serve:app --port 8080 &
sleep 2
curl "http://localhost:8080/diag/airline?url=https://httpbin.org/headers&provider=brightdata"
```

Expected: `{"ok": true, "status": 200, "url": "https://httpbin.org/headers", "title": "", "provider": "brightdata"}`

- [ ] **2.3 Commit**

```bash
git add python-workers/serve.py
git commit -m "feat(diag): add provider=brightdata to /diag/airline endpoint"
```

### Phase 3 — Pilot Bright Data on AA AAdvantage (DECISION GATE)

**This phase decides whether Bright Data is our primary or we fall back to Scrapfly.** Do not proceed to Phase 4-5 until AA passes.

- [ ] **3.1 Diag test against aa.com (the canary)**

```bash
curl "http://localhost:8080/diag/airline?url=https://www.aa.com/booking/find-flights&provider=brightdata&timeout_ms=60000"
```

Expected (success): `{"ok": true, "status": 200, "title": "Book your flight...", ...}`
Expected (failure): timeout, 403, or title contains "Access Denied" / "Pardon Our Interruption" → **STOP**, switch to Phase 3-Fallback below.

- [ ] **3.2 Switch AA plugin to Bright Data**

Edit `python-workers/aa_aadvantage/search.py`. Find the `async with browser_page(...)` call. Replace the kwargs:

```python
# OLD:
async with browser_page(
    timeout_ms=150_000,
    use_scraperapi=True,
    scraperapi_premium=True,
    proxy_country="us",
) as page:

# NEW:
async with browser_page(
    timeout_ms=150_000,
    use_brightdata=True,
) as page:
```

- [ ] **3.3 Run AA search end-to-end**

```bash
curl "http://localhost:8080/search?program=AA_AADVANTAGE&origin=JFK&dest=LAX&date=2026-08-15"
```

Expected: HTTP 200 with either:
- `[]` → network unblocked but parser doesn't match the live response (Phase 6 will fix), or
- `[{"programId": "AA_AADVANTAGE", ...}, ...]` → full success.

Failure signal: HTTP 500, ETIMEDOUT, or worker log shows "Access Denied" / Akamai 403 → **STOP**, switch to Phase 3-Fallback.

- [ ] **3.4 Capture raw XHR response for Phase 6**

Add a temporary `import json; print(json.dumps(captured["json"], indent=2))` in `aa_aadvantage/search.py` after the XHR is captured (just before `_parse_*`). Re-run the search, copy stdout JSON into `tasks/captured-responses/aa-jfk-lax-2026-08-15.json`. Remove the print. This is the reference shape for Phase 6 parser repair.

- [ ] **3.5 Commit**

```bash
mkdir -p tasks/captured-responses
git add python-workers/aa_aadvantage/search.py tasks/captured-responses/aa-jfk-lax-2026-08-15.json
git commit -m "feat(aa): route via Bright Data Scraping Browser (CDP)"
```

### Phase 3-Fallback — Switch to Scrapfly (only if Phase 3 fails)

If AA fails through Bright Data, escalate before continuing.

- [ ] User signs up for Scrapfly: https://scrapfly.io → Discovery plan (1000 free credits to pilot) → copy API key.
- [ ] Add `SCRAPFLY_API_KEY` env var. Construct WSS URL as `wss://browser.scrapfly.io?key={KEY}&asp=true&proxy_pool=public_residential_pool`.
- [ ] Add `use_scrapfly` branch to `browser_page()` mirroring `use_brightdata` (use the same `connect_over_cdp` path, just different WSS URL builder + different env var name).
- [ ] Re-run Phase 3 with `use_scrapfly=True`. If AA passes, swap the recommendation: Scrapfly becomes primary, Bright Data fallback. Adjust all later phases.

(Detailed sub-steps deferred until/unless triggered — same shape as Phase 1-3.)

### Phase 4 — Pilot DL + UA (parallel gates)

Apply the Phase 3 cycle (diag → swap → live search → capture → commit) to:

- [ ] **4.1** **DL SkyMiles**: `python-workers/dl_skymiles/search.py`, diag URL `https://www.delta.com/flight-search/search`
- [ ] **4.2** **UA MileagePlus**: `python-workers/ua_mp/search.py`, diag URL `https://www.united.com/en/us/fsr/choose-flights`

For each: diag through `provider=brightdata` → if 200, swap the plugin → run live search → capture response → commit.

**Combined decision gate:** If AA+DL+UA all pass on Bright Data → continue Phase 5. If 2+ of the 3 fail → trigger Phase 3-Fallback. If only 1 fails → mark that plugin as "needs custom approach" and proceed.

### Phase 5 — Roll out to remaining 8 plugins

For each plugin below, apply the Phase 3 cycle (diag URL → swap `browser_page` kwargs → live search → capture response → commit). One commit per plugin. ~30 min/each, ~4 hrs total.

- [ ] **5.1** **AC Aeroplan** — `python-workers/ac_aeroplan/search.py`. **Special concern:** preserves the homepage warmup → Akamai cookie mint → search URL flow (lines 175-198). Verify warmup cookies persist into the search goto when using CDP-attached session. If not, may need to skip warmup or move it to a single page navigation.
- [ ] **5.2** **BA Avios** — `python-workers/ba_avios/search.py`. **Special concern:** login flow inside browser context. Verify the post-login session token persists across goto calls in the same `browser_page()` yield.
- [ ] **5.3** **AF Flying Blue** — `python-workers/af_flyingblue/search.py`
- [ ] **5.4** **LH Miles & More** — `python-workers/lh_miles_more/search.py`
- [ ] **5.5** **TK Miles & Smiles** — `python-workers/tk_miles_smiles/search.py`
- [ ] **5.6** **NH ANA** — `python-workers/nh_ana/search.py`
- [ ] **5.7** **CX Asia Miles** — `python-workers/cx_cathay/search.py`
- [ ] **5.8** **AV LifeMiles** — `python-workers/av_lifemiles/search.py`

If a plugin's auth/cookie flow breaks because CDP sessions don't behave like local ones, record the failure in `tasks/lessons.md` and move on. We'll cluster those for a follow-up session.

### Phase 6 — Parser validation per plugin (the real work)

Per `tasks/lessons.md` Session 3: *"the parsers were written speculatively against AwardWiz references and never tested against live responses."* Even with Bright Data unblocking the network, plugins will likely return `[]` until parsers match real response shapes.

For each of the 11 unblocked plugins (repeat the pattern):

- [ ] **6.N.1** Open captured response in `tasks/captured-responses/<plugin>-*.json`.
- [ ] **6.N.2** Diff against the parser's assumed shape (e.g. for AC: `_parse_air_bounds()` at `ac_aeroplan/search.py:56`). Common drift: field renamed, nested under a wrapper, list↔dict swap, missing type coercion, currency in cents vs dollars.
- [ ] **6.N.3** Update parser to match real shape.
- [ ] **6.N.4** Add unit test `python-workers/<plugin>/tests/test_parse.py` that feeds the captured JSON through the parser and asserts ≥1 result row with ≥1 cabin price with non-zero `miles_per_pax`.
- [ ] **6.N.5** Run integration: `curl "http://localhost:8080/search?program=<ID>&origin=JFK&dest=LHR&date=2026-08-15"`. Assert HTTP 200 + non-empty array.
- [ ] **6.N.6** Commit: `git commit -m "fix(<plugin>): align parser with live response shape"`.

Estimated 30-60 min per plugin × 11 plugins = **~10-12 hrs of real iteration work**. This is the longest phase.

### Phase 7 — Cleanup + cost monitoring

- [ ] **7.1 Retire unused ScraperAPI code.** If all 11 plugins now use `use_brightdata=True` and no caller passes `use_scraperapi=True`:
  - Delete `_scraperapi_proxy()` (`browser.py:54-87`).
  - Delete `use_scraperapi`, `scraperapi_render`, `scraperapi_premium` kwargs from `browser_page()`.
  - Delete the `if use_scraperapi:` branch (`browser.py:120-125`) and related cookie/route logic (`browser.py:174-178, 182-193`).
  - Remove `SCRAPERAPI_KEY` from `.env.example`; ask user to delete from Fly secrets.
- [ ] **7.2 Add bandwidth-tracking log line.** In the brightdata branch, after `await page.goto(...)` in plugins, log: `log.info("brightdata_session program=%s url=%s", PROGRAM_ID, page.url)` — gives a grep-able cross-reference between Fly logs and Bright Data dashboard.
- [ ] **7.3 Update `README.md` and `docs/planning/HANDOFF.md`:** "Scraper transport: Bright Data Scraping Browser (CDP). Local dev needs `BRIGHTDATA_WSS_URL` in `.env.local`. VS/AS still use httpx+IPRoyal."
- [ ] **7.4 Update `tasks/lessons.md`** with what we learned: which plugins worked first-try, which needed parser repair, which had cookie/session issues on CDP, cost per search measured vs estimated.
- [ ] **7.5 Commit**

```bash
git add python-workers/common/browser.py python-workers/.env.example README.md docs/planning/HANDOFF.md tasks/lessons.md
git commit -m "chore(scraper): retire ScraperAPI; document Bright Data CDP transport"
```

### Phase 8 — Verification (per CLAUDE.md rule 11)

**8.1 Fresh-eyes code audit.**
- [ ] Re-read `python-workers/common/browser.py` end-to-end. Check: dead code, symmetric error handling between local/CDP branches, resource-block route doesn't conflict with per-plugin route handlers, `BRIGHTDATA_WSS_URL` not logged (credentials in URL).
- [ ] Re-read each modified plugin's `search.py`. Check: imports still correct, removed scraperapi kwargs cleanly, no orphan `proxy_country` args.
- [ ] Re-read `serve.py` diag endpoint. Check: unknown providers rejected (400 not 500), `provider=` round-trips into response.
- [ ] Fix anything found inline before moving on.

**8.2 Backend end-to-end tests.**
- [ ] For each of 13 programs: `curl "http://localhost:8080/search?program=<ID>&origin=JFK&dest=LHR&date=2026-08-15"`. Assert HTTP 200 + record whether non-empty.
- [ ] Failure path: with `BRIGHTDATA_WSS_URL=wss://bogus:bad@brd.superproxy.io:9222`, search returns `[]` + error logged, not 500.
- [ ] Idempotency: run the same search twice via curl, then in Supabase query `SELECT count(*) FROM search_results WHERE origin_iata='JFK' AND dest_iata='LHR' AND depart_date='2026-08-15';` — expect identical row count (ON CONFLICT upsert is correct).
- [ ] Cleanup: `DELETE FROM search_results WHERE origin_iata='JFK' AND dest_iata='LHR' AND depart_date='2026-08-15';` (and cascade tables) once verified.

**8.3 Frontend end-to-end test.**
- [ ] Bring up dev: `pnpm dev`. Open `/search`. Submit JFK→LHR upcoming date. Verify all 13 program columns populate (some may be Chart-only if parser is incomplete), freshness/confidence badges render, no console errors, mobile sticky-column layout works at 375px width, dark mode default holds.
- [ ] Reload — URL-persisted query state survives.

**8.4 Cleanup + report.**
- [ ] Delete test rows from 8.2-8.3.
- [ ] Report to user: which of 11 programs unblocked AND returning rows, which unblocked but still `[]` (parser in Phase 6 needed), which still blocked (Bright Data failed), any regressions found, total cost so far per Bright Data dashboard.

### Phase 9 — KB draft (per CLAUDE.md rule 10)

- [ ] Create `tasks/kb-drafts/all-11-programs-live.md`. Write for a non-engineer user. Cover: what changed (11 more programs now live), what to expect (5-30s per program for results), known limitations (still subject to airline ToS, occasional empty results when carrier is throttled), cost transparency (paid Bright Data trial → ongoing ~$5-15/mo at current search volume). Don't publish — list as a draft in session summary for user editorial review.

---

### Notes & deferrals
- **Scrapfly fallback** (Phase 3-Fallback) only fleshed out if Bright Data fails Phase 3. Plan structure mirrors Phase 1-3 with `use_scrapfly` instead of `use_brightdata`.
- **VS / AS intentionally unchanged.** httpx+IPRoyal works for them; no need to spend bandwidth $.
- **Per-account login pools** (BA, AC, AA — see `creds_for()` in `browser.py:208-239`) untested with CDP session model. If login flows fail in Phase 5, may need a per-plugin workaround (login + token-extract → re-attach to subsequent goto).
- **Parser repair (Phase 6) is the dominant cost** of this migration in human-hours. Don't underestimate.
- **Eventual VS/AS migration to Bright Data** can happen later if IPRoyal breaks. Not needed now.


## Current airline-first continuation (September5,2026; supersedes older paid-transport assumptions)

- [x] Ethiopian fresh anonymous transport reproduced in Node.
- [x] Preserve all observed offers/references, both cabins, passenger totals, unknown taxes and technical stops.
- [x] Integrate source and verify real SSE + browser, including selected-cabin handoff.
- [x] Add eight meaningful regression tests (140 total passed).
- [x] Ethiopian production build/CI passed; fresh hosted Linux Node22 transport verified. Vercel runtime remains behind preview SSO.
- [ ] Continue distinct American/United/remaining airline leads; do not equate partner coverage or browser-only success with native server connectivity.

- [x] Qantas public cached flight inventory integrated; all pages, observed times, fees, mixed cabins and source limitations retained.
- [x] Test compatible Qantas transport on hosted Linux: run33985079120 returned403, while Ethiopian passed. Qantas hosted access remains unresolved despite local optimized-server success.
- [ ] Continue current Copa anonymous shopping flow and other distinct remaining leads. A successful homepage is insufficient; require actual dated award inventory.
