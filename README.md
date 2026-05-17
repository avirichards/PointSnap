# PointSnap — the points cockpit

Accuracy-first award flight search across every major program. Spreadsheet UX, confidence scoring, wallet-aware pricing.

See [`docs/planning/HANDOFF.md`](docs/planning/HANDOFF.md) for the full product spec, competitive teardown, scraper architecture, data model, and per-program research.

## Stack

- Next.js 15 + TS + Tailwind v4 + shadcn-style components (App Router)
- Drizzle ORM + Postgres 16 (Neon serverless, partition-friendly)
- Upstash Redis for hot cache
- Clerk auth (wired but optional in dev)
- Stripe (wired but disabled at launch; paywall flips via `NEXT_PUBLIC_ENABLE_PAYWALL`)
- Vitest for unit tests

## Scripts

```bash
pnpm dev          # start dev server (port 3000)
pnpm build        # production build
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm db:generate  # generate Drizzle migration from schema
pnpm db:migrate   # apply migrations to DATABASE_URL
pnpm db:seed      # load 13 launch programs + reference data
pnpm db:studio    # open Drizzle Studio
```

## Getting Started

1. Copy `.env.local.example` to `.env.local` and fill in Neon / Upstash / Clerk / Stripe keys.
2. `pnpm install`
3. `pnpm db:migrate && pnpm db:seed`
4. `pnpm dev` → open http://localhost:3000/search

The spreadsheet view is backed by `src/lib/mockSearch.ts` until the Python scraper workers ship. Real scrapers will write to `search_results` / `result_cabin_prices` via the schema in `src/db/schema/`.
