# Live data implementation and evidence

## Verified September 5, 2026 (UTC)

Live tests ran through the local Next.js `/api/search` SSE endpoint, not only standalone parsers:

| Program | Search | Observed result |
| --- | --- | --- |
| Alaska / Atmos | SEA–SFO, October 5, 2026, 1 adult | 35 itineraries, including AS725 06:39–08:49, economy 20,000 points + USD 5.60 and first 42,500 + USD 5.60 |
| Alaska / Atmos | Same route/date, 2 adults | 35 itineraries, same per-person prices, 2 passengers forwarded in booking request |
| JetBlue | JFK–LAX, October 5, 2026, 1 adult | Daily economy price 28,800 + USD 5.60, 8 seats |
| Virgin Atlantic | JFK–LHR, October 5, 2026, 1 adult | Daily Y 39,000 / W 62,000 / J 255,000; 9 seats reported per cabin; cabin-specific fees unknown |

These are historical test observations, not promises of current availability. Sanitized fixtures preserve relevant response fields under `src/lib/award-search/fixtures`. No user credentials or session cookies are stored in those fixtures.

### Direct adapter findings

Alaska's embedded SvelteKit promise index is not stable. Flight data was in `resolve(1, ...)`, while `resolve(2, ...)` contained page content. The parser searches every promise, requires matching route rows, parses JavaScript literals with JSON5, normalizes `undefined` only outside strings, and never executes airline JavaScript. All valid rows are retained; there is no five-flight truncation. `grandTotal` and `atmosPoints` are per passenger; `allPaxTotal` and `allPaxPoints` are not used as per-person values.

JetBlue's `bestFares` endpoint is a calendar, not a flight feed. Taxes are not rounded to whole dollars. The adapter does not invent a flight number, departure time, arrival time, or journey duration.

Virgin's reward checker starts a temporary session via POST and returns HTTP 303. Node fetch does not retain cookies automatically. The adapter forwards returned cookies only to a validated same-origin result path, using a fresh request-scoped header; cookies are never logged or persisted. Auto-following without them returned HTTP 204. A 204 is now a provider failure, not zero availability. Month-level minimum fees do not establish cabin-specific taxes, so fees remain unknown.

## Commercial contracts (not live-verified)

### Seats.aero

Official docs: [Live Search](https://developers.seats.aero/reference/live-search), [Concepts and sources](https://developers.seats.aero/reference/concepts-copy).

POST `https://seats.aero/partnerapi/live`, header `Partner-Authorization`, explicit route, date, source and seat count. `show_dynamic_pricing: true` retains expensive awards; `smart_cache: false` prevents silent cached fallback. The parser understands a cached marker if returned, preserves currency, converts documented minor-unit taxes, and combines cabin offers for identical flight sequences. Zero/unknown seat counts remain unknown. Qatar, Turkish and Singapore do not supply fees through this contract, so zero is not assumed.

The documented 24 sources are mapped explicitly. British Airways, ANA, Cathay and LifeMiles are not invented as Seats.aero sources. A Pro subscription is insufficient for this live endpoint; commercial access is required.

### AwardTool

Official docs: [API overview](https://docs.awardtool.com/award-tool-api), [documentation index](https://docs.awardtool.com/llms.txt).

POST `https://apisv2.awardtoolapi.com/flight_trigger/search_real_time`, then poll `https://apisv2.awardtoolapi.com/flight_retrieval/search_result`. The app handles incremental result snapshots, completion, program status, duplicate results, changed offers and bounded cancellation. Source observation time controls freshness. Original-currency taxes are preserved and unknown values stay unknown.

Default program codes are the nine in the documented trigger sample: QF, AC, UA, AA, AS, AV, B6, VA, VS. Additional programs require explicit configuration and confirmation under the actual API contract. The parser does not assume all catalog programs are covered.

## Remaining external verification

- Obtain app-owned commercial access if broad coverage is desired; no end-user airline accounts are needed.
- Verify each enabled provider/program with real keys, including route restrictions, pagination/completion, seat count semantics, mixed cabins and taxes.
- Verify direct sources from the intended hosting network. Airline responses may vary by IP or change without notice.
- Configure preview Supabase authentication and apply the new wallet migration; local SQL/RLS tests do not prove hosted email or redirect configuration.
- Verify production Redis and server timeout settings before enabling paid searches.

All unavailable/error states are shown per program. An enabled integration is configuration, not a guarantee of successful live results. No universal all-airline completion claim is justified yet.
