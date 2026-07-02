# Finish PointSnap — Comprehensive Game Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Each phase is expanded into TDD-sized steps at execution time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take PointSnap from "shipped shell + 3/13 live scrapers" to a launch-ready, honest, fully-featured product — real auth, working wallet, admin tooling, booking handoff, and a real chart-based should-cost estimate for *every* program — without gating completion on the bot-walled carriers that structurally require the owner's airline logins.

**Architecture:** Next.js 16 App Router (Vercel) + FastAPI Python worker fleet (Fly.io) + Supabase Postgres. Auth via **Supabase Auth** (self-contained, no external keys). Coverage delivered two ways: (a) live scrapers where anonymous endpoints exist (VS/AS/B6), (b) an honest **chart-based estimate engine** everywhere else, with the **T5' user-connect** path lit up so an enthusiast who logs into their own account gets live data behind their own login.

**Tech Stack:** TypeScript, React 19, Tailwind v4, shadcn/Radix, Drizzle ORM, postgres-js, Supabase (Auth + Vault + Postgres), Python 3.11, FastAPI, Playwright/Camoufox, Vitest, pytest.

---

## Adopted decisions (defaults — owner may override)

| Decision | Chosen | Rationale |
|---|---|---|
| Definition of done | Ship-ready product, honest coverage | The 11 bot-/login-walled carriers can't be made live without owner credentials + real-time MFA; product completion must not depend on that. |
| Scraper ambition | Product + cheap/high-certainty scraper fixes only | Skip the speculative AA/DL money-pit; keep a drop-in seam. |
| Auth | Supabase Auth | Self-contained, no external keys, fully testable autonomously. |
| Paid anti-bot | Free/DIY + drop-in seam | Logs suggest AA likely unsolvable even with spend. |
| Paywall | Stays off at launch (`NEXT_PUBLIC_ENABLE_PAYWALL=false`) | Already the default; pricing activation is an owner call. |
| Go-live | Stage on working branch + draft PR; never push `main` | Production has live users; merge is an explicit owner trigger (CLAUDE.md). |

## What structurally requires the owner (cannot be automated)

1. **Airline logins + real-time MFA** for the 20 login-gated programs — the dominant coverage blocker. T5' plumbing will be fully built so it works the instant an account is connected.
2. **`SUPABASE_ACCESS_TOKEN`** — to apply migrations to production and verify the live DB. Without it, migrations are written + verified locally and left for the owner to apply.
3. **Rotate the exposed Bright Data credentials** (committed in `tasks/scraper-log.md`). Claude scrubs the repo; owner rotates in the BD dashboard + Fly secrets.
4. **Paid-service authorizations** (Hyper Solutions etc.) — deferred by default.
5. **Legal sign-off** for AC/AA before those go live — flagged, owner decision at go-live.

## Verification strategy given no local DB access

- **Frontend:** `pnpm typecheck && pnpm test && pnpm build && pnpm lint` locally (node_modules present).
- **DB logic:** hermetic unit tests + a **local ephemeral Postgres 16** (spun up at execution time) that the committed migrations + seeds are applied to, so schema/seed/RLS logic is proven before it touches production.
- **Scraper paths:** the live worker (`pointsnap-workers.fly.dev`) + hermetic parser unit tests fed captured JSON.
- **Production apply/verify:** via `SUPABASE_ACCESS_TOKEN` (Management API) when provided, else handed to the owner.

---

## Phase 0 — Foundations, safety, truth (do first; unblocks + de-risks everything)

