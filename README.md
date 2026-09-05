# PointSnap

An award-search workspace for airline and points enthusiasts. Search routes, compare available cabins, inspect points and cash fees, and continue on the airline’s site. Travelers do **not** connect personal airline accounts to search.

The interface opens with compact search controls and an optional geographic route explorer. Results use a cabin comparison table on desktop and cards on mobile. Data freshness, missing fees, mixed cabins, source failures, and daily calendars are explicit.

## Run locally

Requires Node.js 22+ and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
cp .env.local.example .env.local
pnpm dev
```

Open http://localhost:3000. All environment values may stay blank to use the three direct sources. Airport autocomplete includes a local airport catalog and accepts any three-letter IATA code.

## Live coverage

| Source | Returned data | Access |
| --- | --- | --- |
| Alaska Airlines / Atmos Rewards | Individual itineraries, available cabins, per-person points, USD taxes and seats | Direct public search |
| JetBlue / TrueBlue | Lowest daily economy price, USD taxes, seats; no flight schedule | Direct public calendar |
| Virgin Atlantic / Flying Club | Daily economy, premium economy and business prices and seats; exact fees are not supplied | Direct public calendar |
| Seats.aero | Individual award itineraries for its supported programs | App-owned commercial Live Search key |
| AwardTool | Individual award itineraries for contract-enabled programs | App-owned API key |

**Universal airline coverage is not complete.** Direct live responses were verified for the first three sources on September 5, 2026. The commercial adapters were implemented against official documentation and tested with fixtures; they have not been tested with an actual subscription. The user currently has no subscription. Keys enable configured coverage, but do not prove every route or program will return data.

The search never generates estimate rows from award charts and never describes a blocked provider as “no availability.” JetBlue and Virgin rows are calendar results, with no invented flights or departure times. Airline endpoints can change; provider failures appear in Source coverage. See [live-data.md](docs/live-data.md) for exact contracts, evidence, and limitations.

## Accounts and wallet

1. Configure a Supabase project with email/password and email-link authentication.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public anon/publishable credential, never a service role key).
3. Apply the committed additive migration `supabase/migrations/20260905010000_personal_wallet.sql` to your preview database. The repository has conflicting historical claims about automatic migration deployment; verify actual application in Supabase rather than assuming a push applied it.
4. Add your local/preview/production `/auth/callback` URLs to Supabase’s permitted redirect URLs and configure the Site URL/email delivery.

The wallet stores manually entered program/currency balances, expiry dates and card nicknames. Row-level security isolates accounts. Search details compare the selected program’s balance with party cost. Transfer ratios, transfer bonuses, credit-card ingestion, and automatic balance sync are not implemented in the new flow; unverified seed ratios are not used.

Account routes verify Supabase users server-side. User IDs supplied by request parameters are ignored. Staff access requires administrator-controlled `app_metadata.role = "staff"`. No development identity bypass remains.

## Broader search coverage

Set `SEATS_AERO_API_KEY` and/or `AWARDTOOL_API_KEY` server-side. Seats.aero Pro does **not** grant Live Search access; a commercial agreement is required. AwardTool program codes must match your contract; use `AWARDTOOL_PROGRAMS` to configure them.

When commercial access is enabled, searches require a verified PointSnap account. Production also requires Upstash REST Redis for a shared search quota. This prevents anonymous use of paid quota. Configure both Redis values before enabling the provider keys. Local/direct-only development uses a bounded in-memory limiter.

No airline credentials are required or forwarded by the new search pipeline. The old worker login code remains isolated for compatibility; the product does not offer new airline connections. Existing sessions can be removed at `/airlines/accounts` if the worker is configured.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
cd python-workers
PYTHONWORKERS_SKIP_DB=1 pytest
```

Tests cover provider contracts, date and passenger validation, SSE parsing and cancellation, partial failures, authentication boundaries, actual PostgreSQL wallet migration/RLS behavior using PGlite, and worker cross-account isolation. Default Python tests exclude live network/browser tests. CI runs both suites.

For a live smoke check, use a date in the future:

```sh
curl -N 'http://localhost:3000/api/search?origin=SEA&dest=SFO&departDate=2026-10-05&pax=1&minCabin=Y&programs=AS_MILEAGEPLAN'
```

## Deployment

Keep the existing Next.js/Vercel deployment architecture. This application uses Node APIs and optional TCP Postgres; it is not a static-site export. Feature branches are the review/preview surface. Production deployment and database application must be verified separately; do not merge to `main` as part of ordinary development.

The search route declares a 120-second maximum with a 110-second application deadline, per-provider timeouts, cancellation, heartbeat and private no-store responses. Check your hosting plan’s effective function timeout and outbound airline reachability in preview. A direct source working locally does not establish that an airline accepts a hosting provider’s IP addresses.

Optional Python worker security: set a strong `POINTSNAP_WORKER_TOKEN` shared with Next.js and a separate `POINTSNAP_WORKER_ADMIN_TOKEN`. Only `/health` and `/programs/meta` are public. Auth endpoints also require the server-verified `X-PointSnap-User`; session IDs cannot cross accounts. The historical Vault delete trigger removes stored secrets on disconnect; storage failures are surfaced, not reported as success.

## Product and data notes

- [User direction](tasks/product-brief.md) is the source of truth for the current product brief.
- The route globe uses D3 geographical projection and Natural Earth land data from the ISC-licensed `world-atlas` package. It shows geography, not verified flight paths or award coverage.
- Current results are one-way. A return date searches each direction separately; round-trip award pricing can differ.
- Displayed times retain airport-local source timestamps. Cash stays in its original currency. No foreign exchange rate is guessed.
- Explore suggestions contain routes, not static claims of award availability or bargain prices.
