# Live data implementation and evidence

## Verified September 5, 2026 (UTC)

Live tests ran through the local Next.js `/api/search` SSE endpoint, not only standalone parsers:

| Program | Search | Observed result |
| --- | --- | --- |
| Alaska / Atmos | SEA–SFO, October 5, 2026, 1 adult | 35 itineraries, including AS725 06:39–08:49, economy 20,000 points + USD 5.60 and first 42,500 + USD 5.60 |
| Alaska / Atmos | Same route/date, 2 adults | 35 itineraries, same per-person prices, 2 passengers forwarded in booking request |
| JetBlue | JFK–LAX, October 5, 2026, 1 adult | Current v2 calendar: 22,400 + USD 5.60, 8 seats; cabin unknown (legacy endpoint returned 28,800) |
| Virgin Atlantic | JFK–LHR, October 5, 2026, 1 adult | Daily Y 39,000 / W 62,000 / J 255,000; 9 seats reported per cabin; cabin-specific fees unknown |

These are historical test observations, not promises of current availability. Sanitized fixtures preserve relevant response fields under `src/lib/award-search/fixtures`. No user credentials or session cookies are stored in those fixtures.

### Direct adapter findings

Alaska's embedded SvelteKit promise index is not stable. Flight data was in `resolve(1, ...)`, while `resolve(2, ...)` contained page content. The parser searches every promise, requires matching route rows, parses JavaScript literals with JSON5, normalizes `undefined` only outside strings, and never executes airline JavaScript. All valid rows are retained; there is no five-flight truncation. `grandTotal` and `atmosPoints` are per passenger; `allPaxTotal` and `allPaxPoints` are not used as per-person values.

JetBlue's current official client uses GET `https://jbrest.jetblue.com/bff-service-v2/bestFares/?adult=1&child=0&infant=0&origin=JFK&destination=LAX&month=october+2026&fareType=POINTS&tripType=ONE_WAY`. Its `bestFares` response is a lowest-recent-fare calendar, not a flight feed. The request and response contain no cabin or fare-family identity. The previous assumption of economy was incorrect and has been removed. Prices go in `calendarQuote`, not an invented Y cabin. Calendar summaries appear separately from flights, with retrieval distinct from verified live inventory. The current v2 endpoint and legacy POST gave different prices concurrently; they must not be merged or compared with calendar cash fares as if they represented the same flight. Taxes are not rounded to whole dollars. The adapter does not invent a flight number, departure time, arrival time, or journey duration.

Virgin's reward checker starts a temporary session via POST and returns HTTP 303. Node fetch does not retain cookies automatically. The adapter forwards returned cookies only to a validated same-origin result path, using a fresh request-scoped header; cookies are never logged or persisted. Auto-following without them returned HTTP 204. A 204 is now a provider failure, not zero availability. Month-level minimum fees do not establish cabin-specific taxes, so fees remain unknown.

## Optional commercial contracts (inactive; not the selected product direction)

### Seats.aero

