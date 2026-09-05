# PointSnap

An award-search workspace for airline and points enthusiasts. Search routes, compare available cabins, inspect points and cash fees, and continue on the airline’s site. Travelers do **not** connect personal airline accounts to search.

The interface opens with compact search controls and an optional geographic route explorer. Save searches on your device and move between nearby dates. Results use a cabin comparison table on desktop and cards on mobile. Data freshness, missing fees, mixed cabins, source failures, and daily calendars are explicit.

## Run locally

Requires Node.js 22+ and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
cp .env.local.example .env.local
pnpm dev
```

Open http://localhost:3000. All environment values may stay blank to use the six direct sources. Airport autocomplete includes a local airport catalog and accepts any three-letter IATA code.

## Live coverage

| Source | Returned data | Access |
| --- | --- | --- |
| Alaska Airlines / Atmos Rewards | Individual itineraries including available partners, per-person points, USD taxes, seats and matching cash fares | Direct public search |
| JetBlue / TrueBlue | Supplied JetBlue/partner itineraries and fare families; per-segment cabins, points, taxes and exact-fare cash comparisons when matched | Direct public flight search |
| Emirates Skywards partners | Individual easyJet and Jet2 flights, exact party miles; taxes included. Emirates-operated flights are not connected. | Direct public partner portal |
| Virgin Atlantic / Flying Club | Daily economy, premium economy and business prices and seats; exact fees are not supplied | Direct public calendar |
| Frontier Miles | US domestic itineraries and all supplied bundle/payment choices; premium seat type unconfirmed | Direct public search |
| Aeromexico Rewards | Individual itineraries and supplied Classic/Dynamic fares; per-person points and MXN cash fees | Direct public search |
| Seats.aero | Individual award itineraries for its supported programs | App-owned commercial Live Search key |
| AwardTool | Individual award itineraries for contract-enabled programs | App-owned API key |

**Universal airline coverage is not complete.** Fresh requests were verified for all six direct sources on September 5, 2026. The commercial adapters were implemented against official documentation and tested with fixtures; they have not been tested with an actual subscription. The selected product direction is subscription-free direct search. Optional commercial adapters remain inactive; they are not the completion plan.

The search never generates estimate rows from award charts and never describes a blocked provider as “no availability.” Virgin calendar summaries appear separately from flight results and do not count as complete flight integrations. JetBlue now returns complete itinerary and fare records for the audited searches. Airline endpoints can change; provider failures appear in Source coverage. See [live-data.md](docs/live-data.md) for exact contracts, evidence, and limitations.

## Search and comparison

One physical itinerary groups matching booking programs and every supplied fare. Cabin, stops, points/fees, airlines, programs and times are available directly; All filters includes connections, aircraft, fare names/classes, refundable/mixed-cabin controls, seat counts, source age, wallet affordability and exact cash value. Click table column headings to sort in either direction; mobile uses flight cards. Compact is the default layout, with Roomy and a remembered AM/PM or 24-hour clock in Display preferences.

Choose an exact date or ±1–7 days. Two date requests run at a time, beginning with the chosen date; results stream into day-price tiles and a combined list. Stop cancels remaining work while preserving received results. Failed dates and programs remain explicit, and range searches remain subject to the server quota. Each direction of a return journey is still priced separately.

Fees automatically display in the visitor's country currency where hosting geolocation is available, then fall back to browser region/USD. A manual choice is remembered. Estimated FX amounts retain the airline's original charge and rate date in details; fees are filtered/sorted in the display currency. Value per point is explicitly USD cents and requires a matching USD cash fare. See [reference-data notes](docs/third-party-data.md).

## Accounts and wallet

1. Configure a Supabase project with email/password and email-link authentication.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public anon/publishable credential, never a service role key).
3. Apply the committed additive migration `supabase/migrations/20260905010000_personal_wallet.sql` to your preview database. The repository has conflicting historical claims about automatic migration deployment; verify actual application in Supabase rather than assuming a push applied it.
4. Add your local/preview/production `/auth/callback` URLs to Supabase’s permitted redirect URLs and configure the Site URL/email delivery.

The wallet stores manually entered program/currency balances, expiry dates and card nicknames. Row-level security isolates accounts. Search details compare the selected program’s balance with party cost. Transfer ratios, transfer bonuses, credit-card ingestion, and automatic balance sync are not implemented in the new flow; unverified seed ratios are not used.

Account routes verify Supabase users server-side. User IDs supplied by request parameters are ignored. Staff access requires administrator-controlled `app_metadata.role = "staff"`. No development identity bypass remains.

## Optional commercial adapters (inactive)

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

## Cash versus points

Alaska cash search runs alongside award search. Awards stream immediately; matching cash fares enrich them when available. Match every flight number, route segment, departure/arrival timestamp and cabin. Mixed-cabin comparisons are omitted. A cash failure never hides valid awards.

Value in USD cents per point = `(lowest matching cash fare − award taxes/fees) / award points × 100`. Cash fare names and refundability are shown because the cheapest fare (including Saver) may have different rules or benefits. This does not include the value of miles earned on a paid ticket. No cash comparison is invented for calendar-only results or unknown taxes.

Saved searches contain criteria only and stay on the current device. Opening one requests new results; they are not price alerts or reserved seats.

Skywards partner quotes preserve the exact party total. Per-person values for multiple adults are averages and can be fractional because the source rounds the party price. Search currently supports adults; no child quote is synthesized. The partner portal supplies all pricing after an incremental search; the adapter accumulates every response, including its terminal response, and prices every matching result in batches.

Frontier preserves cash-versus-miles bundle alternatives. A bundle named Business does not establish a business-class cabin; ambiguous seat types are explicitly unconfirmed. International Frontier currency is not verified. Aeromexico retains all supplied fare families, with AM Plus correctly treated as extra-legroom Economy. Source cash charges already include supplied taxes and fees and are not added twice.

The development-only `/build-progress` page shows the local work log, updated via `node scripts/report-progress.mjs work/progress-update.json`. Its API reads only the fixed ignored `work/live-progress.json` file; both routes return 404 outside development. It is a follow-along work log, not automated global airline monitoring.
