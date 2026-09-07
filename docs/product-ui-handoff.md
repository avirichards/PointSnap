# Option D product delivery — September 6, 2026

## What is implemented

The approved Departure Lounge direction is implemented in the actual product components: warm ivory and chalk surfaces, evergreen type, deep teal actions, restrained ticket details, compact results, accessible focus and responsive navigation. System/light/dark settings preserve existing theme cookies. Desktop booking details stay alongside results; phones use a full-height modal sheet.

Search supports explicit city airport groups (NYC, LON, PAR, TYO, CHI, WAS, YTO, OSA, SEL, BUE), keyboard-operated calendars and independent outbound/return date flexibility below each date field. Queries expand to physical airport pairs; the native endpoint rejects metro identifiers. Existing single-airport URLs remain valid. A legacy return inherits `flexDays`; an explicit `returnFlexDays=0` stays exact. Only two airport/date searches run concurrently; center dates run first. Cancellation preserves returned fares and marks incomplete checks.

Results retain every returned fare and group physical itineraries with booking-program choices. Program minima are labeled “From”; selecting a fare retains its actual points, fees, conditions, party quote and eligibility. Date prices, cabin columns and sorting use the same filtered fares. Flexible-date insights compare the same program, cabin, mixed-cabin state and eligibility, and disclose that fees and fare conditions can differ. Routine conditions are neutral; amber is reserved for restrictions/uncertainty. Advanced filters include named local presets with explicit application.

“My points” supports temporary guest balances. The optional booking guide works from the selected program and party size, accounts for expired saved balances, and explains the airline-booking/bank-transfer distinction. It uses separately reviewed US transfer rules for Chase, Amex and Capital One rather than the legacy transfer seed. Ratios, eligibility, fee and rounding distinctions are explicit. Sources and review dates are shown. Rules older than 30 days stop producing estimates; no current transfer bonus is presumed. Other countries and unreviewed banks/programs do not receive an invented calculation. No transfer is executed.

“My trips” supports temporary session shortlists or authenticated private trip storage, named outbound/return/alternative options, exact selected-fare snapshots, rename/removal, recheck links, and comparisons of up to four saved options. Guest data remains in memory and clears on reload; sign in before saving for account persistence. No automatic guest-to-account migration is attempted. The trip database migration uses owner-only RLS, composite ownership foreign keys, anonymous access revocation and bounded JSON payloads.

Explore uses the user's returned search observations from the current session. It retains source/time/eligibility, selects the latest observation per program/journey/party, preserves all current fare families, and keeps different party sizes separate. It is not a global availability index. The empty state directs users to their first search.

## Verification

- Before merging airline updates: **351 tests in 45 files passed**, including date/city fan-out, pricing/grouping regressions, transfer rounding/fees/staleness, expiration handling, observation freshness/party separation, trips input/auth/origin boundaries and real Postgres RLS behavior through PGlite.
- TypeScript and ESLint (`src`, zero warnings) passed. Optimized production build passed before the final small fixes; final integration validation is recorded below.
- Actual browser checks on desktop and phone: city selection; departure calendar keyboard movement and focus return; cabin/date price agreement; grouped booking programs; selecting and saving a more expensive flexible fare with its exact price; temporary points entry; program-specific transfer estimate; inline trip saving; two saved options compared; preset save/reset/apply/remove; loading, empty and incomplete coverage; Explore empty and populated examples; full-height phone sheet, focus trapping and Escape returning focus to the originating flight; desktop compact table and side panel.
- Fixed issues found during browser review: nested mobile save popover dismissed too early (replaced with an inline form), missing focus return after closing a flight sheet, and optional return flexibility displaying the wrong label.
- Screenshots in `docs/evidence/product-ui-2026-09-06/` show clearly labeled fixture data. Tests used a separate UI runtime, not live collector calls. No account credentials or verification messages are in these artifacts.

## Runtime and integration

UI checkout: `work/PointSnap-ui`, branch `codex/pointsnap-product-ui`, isolated preview port 3001. `POINTSNAP_UI_PREVIEW=1` disables live `/api/search` before provider invocation and enables `/design-preview`. Without the flag, the preview page returns 404 and normal live search is used. Never set this flag on the canonical live application.

The original airline task owns `work/PointSnap`, ports 3000/3002, browser profiles, credentials and worker restarts. Preserve its 200-second streams for UA/CM/QF/G3/AF and its background-browser ownership changes. No collector files were edited for this UI work.

**Database action still required:** apply `supabase/migrations/20260906010000_private_trips.sql` to the configured Supabase database using the normal migration process, then perform a signed-in browser persistence check. This isolated checkout has no account environment configuration. The migration has been exercised twice in a real local Postgres engine with two users and unauthorized reads/writes/foreign-key attachment tested, but has not been applied to the hosted database. A missing migration surfaces an explicit saved-trips error, not a false success.

**Broad search constraint:** the current server limit remains 20 searches per identity per 10 minutes. City × date windows can exceed it. The form warns for >20 combinations, requests remain capped at two concurrently, and incomplete coverage remains visible. Shared server-side batching/resumption is a stabilization item for the airline/search owner; this UI does not weaken the limit or claim full-city completeness after partial responses.

## Preserved work requiring separate services/data

- Hidden-city/unused-segment research, including the user's LAX–AUS example: requires actual full-ticket availability and pricing plus segment/baggage/return-trip implications. No inferred first-leg award is presented as bookable standalone inventory.
- Scheduled alerts: require working scheduled searches, availability rechecks and authorized notification delivery. No inert “alert enabled” control was added.
- Global destination discovery, non-US and additional bank transfer rules, current bonus ingestion, saved-wallet account tests and authenticated trip migration verification.
- Native connection completeness and reliability remain owned by the airline task. This UI release is not evidence that all airlines are connected.

The canonical requirement log remains `tasks/user-requirements.md`; this note does not replace or close its airline/data items.

## Combined validation after airline integration

Merged `codex/finish-pointsnap` through `02f7a34` into the UI branch without conflicts. **386 tests in 47 files passed**, ESLint passed with zero warnings, and the optimized Next.js production build (including TypeScript and all 27 generated pages) passed. The native source changes, background browser protections and 200-second AF/UA/CM/QF/G3 streams remain present. The UI implementation commit is `90197bc`; its merge with current airline work is `3269ea7`.

A separate production-mode runtime returned 200 for `/search`, `/wallet`, `/trips` and `/sweet-spots`, 401 for unauthenticated `/api/trips`, and 404 for `/design-preview` without the preview flag. With the flag enabled, the final 1440×1100 desktop and 390×844 phone screenshots were captured from the production build. Theme radio keyboard navigation and phone inspector focus restoration passed again. Temporary production runtime stopped after verification. The user's original dark preference and normal browser viewport were restored; the isolated development preview remains on port 3001.


## Canonical integration verification — September 7 UTC

Integrated the UI branch at 32f7976 into the canonical airline branch. The combined 390-test suite, TypeScript, focused native-source lint and optimized Next build pass. Live Virgin/Delta LAX–AUS returned all four itineraries/four fares in the actual 1440px desktop and 390px mobile app. Fare selection, full party amounts, correct First versus Business, AM/PM clocks and the dated official airline link were checked. The mobile inspector has no horizontal overflow and no page errors. This is a real backend search, not preview fixture data.

No Supabase URL, anonymous key or migration connection is configured in the canonical app. The private-trips migration has not been applied to a remote database, and authenticated cloud persistence remains unverified. Anonymous trips API correctly returns 401, coverage/search return 200, and design-preview remains 404 without its explicit flag.