Official docs: [Live Search](https://developers.seats.aero/reference/live-search), [Concepts and sources](https://developers.seats.aero/reference/concepts-copy).

POST `https://seats.aero/partnerapi/live`, header `Partner-Authorization`, explicit route, date, source and seat count. `show_dynamic_pricing: true` retains expensive awards; `smart_cache: false` prevents silent cached fallback. The parser understands a cached marker if returned, preserves currency, converts documented minor-unit taxes, and combines cabin offers for identical flight sequences. Zero/unknown seat counts remain unknown. Qatar, Turkish and Singapore do not supply fees through this contract, so zero is not assumed.

The documented 24 sources are mapped explicitly. British Airways, ANA, Cathay and LifeMiles are not invented as Seats.aero sources. A Pro subscription is insufficient for this live endpoint; commercial access is required.

### AwardTool

Official docs: [API overview](https://docs.awardtool.com/award-tool-api), [documentation index](https://docs.awardtool.com/llms.txt).

POST `https://apisv2.awardtoolapi.com/flight_trigger/search_real_time`, then poll `https://apisv2.awardtoolapi.com/flight_retrieval/search_result`. The app handles incremental result snapshots, completion, program status, duplicate results, changed offers and bounded cancellation. Source observation time controls freshness. Original-currency taxes are preserved and unknown values stay unknown.

Default program codes are the nine in the documented trigger sample: QF, AC, UA, AA, AS, AV, B6, VA, VS. Additional programs require explicit configuration and confirmation under the actual API contract. The parser does not assume all catalog programs are covered.

## Remaining external verification

- Continue direct, subscription-free access research. The user declined commercial subscriptions. No end-user airline accounts are required by the current search.
- Enable additional programs only after real anonymous responses establish route, date, cabin, price and seat semantics. Existing speculative worker code is not verified coverage.
- Verify direct sources from the intended hosting network. Airline responses may vary by IP or change without notice.
- Configure preview Supabase authentication and apply the new wallet migration; local SQL/RLS tests do not prove hosted email or redirect configuration.
- Verify production Redis and server timeout settings before enabling paid searches.

All unavailable/error states are shown per program. An enabled integration is configuration, not a guarantee of successful live results. No universal all-airline completion claim is justified yet.

## Matching cash fares and partner airlines (September 5, 03:49 UTC)

Standalone real direct-adapter checks for October 5, 2026:

| Route | Actual rows | Additional evidence |
| --- | ---: | --- |
| SEA–SFO, 1 adult | 35 | 32 matched cash itineraries; AS725 Y 20,000 + USD5.60 vs Saver USD148.42 = 0.7141 cents/point; F 42,500 + USD5.60 vs First USD673.40 = 1.5713 cents/point |
| SEA–SFO, 2 adults | 35 | 33 cash matches, per-person fields preserved; party counts passed to both cash and award requests |
| SEA–NRT | 4 | Alaska and STARLUX; AS123 Y42,500+USD5.60 vs USD791.50; JX31/JX800 Y75,000+USD49.20 vs USD702.10 |
| LAX–HKG | 12 | Philippine Airlines and STARLUX; PR113/PR310 Y42,500+USD40.80 vs USD1,522.70 |

These partner seats are ticketed with Alaska Atmos points, not STARLUX/Philippine program balances. Marketing airline names and operating disclosures come from the source. Some cash itineraries/cabins have no match and retain no computed value. JFK–LHR returned blank route metadata with no rows; the parser conservatively treats this as an unverified/failed response rather than asserting no seats.

Cash requests use Alaska's normal `ShoppingMethod=online`, omitting `awardType`. `grandTotal` is per person; no party total is treated as a per-person fare. Cash enrichment has its own deadline and failure boundary. Exact flight sequence/times and cabin must match; mixed cabin and unknown taxes do not yield CPP.

## Direct-access investigation beyond enabled sources

- United anonymous token endpoint returns a transient token without login. Actual `FetchFlights` returned HTTP428 AccessDenied. No United inventory verified.
- American public home returned403 and itinerary endpoint200 with error309 and no flights. No American inventory verified.
- Delta search endpoint returned444 AccessDenied. No Delta inventory verified.
- British Airways public finder and cabin metadata return200; a submitted search returned a high-demand blocking page. Metadata is not seat availability.
- SAS public pages tested returned403. No SAS inventory verified.
- Qantas official public finder works in a normal browser with no login and returned cached Emirates SYD–DXB records for the chosen date. Direct server requests to `/api/search` returned403. PointSnap supplies a verified prefilled handoff, but does not enable Qantas as a data source or describe these cached records as live.
- Finnair's official award instructions and Air Canada's public points-search page require sign-in. No anonymous inventory was established through those official flows.

Three bounded subagent investigations are checking the remaining independent access hypotheses. These observations do not justify universal coverage. No data subscription, paid proxy, provider inquiry, account creation or CAPTCHA solving has been performed.

## Flight-list completeness audit (September 5, 04:12 UTC)

A fresh Alaska SEA–SFO October 5 response contained 35 itineraries (9 nonstop, 26 connecting) and 68 award fares. The old parser retained all itineraries but dropped one mixed first-class fare because it classified the whole journey from its first segment. AS1390/AA2673 has a refundable-first fare of 20,000 points + USD25.60 with cabins Y/F, alongside refundable-main at 12,500 + USD25.60 with cabins Y/Y. Both are now retained, with the source fare-family name and per-segment cabins. Every supplied fare is retained in `fares`; the comparison table shows the lowest in each cabin, and details expose all fare choices. Regression tests check all 35 itineraries/68 fares and multiple families in the same cabin.

The current official Alaska frontend starts with ten rows and expands locally to `rows.length` on Show more. It does not request a second results page for this query. This establishes completeness of the returned source set on the audited query, not every possible backend routing or native partner-program award. Cash comparison intentionally uses the lowest matching cash fare in a cabin; it is not a full cash-booking engine.