**Files:**
- Modify: `CLAUDE.md` (root) — it currently describes a UPS/FedEx invoice tool on Vite with a nonexistent `src/config/pages.tsx` manifest. Wrong domain, wrong stack. Replace domain/stack/manifest sections with accurate PointSnap facts; keep the load-bearing workflow rules (git, migrations, scraper-log discipline, verification).
- Modify: `tasks/scraper-log.md` — redact the committed BD API key / zone passwords (replace with `<REDACTED — see Fly secrets>`).
- Create: `.github/workflows/ci.yml` — frontend typecheck/test/build/lint + hermetic pytest.
- Modify: `python-workers/tests/test_vs_search.py`, `python-workers/tests/test_serve.py` — relative dates + `@pytest.mark.live` markers.
- Create: `python-workers/pytest.ini` (or `[tool.pytest.ini_options]` in pyproject) — register the `live` marker, default `-m "not live"`.
- Modify: `python-workers/vs/search.py` — fix `flight_number='CAL'` drift.
- Modify: `src/db/schema/searches.ts` — drop the dead `aircraft_icao` FK (matches migration `20260519212716`).
- Create: `src/db/schema/programAuthSessions.ts`, `src/db/schema/accountPool.ts` reconciliation so `drizzle-kit` can't generate a destructive diff; mark `search_results_history` partitioned.
- Modify: `.env.local.example` — add `PYTHON_WORKER_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; relabel "Neon" → "Supabase".

**Tasks:**
- 0.1 Rewrite the stale/misleading sections of `CLAUDE.md` to match the real app (Next.js 16 App Router, Supabase, award-search; file-based routing not a manifest). Preserve git/migration/scraper-log/verification workflow rules.
- 0.2 Redact committed Bright Data secrets from `tasks/scraper-log.md`; add a note to rotate. (Full git-history scrub only on explicit owner approval.)
- 0.3 Add frontend CI: `pnpm install --frozen-lockfile`, `typecheck`, `test`, `build`, `lint` on push + PR.
- 0.4 Make python-workers tests hermetic: relative future dates, `@pytest.mark.live` on network tests, default suite excludes `live`; add the pytest job to CI.
- 0.5 Fix VS parser `flight_number` drift + unit test with a captured/synthetic fixture.
- 0.6 Reconcile Drizzle schema ↔ live DB (remove aircraft FK, represent auth-sessions/account_pool/partitioning) so `drizzle-kit push` is non-destructive; leave a comment that Supabase migration files remain the source of truth.

**Verification:** CI green on the branch; `pnpm typecheck/test/build/lint` clean; `pytest -m "not live"` green; grep confirms no live BD secret remains in the repo.

---

## Phase 1 — Real authentication (Supabase Auth)

**Files:**
- Create: `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/middleware.ts` (`@supabase/ssr`).
- Create: `src/middleware.ts` — session refresh + protect `/admin`, `/wallet`, `/airlines`.
- Modify: `src/app/sign-in/page.tsx`, `src/app/sign-up/page.tsx` — real email/password + magic-link forms.
- Create: `src/app/auth/callback/route.ts` — OAuth/magic-link callback.
- Modify: `src/app/api/auth/airline/_userId.ts` — resolve the real user id from the Supabase session (keep dev fallback).
- Create: `supabase/migrations/<ts>_users_authlink.sql` — link `public.users` to `auth.users`, `is_staff` flag, trigger to create an app user row on first login; RLS.
- Modify: `src/components/layout/site-header.tsx` — conditional nav (hide Admin unless staff), account menu, sign-out.

**Tasks:** 1.1 Supabase client/middleware. 1.2 Real sign-in/up + callback. 1.3 `users`↔`auth.users` link migration + first-login provisioning. 1.4 Route protection + `is_staff` RBAC for `/admin`. 1.5 Tests (middleware redirect, userId resolution) + verify against local Postgres.

**Verification:** anonymous → `/admin` redirects to sign-in; sign-up creates an `auth.users` + `public.users` row (local PG); staff flag gates `/admin`; typecheck/test/build green.

---

## Phase 2 — Honest coverage: chart-based should-cost for every program

The value-delivery phase. Makes the spreadsheet meaningful for all 13 programs without scraping.

**Files:**
- Create: `supabase/migrations/<ts>_seed_program_partnerships.sql` + `src/db/seed/programPartnerships.ts` — N×M program × operating-carrier fare-class matrix.
- Create/expand: `src/db/seed/awardCharts.ts` — BA distance bands, ANA zones, CX zones, VS, AS, AC, AV, others; `award_chart_cells` + `award_chart_rules` per program.
- Create: `src/lib/estimateEngine.ts` — given O&D + date + cabin, compute should-cost from charts (distance/zone lookup + surcharge model), returns Chart-only rows with a `confidence: 'chart-only'` tag.
- Modify: `src/app/api/search/route.ts` — for any program with no live plugin or an empty live result, merge in a chart-only estimate row so every program surfaces something honest.
- Modify: `src/lib/confidence.ts` / badge components — ensure the "Chart-only" bucket renders distinctly.
- Tests: `src/lib/__tests__/estimateEngine.test.ts`.

**Tasks:** 2.1 Seed partnerships. 2.2 Seed full charts. 2.3 Estimate engine (distance great-circle + zone membership + surcharge passthrough from `programs`). 2.4 Merge chart-only rows into SSE stream behind live rows. 2.5 Badge wiring + tests.

**Verification:** local-PG-seeded search for JFK→NRT returns a chart-only estimate for every program with no live data, correctly tagged; unit tests cover distance-band + zone lookups; no live row is overwritten by an estimate.

---

## Phase 3 — Wallet (real CRUD + transfer-path optimizer)

**Files:**
- Create: `src/app/wallet/actions.ts` — server actions for balance + card CRUD (`user_wallet_balances`, `user_card_holdings`), auth-gated.
- Modify: `src/app/wallet/page.tsx` + new client components — add/edit/delete balances & cards, expiring-points warnings.
- Create: `src/lib/transferOptimizer.ts` — best transfer path (currency → program) using `transfer_ratios` + active `transfer_bonuses`, building on `effectiveCost.ts`.
- Modify: `src/app/api/search/route.ts` + results table — "can I afford this / what's left" preview when a wallet exists.
- Tests: `src/lib/__tests__/transferOptimizer.test.ts`.

**Tasks:** 3.1 Balance CRUD. 3.2 Card CRUD. 3.3 Transfer optimizer. 3.4 Wallet-aware search preview. 3.5 Expiring warnings + tests.

**Verification:** CRUD persists per-user (local PG, RLS enforced); optimizer picks the bonus-boosted path in a known scenario; search shows affordability against a seeded wallet.

---

## Phase 4 — T5' user-auth-capture: finish the vertical

**Files:**
- Modify: `src/app/api/search/route.ts` — forward `user_id` into worker `/search` so captured sessions replay on real cockpit searches.
- Create: `python-workers/auth/disconnect` endpoint (uses existing `delete_session`), `src/app/api/auth/airline/disconnect/route.ts`, Disconnect button on `/airlines`.
- Modify: `python-workers/common/auth_session.py` callers — silent re-login on expiry via `get_stored_password`.
- Modify: the 12 `auth_required` plugins — consume `get_active_session` + `inject_cookies` (copy the AC pattern), behind the `user_id` dispatch.
- Tests: `python-workers/tests/test_auth_session.py` (encrypt/decrypt round-trip, swap-pointer NULL defense, expiry), capture state-machine transitions.
- Docs: reconcile `tasks/scraper-research/phase-2-5-live-view-research.md` + migration `20260519211710` header to the shipped credential-form model.

**Tasks:** 4.1 Forward user_id. 4.2 Disconnect slice. 4.3 Silent re-login. 4.4 Extend 12 plugins to replay. 4.5 Auth tests + doc reconcile.

**Verification:** hermetic tests for `auth_session` green; disconnect deletes the row + vault secret (local PG); with the dev user, a search request threads user_id to the worker. **Live per-airline verification is owner-gated** (optional UA login proves one end-to-end).

---

## Phase 5 — Admin operator tooling

**Files:** `src/app/admin/*` mutation UIs + `src/app/admin/actions.ts` — edit award charts, sweet spots, transfer bonuses; account-pool add/ban; scraper kill-switch; all writing `admin_audit_events`. Staff-gated (Phase 1 RBAC).

**Tasks:** 5.1 Chart/sweet-spot/bonus editors. 5.2 Account-pool + kill-switch. 5.3 Audit writes. 5.4 Tests + verify (local PG, audit rows appear, non-staff blocked).

---

## Phase 6 — Booking handoff + sweet-spot completeness

**Files:** `src/lib/bookingHandoff.ts` (deep-link builders + phone-booking scripts per program), `src/app/sweet-spots/*` expansion, `src/db/seed/sweetSpots.ts` (20→~50), wallet-gated "best redemptions for my balances" query (GIN tags already indexed).

**Tasks:** 6.1 Deep links + phone scripts. 6.2 Sweet-spot expansion. 6.3 Wallet-gated finder. 6.4 Tests + verify.

---

## Phase 7 — Scraper hardening (bounded, code-only)

**Tasks:** 7.1 Harden VS/AS/B6 (live integration tests behind `@pytest.mark.live`, endpoint-drift guards, remove debug scaffolding e.g. AA `MAX_ATTEMPTS=1`). 7.2 Partition scheduler for `search_results_history` (Supabase scheduled function calling `create_history_partition()` monthly). 7.3 Hyper Solutions drop-in seam (interface only; no spend). 7.4 (Owner opted-in only) speculative AA in-page XHR / DL Camoufox deep-link / 8-parser revival — bounded, logged forensically in `scraper-log.md`, may not verify without creds.

---

## Phase 8 — Reference-data depth

**Tasks:** 8.1 OpenFlights airport sync (132→~3000) — importer + seed/migration. 8.2 `pnpm db:import-csv` for Seats.aero-style CSV imports.

---

## Phase 9 — Polish, KB, verification, launch-readiness

**Tasks:**
- 9.1 HIG polish passes (apple-hig skill) across `/search`, `/wallet`, `/airlines`, `/admin`, `/sweet-spots`, auth pages; mobile + dark-mode + a11y.
- 9.2 Curate the 6 existing KB drafts + add drafts for every new surface (draft only, per CLAUDE.md rule 10).
- 9.3 Full verification (CLAUDE.md rule 11): fresh-eyes audit, backend E2E, frontend E2E (webapp-testing/Playwright against a local build), cleanup + report.
- 9.4 Update `README.md`, `tasks/progress.md`, `tasks/lessons.md`; open a **draft PR**; hand the go-live decision to the owner.

---

## Execution order & cadence

Phases run mostly in sequence (1→2→3 have data/auth dependencies), but independent slices fan out to subagents where safe. Commit after each task; push to `claude/project-assessment-plan-irnoc4`; keep `tasks/progress.md` and this plan's checkboxes current. Never touch `main`. Re-read `tasks/scraper-log.md` before any scraper task and log forensically as you go.
