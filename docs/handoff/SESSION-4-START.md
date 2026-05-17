# PointSnap — Session 4 Start (Phase 1: First Real Scraper)

**Date:** 2026-05-17
**Base branch:** `main` (production-live, Vercel auto-deploys)
**This session's workstream:** Virgin Atlantic Flying Club scraper (program `VS_FLYING_CLUB`)

---

## Where we are

- **Phase 0 + Phase 1 schema + cockpit UI are shipped to production.** Vercel auto-deploys `main`. The `/search` page renders the cross-program spreadsheet with simulated SSE streaming results for all 13 launch programs.
- **Neon DB is seeded.** Counts as of session 3 close: programs=13, airports=132, airlines=39, sweet_spots=20, transfer_ratios=48. Schema = 33 base tables + 6 monthly partitions of `search_results_history` (2026-02 through 2026-07).
- **Network reality in Claude Code on the web:** even the "Full" policy only opens HTTPS (443). Port 5432 is blocked. The repo already accommodates this: `src/db/index.ts` uses `@neondatabase/serverless` via `drizzle-orm/neon-http`, and `pnpm db:bootstrap` (`scripts/applyBootstrap.ts`) applies `scripts/bootstrap.sql` over HTTPS. Use those, not `drizzle-kit migrate` or `psql`.
- **All search results are simulated.** `src/lib/mockSearch.ts` + `src/app/api/search/route.ts` produce a curated JFK→NRT dataset with per-program latency modeling. No real scraping yet.
- **Retired branches:** `claude/flight-points-platform-AP3St-24G73` (session 2 + 3 work) merged to main. Delete it from local + remote if you like.

## Why Virgin Atlantic first

From the locked plan (`docs/planning/HANDOFF.md` and `docs/planning/03-scraper-architecture.md`):

- **Difficulty 1/5** — easiest of the 13 launch programs.
- **No auth required** for award search (unlike ANA, Cathay, Aeroplan).
- **Light captcha posture** — Imperva but bootstrappable.
- **Validates the full pipeline end-to-end** (worker → proxy → captcha → writeback → SSE → cockpit) on a forgiving target before harder programs (UA, AA, DL, CX, AC) build on top of it.
- Listed as Week 3 (first scraper) in the build plan.

If the cockpit shows even one real VS row at the end of this workstream, the whole architecture is validated.

## Goal of this session (and the 2-3 that follow)

End state at the **end of the workstream** (not session 1):

- Curl `https://<vercel-url>/api/search?origin=JFK&dest=LHR&date=2026-06-15` returns an SSE stream containing at least one **real** VS Flying Club result alongside the simulated rows for the other 12 programs.
- The cockpit at `/search` renders the real VS row tinted by cabin, with confidence badge "High" (one source, freshly scraped) and a live `last_seen_at` timestamp.
- The scrape is durable: the worker can be re-invoked, results land in `search_results` + `result_segments` + `result_cabin_prices`, and the cockpit picks them up.

## Day-1 scope (this session)

Ship a vertical slice with a **hard-coded** VS response. Real scraping comes in session 5.

