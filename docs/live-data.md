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
- American current public home session returns200 with a fresh XSRF cookie; booking submission returns403 and the itinerary endpoint returns200 with error309. No American inventory verified.
- Delta search endpoint returned444 AccessDenied. No Delta inventory verified.
- British Airways public finder and cabin metadata return200; a submitted search returned a high-demand blocking page. Metadata is not seat availability.
- SAS public pages tested returned403. No SAS inventory verified.
- Qantas official public finder works in a normal browser with no login and returned cached Emirates SYD–DXB records for the chosen date. Direct server requests to `/api/search` returned403. PointSnap supplies a verified prefilled handoff, but does not enable Qantas as a data source or describe these cached records as live.
- Air Canada's public points-search page requires sign-in. Finnair's current offer-list request was tested directly and returned403; no anonymous inventory was established.

Parallel investigations also tested current anonymous app flows and partner booking portals; findings are recorded below. These observations do not justify universal coverage. No data subscription, paid proxy, provider inquiry, account creation or CAPTCHA solving has been performed.

## Flight-list completeness audit (September 5, 04:12 UTC)

A fresh Alaska SEA–SFO October 5 response contained 35 itineraries (9 nonstop, 26 connecting) and 68 award fares. The old parser retained all itineraries but dropped one mixed first-class fare because it classified the whole journey from its first segment. AS1390/AA2673 has a refundable-first fare of 20,000 points + USD25.60 with cabins Y/F, alongside refundable-main at 12,500 + USD25.60 with cabins Y/Y. Both are now retained, with the source fare-family name and per-segment cabins. Every supplied fare is retained in `fares`; the comparison table shows the lowest in each cabin, and details expose all fare choices. Regression tests check all 35 itineraries/68 fares and multiple families in the same cabin.

The current official Alaska frontend starts with ten rows and expands locally to `rows.length` on Show more. It does not request a second results page for this query. This establishes completeness of the returned source set on the audited query, not every possible backend routing or native partner-program award. Cash comparison intentionally uses the lowest matching cash fare in a cabin; it is not a full cash-booking engine.

## Skywards easyJet / Jet2 partner awards — new live flight source