1. **Python worker skeleton at `python-workers/`** — separate from the Next.js app, own `pyproject.toml`, locked Python 3.12, `patchright` + `httpx` + `psycopg[binary]` + `python-dotenv` installed. README explaining the lifecycle (local dev, Fly.io target).
2. **VS plugin at `python-workers/vs/search.py`** — implements the protocol from `docs/planning/03-scraper-architecture.md` §plugin protocol. For day 1, returns a **hard-coded** `list[NormalizedFlight]` for any JFK→LHR query (1 J-cabin + 1 Y-cabin result on a VS3 or VS138 segment). Real Patchright scrape stubbed with `TODO`.
3. **HTTP bridge** — small FastAPI app at `python-workers/serve.py` exposing `GET /search?program=VS_FLYING_CLUB&origin=JFK&dest=LHR&date=YYYY-MM-DD`. Returns JSON. Local dev: `uvicorn serve:app --port 8001`.
4. **Postgres writeback** — `python-workers/db.py` connects to Neon via the HTTPS REST endpoint (not 5432 — Vercel functions have the open egress, but the sandbox doesn't, and we want one path that works everywhere). Inserts into `search_results` + `result_segments` + `result_cabin_prices`. Idempotent via `itinerary_hash` deterministic uniqueness.
5. **Wire `/api/search` to call the worker** — for `VS_FLYING_CLUB`, replace the mock for-that-program emission with an HTTP call to the Python worker. Keep mock for all 12 other programs. Stream the real result via the existing SSE protocol (`partial` event → `program_done`).
6. **Verify in the cockpit** — `/search` shows a real VS row in the spreadsheet alongside 12 simulated rows. Tested on the deployed Vercel URL (not just localhost), because Vercel→Neon connectivity matters and the worker needs to be reachable from Vercel too (decide: ngrok tunnel for day 1, Fly.io deploy by session 6).

## Out of scope for day 1 (later sessions)

- Real Patchright scraping (Imperva bypass, headless detection mitigation) — session 5.
- IPRoyal residential proxies — session 5. Day-1 hard-coded path doesn't need them.
- Captcha-solver integration (CapSolver) — session 5.
- Fly.io deployment of the worker — session 6. Day-1 runs on ngrok / localhost.
- Other 12 programs — they stay simulated until VS proves the pipeline.

## Setup prerequisites (you don't need these for day 1)

- **IPRoyal account** — sign up at iproyal.com, get residential proxy credentials. **Not needed day 1.** Required session 5.
- **CapSolver account** — same, required session 5.
- **Fly.io account** — required session 6 for worker deployment.
- **Vercel CLI** — useful but optional; deployment is auto via GitHub push to `main`.

For day 1: nothing new to sign up for.

## Reading list (first 15 min of session)

In this order:

1. **`docs/planning/03-scraper-architecture.md`** — full scraper system design. Pay attention to: plugin protocol signature, per-program intelligence matrix entry for VS, BullMQ priority lanes (we'll skip the queue for day 1 and do direct HTTP), normalized flight schema.
2. **`docs/planning/04-data-model.md`** §3 (`searches` / `search_results` / `result_segments` / `result_cabin_prices`) — exact column shapes the writeback must populate.
3. **`src/app/api/search/route.ts`** — current SSE producer, see where to inject the real-VS call.
4. **`src/lib/mockSearch.ts`** — the shape of a normalized result; the Python worker's JSON should round-trip into the same structure.

## Branch + worktree

Per CLAUDE.md §"One worktree per conversation":

1. Audit stale branches first: `git branch -a --no-merged main`. Likely candidates: `claude/copy-claude-config-L2lrg`, `claude/flight-points-platform-AP3St-24G73`. Both merged or retired — delete with the user's OK.
2. Call `EnterWorktree` with branch name `feat/vs-scraper-day1` based on `main`.
3. Day 1 lives in that worktree until you `ExitWorktree` at conversation end.

## Commit + push posture

- Commit per logical milestone (worker skeleton, VS plugin stub, writeback, route wiring, cockpit verify). Five small commits beats one big one.
- Push the feature branch — Vercel previews every pushed branch, so the user can review at the preview URL before merging.
- Do **not** merge to `main` unless the user explicitly says "push it live" or "merge to main". This session's work is ambitious enough that a preview-then-merge cycle is worth the round-trip.

## Database posture

- The cockpit reads from Neon. Day-1 writeback inserts new rows into `search_results` etc. — these are **additive** changes, no schema migrations. No DB branching needed.
- If the day-1 work needs a schema change (it shouldn't — the `searches`/`search_results` columns already accommodate real data), follow CLAUDE.md §"Database branches" rigorously: branch Neon, apply, verify, merge, never directly hit prod schema.

## Paste-ready prompt for the new session

Copy this into a fresh Claude Code session, base branch = `main`:

> Start the Virgin Atlantic scraper workstream. Invoke the `using-superpowers` skill first. Then read `docs/handoff/SESSION-4-START.md` for full context and stick to the day-1 scope described there (hard-coded VS response, no real scraping yet — that's session 5). Before any code: `git branch -a --no-merged main` to audit stale branches and propose what to delete; then `EnterWorktree` on `feat/vs-scraper-day1` from `main`. Use `apple-hig` for any UI tweaks. Verify the end-state on the deployed Vercel preview URL, not just localhost. Push the feature branch when each milestone lands; only merge to `main` if I say "merge to main." Be terse — I'm on phone.

---

**Open questions to confirm before code in session 4:**

- Worker reachability from Vercel — do we tunnel through ngrok for day 1, or commit to Fly.io setup before the first PR? Ngrok is faster but adds a moving-piece dependency for the preview deploy. Recommendation: ngrok for day 1, queue Fly.io for session 6.
- HTTP bridge vs queue (BullMQ) — original plan was queue-based. For day 1 (one scraper, one program, hard-coded response), direct HTTP is enough. Queue infrastructure can come when we add scraper #2.