Official [easyJet](https://www.emirates.com/english/skywards/partners/easyjet/) and [Jet2](https://www.emirates.com/english/skywards/partners/jet2/) pages link to the anonymous partner portal and state that taxes and surcharges are included in its miles price. This source covers these partners, not Emirates-operated Classic Rewards, and that limitation is displayed in Programs and search coverage.

Production adapter verified from local Node and the actual Next.js SSE endpoint on September 5, 2026:

| Query for October 5 | Result |
| --- | --- |
| LGW–AMS, 1 adult | 6 easyJet flights; U28672 06:00–08:20, 5,759 Skywards miles, 80 minutes |
| LGW–AMS, 2 adults | 6 flights; U28672 exactly 11,517 miles for the party, average 5,758.5 per person |
| MAN–ALC, 1 adult | 4 flights, two easyJet and two Jet2; LS881 16:55–20:50, 7,200 miles |
| BER–PMI, independent source probe | U27336, 8,288 miles; still U2 marketing prefix |
| LGW–LTN, source probe | Confirmed terminal empty response; no render request attempted |

The ordinary initial GET is `https://partnerrewards.emirates.com/search.php` with `a=flightsearch`, `filter_method=relaxed`, IATA route, US-formatted `outboundDate`, blank return date, `numPassengers`, `searchByAge=1`, repeated `passengerAge[]=18`, `oneway=1`, and `sb3_selectbox_custom=oneway`. A new anonymous cookie and 302 result location are issued; no account is used. This same fresh search link is the booking handoff. Temporary result IDs and cookies are never included in PointSnap results, persisted, or logged.

`GET results/{own-session-id}?m=checkStatus&i=N` returns incremental deltas. The final response can contain new flights, or an empty results array and `success:false` after earlier successful rows. Source frontend permits omitted results while pending, treats 0/1 as pending and 2/10 as SearchComplete. Accumulate all valid deltas before rendering. Surrounding dates are returned too; require exact route and requested departure date. POST `m=renderResults`, `pricemode=t`, and all matching own-session `results[]` in batches of 20 returns actual miles and schedules. Internal `cost.c` is a cash-equivalent bookkeeping value, not cash fees. Never derive award fees or CPP from it.

The adapter retains the exact quoted party miles and uses a per-person average only for comparison. Source seat counts are not provided. Search UI currently selects adults only; a source child test had different pricing, so adult multiplication is not a valid child quote. All returned rows must parse successfully; a missing flight, unexpected date, unknown price, access denial or timeout becomes a source error, never a complete empty result. Cheerio parses only returned markup; it does not execute scripts.

## Additional current access boundaries

- Turkish: real anonymous award flag `awardTicketWithoutLoginActive:true`; IST–JFK Oct5 Economy validation succeeds. The actual `/api/v1/availability` POST returns HTTP200 with 3,858-character access-denial HTML, not inventory. Do not label Turkish universally login-required.
- Iberia: normal anonymous frontend application token succeeds, expiring in900seconds. Full MAD–JFK award `/api/sse-rpa/rs/v1/availability` POST returns403 Access Denied,425characters. Token issuance is not flight coverage; no token was saved. Do not label this an end-user login failure.
- Finnair: exact current award offer-list endpoint `https://api.finnair.com/d/fcom/offers-prod/current/api/offerList` returns403 for HEL–JFK. Lufthansa/Miles & More public entry pages return403 before a query; Qatar's official finder link returns401 before a query.
- Cathay: anonymous calendar/config can return cached minima and H/L/N markers, not complete flight lists. Full entry uses queue/sign-in. Singapore's current redemption toggle invokes login. Emirates native Classic Rewards page requires login; its working partner portal is separate.
- Etihad and Saudia: current official award/loyalty flows return interruption pages in these tests. These results do not establish the absence of all other possible anonymous paths.

## Frontier Miles — complete supplied domestic results

A fresh anonymous public session followed the official miles handoff into `/Flight/InternalSelect`, then `/Flight/Select`. The returned page embeds HTML-encoded `FlightData`; this is parsed as data, never executed. The DEN–LAS October 5, 2026 two-adult search returned **25 itineraries, 45 flight segments and 175 fare/payment alternatives**, all preserved by the adapter and verified through PointSnap’s SSE endpoint. Source prices are explicitly per person, taxes included. F92349 was 7,500 miles + USD5.60 per adult.

Each itinerary retained Basic plus Economy/Premium/Business bundle alternatives paid partly in cash or with additional miles. Source party size changes some bundle cash prices, so every request forwards the actual adult count. A Business bundle does not identify its actual seat/cabin type: the adapter preserves the bundle name but marks cabin unconfirmed and does not invent a J fare. This source is currently limited to verified US domestic/USD quotes. Unknown international currency, missing journeys, malformed segments and incomplete fares fail explicitly. Nine regression tests cover the actual single/party response sets, timing, full fare counts, capacity, incomplete data and session/redirect handling.

## Aeromexico Rewards — anonymous full flight search

The current public BF client performs anonymous PCC and route-region lookups, then POSTs its one-way points request to `https://amx-c-bkngbk-pd.aeromexico.com/bc/ow/search/flight/points`. It uses a literal public application marker, not a member token, grant token or copied browser session. Request market and loyalty zones come from those lookups. The adapter uses a fresh transaction identifier and the current official MX points storefront.

Verified October 5, 2026 searches: MEX–CUN one/two adults each returned **11 itineraries and 98 eligible fares**; GDL–CUN returned **25 connecting itineraries and 237 fares**. The two-adult MEX–CUN query was also verified through PointSnap’s actual SSE endpoint. Passenger counts change source fare buckets and availability; the adapter never multiplies a one-person query into an assumed two-person quote.

Points and `currency.totalCash` are per person. For the observed lowest MEX–CUN fare, 9,700 points + **943 MXN** already includes source taxes/TUA/booking fee. These components must not be added again. All supplied Classic and Dynamic fare families are retained. MAIN and AM_PLUS map to Economy; BUSINESS maps to Business. AM Plus is extra-legroom Economy, as described in the [official ancillaries page](https://www.aeromexico.com/en_us/ancillaries). Refundability is unknown unless explicitly supplied; Flex is not proof. Per-segment cabins on connections are not assigned from the source’s reference fare. No cash-ticket CPP is invented from an award’s taxes.

The current client maps every outbound itinerary and retains its fare list locally, with no pagination found in these responses. Fixtures preserve all three observed source sets and metadata; eight tests cover full itinerary/fare counts, actual party repricing, fees, cabin mapping, connection durations, capacity and incomplete responses. This establishes completeness of the returned source set for the tested queries, not a guarantee that the airline will expose every theoretical routing or never change its backend.

## Further access findings

- LifeMiles: the current official configuration disables anonymous redemption and enables required login. The active frontend selects private flight endpoints. Earlier public endpoints returning404 belong to a disabled flow; this is a login gate in the current tested application, not zero award availability.
- Southwest: current official shopping POST returns403 with code403050700. Smiles current anonymous flight API returns406; Azul bootstrap403; Copa entry401 with CAPTCHA. No inventory was claimed from these responses.
- Air New Zealand partner rewards require an authenticated account and account-scoped authorization; Velocity Quick Compare and ANA award flow require sign-in in the tested public routes.
- Spirit’s official site redirects to its restructuring notice, reporting operations ended May2, 2026; no future award connector was enabled.
- Each status describes tested requests only. Blocked, login-required and not-yet-verified are distinct, and none establishes that every imaginable access path is exhausted.

## Seats.aero research using the authorized Pro session

The user subsequently supplied an existing logged-in Pro session for research. The current UI showed cached and recently checked rows together, and a normal JetBlue refresh completed with “Checked just now.” JetBlue details included two nonstop and two connecting economy options on JFK–LHR October5. Its unchecked “Show all dynamic results” control confirms default filtering; these displayed rows are not proof of every airline fare.

The public browser-delivered Vue modules load summary metadata from Seats.aero, start server-authorized live candidates through Seats.aero’s own backend, merge returned results and poll revalidation status. The inspected frontend does not implement the airline connectors; the referenced source maps returned404. A focused repository search found third-party API clients, not a verified official backend source release. No claim is made about Seats.aero’s private airline-session, proxy or data-partnership methods.

Official documentation separates [cached API access for eligible Pro users](https://developers.seats.aero/reference/getting-started-p), [commercial Live Search](https://developers.seats.aero/reference/live-search), and [queued refreshes](https://developers.seats.aero/reference/refresh-cached-data). Its [status page](https://seats.aero/status) also reports source-specific outages while cached search remains available. The existing personal account was used for research, not installed as a shared PointSnap data source. No key was generated, extracted or committed, and no additional subscription was purchased.

## Final focused checks — September 5, 05:10 UTC

Ethiopian’s current official booking app and versioned metadata return200 without login. The active transport is `/api/graphql`; a normal fresh anonymous `getSession` request returns403 with an Incapsula interruption before `init` or the dated search. The prior config404 referred to an inactive configuration path. Public award flags and one-passenger display configuration are not flight inventory or verified raw price semantics. No adapter was enabled from this metadata.

Air France and KLM source-derived JFK–CDG October5, Economy, one-adult REWARD landings both return200 normal HTML with header/footer state only. Anonymous session checks return `isLoggedIn:false`. Their matching current search modules explicitly require login for `bookingFlow === REWARD`, preserve the search context, and invoke the login flow. No full-flight response was obtained or enabled. This verifies the member gate in the tested application, not that every conceivable data path requires authentication.

Code milestone `0a72b75` passed GitHub frontend/Python checks and Vercel preview build. The preview remains authentication-protected; successful deployment does not verify airline reachability or hosted auth/migration behavior. Source access and universal completeness remain unfinished.
