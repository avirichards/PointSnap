# Live data implementation and evidence

## Verified September 5, 2026 (UTC)

Live tests ran through the local Next.js `/api/search` SSE endpoint, not only standalone parsers:

| Program | Search | Observed result |
| --- | --- | --- |
| Alaska / Atmos | SEA–SFO, October 5, 2026, 1 adult | 35 itineraries, including AS725 06:39–08:49, economy 20,000 points + USD 5.60 and first 42,500 + USD 5.60 |
| Alaska / Atmos | Same route/date, 2 adults | 35 itineraries, same per-person prices, 2 passengers forwarded in booking request |
| JetBlue | JFK–LAX, October 5, 2026, 2 adults | 16 itineraries, 119 award fares and 119 exact cash-fare matches; Main Base 24,200 + USD 5.60 per adult; actual SSE search completed in 2.6 seconds |
| Virgin Atlantic | JFK–LHR, October 5, 2026, 1 adult | Daily Y 39,000 / W 62,000 / J 255,000; 9 seats reported per cabin; cabin-specific fees unknown |
| Ethiopian ShebaMiles | ADD–NBO, October 7, 2026, 2 adults | Four itineraries and five Economy/Business fares; ET318 11,000 miles each, 22,000 for the party; fees not reported; actual SSE completed in 4.2 seconds |

These are historical test observations, not promises of current availability. Sanitized fixtures preserve relevant response fields under `src/lib/award-search/fixtures`. No user credentials or session cookies are stored in those fixtures.

### Direct adapter findings

Alaska's embedded SvelteKit promise index is not stable. Flight data was in `resolve(1, ...)`, while `resolve(2, ...)` contained page content. The parser searches every promise, requires matching route rows, parses JavaScript literals with JSON5, normalizes `undefined` only outside strings, and never executes airline JavaScript. All valid rows are retained; there is no five-flight truncation. `grandTotal` and `atmosPoints` are per passenger; `allPaxTotal` and `allPaxPoints` are not used as per-person values.

JetBlue now uses the current full-flight booking contract: a fresh GET of `https://www.jetblue.com/booking/` supplies public application configuration, followed by POST `https://cb-api.jetblue.com/cb-flight-search/v1/search/NGB`. The request includes `awardBooking:true`, ADULT traveler quantity and exact `searchComponents`; no lowest-price, brand, cabin or stop filters are sent. The application marker is read from that public response per search, never hardcoded or borrowed from an end-user account. No login, browser cookies, paid subscription, member token or CAPTCHA action is required by the verified flow.

The official browser initially showed ten JFK–LAX itineraries and expanded to 16, including six connections. Its Main, EvenMore and Mint cards expand again into Base/regular/Flex fares. The same server response contains all 16 itineraries, 22 segments and 119 eligible offers. Two-adult requests retain per-person amounts: the first Main Base fare is 24,200 points + USD5.60 per adult, or 48,400 points + USD11.20 for two. The final JFK–BOS–LAX itinerary is 22,000 + USD11.20, lower in points than the date strip's 22,400 minimum. This is why the calendar is no longer the JetBlue search source. JFK–LHR returned four itineraries and 28 fares, including two connections.

Every eligible returned offer is retained. Per-fare segment references identify mixed Economy/Mint connections; EvenMore stays Economy. Sold-out and insufficient-seat fares are excluded. Missing fares, partial status, mismatched route/date/payment type, unresolved segment references, duplicate itinerary records and unexpected pagination raise provider errors. A separate `awardBooking:false` request matches cash fares by exact segments and times, brand, fare basis, booking classes and cabins. All 119 audited fares matched; 24,200 + USD5.60 versus USD326.31 yields 1.3252 cents per point. Cash failure cannot hide valid award inventory. Mixed cabins do not receive CPP under the current conservative comparison policy.

The full response parser has sanitized domestic, transatlantic and cash fixtures, stripped of session and offer tokens. The production SSE path was verified locally on September5 around05:59UTC. This establishes completeness for the audited source responses, not every route or inventory the airline could offer through other channels.

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
- Delta legacy search endpoint returned444 AccessDenied. The current native browser now returns anonymous SkyMiles inventory, but the current offers API still denies standalone requests; see the current Delta investigation below.
- British Airways public finder and cabin metadata return200; a submitted search returned a high-demand blocking page. Metadata is not seat availability.
- SAS public pages tested returned403. No SAS inventory verified.
- Qantas initially returned403 to Node fetch. This has been superseded by the compatible HTTP transport and cached-flight integration documented below; no live-verification claim is made.
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

## Virgin Atlantic current full-search boundary (September5 06:09UTC)

The dedicated `/advanced-search/reward-flight` page rendered a functioning anonymous search form. Submitting JFK–LHR October5, one adult, one-way, Reward Seats redirected to `identity.virginatlantic.com` Flying Club login before inventory. The redirect state identifies the current `/en-US/flights/search/slice` journey with `awardSearch=true`. No account was used. The current calendar client expects separate `month=10` and `year=2026`; PointSnap’s former `month=2026-10` handoff produced a malformed query and has been corrected. This is a verified normal-flow login gate, not evidence that every possible public partner source is unavailable.

## United current browser requirement (September5 06:08UTC)

The EWR–LHR October5 award results page loaded with Miles selected, recognized route/date/one adult and an initial sign-in dialog. After dismissing that dialog, it displayed “Continue shopping?” and explicitly required sign-in to see flight results with miles; only cash search, sign-in or home navigation were offered. This newly verifies the current normal-flow membership gate. It does not turn anonymous token issuance or partner awards into native United availability.

## American anonymous browser / server comparison (September5 06:30UTC)

The current `/booking/search/find-flights` form, with one-way, Redeem miles, JFK–LAX October5 and one adult, rendered 40 award itineraries without login. Public SSR `script#ng-state` contains all 40 slices with full segment schedules and economy/premium/business/first product prices. AA171 at06:00 showed27,500 economy /40,000 premium /133,000 business plusUSD5.60. The current Angular client submits `searchRequest` by ordinary form POST to `/booking/choose-flights/1?sid=<fresh browser UUID>`; award search initialization is a no-op (only revenue uses the separate experience initializer). Fresh app-owned home sessions followed by the current form POST returned Challenge Validation; source-derived JSON itinerary requests returned error309. Browser visibility is therefore established, but an app connector remains unverified. No account cookies, security challenge solutions or browser-issued session identifiers were copied into PointSnap.

## United-operated flights through TrueBlue (September5 06:38UTC)

Fresh calls through the working JetBlue adapter returned9 LAX–MEX itineraries and5 EWR–LHR itineraries for October5, one adult, all operated by United. These are TrueBlue partner awards, not MileagePlus inventory. EWR–LHR includes UA934 at08:20. Exact cash-fare identity did not match these partner award products, so no value-per-point is invented. Coverage is proven for these responses, not all United routes or every MileagePlus fare.

## Additional browser/server verification (September5 07:00UTC)

American's source-derived JSON request still returned error309 with a fresh public home session and the matching X-XSRF-TOKEN header. This rules out the omitted normal CSRF header as the sole cause; the browser-rendered awards are not yet a reproducible application source.

Ethiopian's ordinary anonymous booking form successfully returned an ADD–NBO October5 one-adult Economy award at11,000 ShebaMiles, departing23:35 and arriving01:40 the next day, with one reported seat. No login was used. This changes the browser finding from unverified to inventory visible. A separate fresh app-owned normal booking initialization request to the current /api/graphql still returned HTTP403 before air search; no native connector is enabled and fees/full-cabin/party completeness remain unverified.

## Additional partner and browser checks (September 5)

Fresh TrueBlue JFK–AUH October 5 returned two Etihad-operated itineraries. EY2 was 45,700 TrueBlue points plus USD7, with nine seats reported. LAX–TPE on the same date returned three United-operated connecting itineraries and no China Airlines awards. This verifies additional Etihad partner coverage in the existing TrueBlue connector, not a native Etihad Guest connection, and does not establish China Airlines availability on other dates.

The ordinary Turkish award form loaded anonymously, but entering the origin triggered an explicit Press & Hold human-verification challenge before a search could complete. The challenge was not solved. Combined with the earlier valid anonymous request schema and denied inventory response, this is a current access barrier rather than proof that every Turkish award search requires a member account.

American native browser LAX–AUS September 7 returned40 itineraries, including nonstop AA4945 at32,000 AAdvantage miles + USD5.60 (16:09–21:21) and AA6409 at76,500 + USD5.60 (09:05–14:19). This confirms native inventory absent from the current partner-feed results. A new fresh app-owned chain—home, current booking entry, dated API with the matching normal CSRF token—returns200,403,then error309 respectively. A separate standard HTTP/2 client was denied at the homepage. The failure is present before the inventory request, not simply a missing fare parser. No trusted edge headers, browser credentials, security tokens or challenge solutions were copied or forged.

## American completeness candidate and further United checks (September 5, 08:00 UTC)

A fresh normal American search returned 40 itineraries and 69 available award fares for LAX–AUS September 7, one adult. Its current response places pricing on the itinerary, not the first segment. The obsolete Python implementation caps output at six itineraries and does not match this response contract; the new search engine does not use that implementation. A new TypeScript candidate parser and sanitized 40-itinerary fixture now preserve every supplied fare, partner flight, local timestamp, overnight arrival, regional-carrier disclosure and decimal fee. Zero in AA's low-seat-count field remains unknown when `productAvailable` is true. Invalid/partial responses, incorrect passenger totals, ambiguous cabins and broken connections fail explicitly. This parser is **not an enabled live source**; a fresh public search deeplink also returned403 after homepage200. No test fixture is inserted into user search results.

Working TrueBlue partner searches additionally returned two United SFO–TPE itineraries for one adult (UA871: 55,000 points + USD5.60) and four United EWR–LHR itineraries for two adults (UA14: 40,000 points + USD5.60 per person), all for October5. This is confirmed partner-program coverage, not native MileagePlus access. The native United browser still explicitly requires sign-in. No China Airlines award was returned in the tested SFO–TPE response; this is not evidence of unavailability on other dates/routes.

Turkish's currently published `homepage.searchAwardTicket` browser tool was tested through its supported interface for IST–LHR October5, one adult, economy. It returned a technical error; the page displayed human verification and the availability-validation request reported403. No challenge was solved and no Turkish inventory was enabled.

American's current public client also creates an ordinary `spa_session_id` UUID and sends the same value as its correlation header. Reproducing that normal bootstrap with a fresh app-owned UUID (not a copied browser/session credential) still returned itinerary error309; the current form POST returned200 with the title “Challenge Validation,” not flight results. HTTP200 alone must never mark this connection successful.

Actual PointSnap browser verification of the EWR–LHR two-adult search showed all four United partner itineraries after the airline filter was applied. UA14 details retained the TrueBlue program, 40,000 + USD5.60 per person, 80,000 + USD11.20 for two, nine reported seats, local overnight times, and a JetBlue handoff with adults=2. The full search contained 40 itineraries across working sources; no native American fixture was inserted.

## Further official browser entries (September 5, 08:25 UTC)

British Airways' public Reward Flight Finder was tested with London and New York explicitly selected from its suggestions, October5 entered after city selection, one-way and one adult. Submit returned the same finder form without flight inventory. The browser also reported legacy web-component polyfill errors; this browser failure does not establish a permanent or global access block. Earlier app-owned form submission returned a high-demand page.

Iberia's public Avios explorer displayed destination/date minima without sign-in. Its explicit “BOOKING WITH AVIOS” full-booking link then redirected to the Iberia login page. This confirms a membership gate in the tested native booking path, in addition to the previously recorded anonymous-app-token200/availability403 response. Explorer minima are not substituted for a full dated itinerary feed.

An additional American check explicitly preserved fresh cookies across normal same-origin redirects and respected their paths. The homepage returned200 directly, with no intermediate redirect; the booking entry still returned403 before form submission. This rules out dropped redirect cookies as the cause in that tested path. The check stopped at that failure, without issuing another inventory request or using a browser session. Native American remains unconnected.

The local follow-along page had stopped accepting its report because nine historical events used `title`/`detail` instead of the required `airline`/`kind`/`message` fields. Those entries were repaired without losing their text, IDs or timestamps. The reporting script now validates the full merged snapshot before replacing the last readable file. Two regression tests verify valid status/history merging and rejection of incompatible events without changing the existing report. All132 tests pass; the actual browser page again displays all33 programs and the retained event history.


### Current Delta guest offers investigation (September5, 17:25 UTC)

The current native booking app8.0.31 successfully searched LAX–JFK October5, one adult, one way, Shop with Miles without login. It returned46 itineraries after20/20/6 pages, including nonstops and connections. This is browser evidence, not an enabled PointSnap connection. DL96021:00–05:21+1 and DL91523:55–08:14+1 each displayed19,800 SkyMiles plus roundedUSD6 in Main; the exact cash fee must come from the source currency amount, not the rounded UI label. DL979's product dialog identifies Main Basic(NE); the product-information dialog is not itself an exhaustive fare-choice listing.

The actual rendered resource list and published SFAF configuration agree on `https://offer-api-prd.delta.com/prd/rm-offer-gql`, replacing the old presumed `/shop/ow/search` path. Current public request code explicitly uses `Authorization: GUEST` for anonymous search. No login token is required by that client branch. Its `gqlSearchOffers(offerSearchCriteria: OfferSearchCriteriaInput!)` takes FLIGHTS product group, per-passenger ADT customers, MILES pricing, origin/destination/date, resultsPageNum starting1 and resultsPerRequestNum20. Load More requests the next numbered page. `offerDataList.responseProperties` contains pageResultCnt and pagination metadata. The response includes per-leg brands, full offer arrays and exact currencyAmt, rather than only the visible cabin minimum.

Three bounded app-owned transport checks returnedHTTP444 AccessDenied: fresh standalone GUEST, ordinary origin/referrer context, and fresh home→booking initialization with only correctly scoped cookies issued to that new HTTP session. Home and booking initialized200 in the third check. No browser session identifiers, member cookies, challenge solutions or browser-only state were reused. The contract is now mapped but still needs reproducible server transport before integration. Request/response and source-inspection scratch evidence is under `work/delta-current/`. Work continues with other unverified native flows rather than treating this denial as a project endpoint.


### Current Southwest anonymous browser comparison (September5, 17:30 UTC)

The ordinary current homepage points search handed off to air-booking112.0.3, not the previously inspected air-booking-v2 version13.0.1. DEN–LAS October5, one adult returned26 visible itineraries and104 priced fare buttons across Basic, Choice, Choice Preferred and Choice Extra, including nonstop WN1627 at07:25–08:30 for9,500 points +USD5.60 Basic. No login was used. The rendered resource inventory confirms the same `/api/air-booking/v1/air-booking/page/air/booking/shopping` API. A fresh application request using the current air-booking public config/key/version, request-local cookies and normal search parameters still returned403050700. The different booking version was a real untested lead, but it did not resolve transport. Native browser visibility is established; no Southwest source is enabled. Scratch evidence: work/southwest-current/.

## Fresh transport and American handoff comparisons — September 5

Browser-compatible HTTP/TLS negotiation was tested with a fresh curl_cffi Chrome session, normal TLS verification and app-owned cookies. American home and booking entry returned small HTTP200 bodies without flight state; its form POST returned HTTP200 titled Challenge Validation. Delta home and full booking page returned200, but its current GUEST offers request returned429 with an explicit cpr_chlge marker. Southwest home, booking entry and current112.0.3 configuration loaded, but shopping remained403050700. No challenge was solved, browser cookies copied, proxy purchased or trusted edge headers forged. These tests rule out HTTP/TLS negotiation alone as the fix in the tested sessions.

American's public SSR response confirms en-US/US, Award, one-way and the requested LAX–AUS September7 route, with cached:false. A fresh normal browser search still returned40 itineraries, including both nonstops. Prices changed from the earlier observation: AA4945 Main37,000/First44,000 plusUSD5.60; AA6409 Main83,500/First107,500 plusUSD5.60. Historical fixture amounts must not be shown as fresh prices. The source-derived itinerary and separate weekly endpoints both returned error309 with a fresh homepage cookie/CSRF/correlation session; weekly did not supply a fallback calendar.

The official Redemption Deals widget was also followed through its actual UI. It uses an alternate simple from/to/depart public booking deeplink, then the same choose-flights application; the native browser again rendered40 itineraries. A fresh server chain fetched the redemption page200 but received403 at that source-observed booking handoff. The deals page itself explicitly describes prices collected within24hours and supplies no complete live flight list. It is not an alternative native flight feed. Scratch evidence: work/american-current/redemption-handoff-summary.json, weekly-probe-summary.json and the three browser-transport summaries.


## Ethiopian anonymous source enabled (September 5, 2026)

A fresh Node session now reproduces the public Sabre booking flow: GET `/dx/ETDX/`, the anonymous GraphQL `init`, then `bookingAirSearch`. Supplying the ordinary browser User-Agent changed init from403 to200. This does not reuse any member account, browser session, solved challenge, paid subscription, or Python service. Correlation/application identifiers come from fresh public HTML; cookies and the execution key exist only within that request and are never exposed in handoff links.

The normal airline booking form offers Economy and Business. Both are queried sequentially; all supplied exact-date unbundled and branded offers are retained. Neighboring-date calendar minima are not substituted for flight inventory. Sabre `@id`/`@ref` references must be resolved, or connecting options disappear. One-person ADD–NBO October7 returned four Economy itineraries (11k,33k,48k,48k), matching the four itineraries in the ordinary anonymous website. A full two-cabin Node search returned five itineraries/nine fares for one person. Two adults returned four itineraries/five fares through PointSnap: Economy totals22k and96k; Business totals108k,153k,153k. Amounts are party totals, normalized per adult while retaining exact party values. LHR–NBO October5 additionally verified a two-segment overnight itinerary, ET701/ET308,35,500 miles and1,600minutes.

ET43 DAR–LLW includes a30-minute BLZ stop on the same flight. The source itinerary has three stops despite only three flight segments. The model now preserves technical stops separately; stop counts, Nonstop/maximum-stops filters, via/avoid airport filters, table summaries and itinerary details account for them without inventing a plane change. UTC offsets are retained and durations reconciled.

The tested search responses report only FFCURRENCY (miles), with empty cash-tax alternatives. Fees are explicitly unknown, never zero or included in miles; cents-per-point values are not fabricated. The browser verified per-person/party toggle, all five two-person fare choices, same-flight stop detail, and Business handoff with the selected cabin and passenger count. Eight new regression tests preserve the observed full responses and cover failures, shared references, passenger normalization, monetary alternatives, stops and fresh session isolation.

Fresh follow-up transport tests on American, Delta and United used the same browser User-Agent. AA still returned itinerary error309 and form Challenge Validation; Delta home/full booking bootstrap returned200 but its current offer API returned444; United anonymous token returned200 but FetchFlights returned428. These outcomes do not establish universal impossibility, and none was enabled as native live inventory. Finnair's current offer API remained403 and Smiles406 with the alternate HTTP client.


## Qantas cached flight source enabled (September 5, 2026)

The official public finder at https://flightrewardfinder.qantas.com returns cached Classic Reward itineraries anonymously through the open-source Node `impit` client (pinned0.14.4). Node fetch and system curl returned403; a fresh compatible HTTP request returned200 without an account, copied browser cookies, proxies, challenge solving or disabled TLS verification. The application preserves the airline’s original `lastSeenAt`, separately records retrieval time, and labels each offer Cached · recheck. The official Check availability action works in its normal browser, but its public client requires Turnstile verification; PointSnap does not replay that browser proof or pretend the cached search is an immediate recheck.

Actual application SSE: JFK–LHR October5, one adult,16 itineraries/21 fare choices in2.8seconds. Both native10/6 pages were fetched; a repeated, inconsistent, failed or canceled page never produces a successful complete result. All supplied cabins, original fees, local times, flights and mixed-cabin booking classes are retained. SYD–DXB one adult:3 Emirates itineraries/5 fares. Two adults:3/4; points and fees stay per person, and the one-seat First fare disappears. The real app displays AUD fees converted to the viewer’s USD currency while retaining original charges. EK417 First carries the source’s Silver-or-higher and traveler-age eligibility note. No cash-fare value is fabricated from the source’s cash-equivalent points field.

Coverage is the public finder’s international routes and offered partners, not every Qantas fare or Australian domestic service. Domestic queries explicitly return DOMESTIC_AU_ONLY and are shown as unsupported, not sold out. Self-transfer combinations are disabled by the native request parameter; an unexpected separate-ticket response fails the contract instead of being merged into an ordinary award. The finder counts flight changes, and QF1 SYD–LHR omits its intermediate same-flight stop. These records retain their itinerary but display Direct · check stops and cannot satisfy a confirmed maximum-stops filter. Source fees with an unidentified currency fail rather than being assumed USD.

Seven new regression tests cover all21 two-page fares, passenger amounts, cached timestamps, mixed cabins, QF1 stop uncertainty, source errors, currencies, repeated pages and cancellation. Full147 tests pass. Real browser checked the cached label, original/converted fees, First eligibility and the correct prefilled Qantas handoff.

### Hosted transport experiment

GitHub Actions Linux/Node22 diagnostic run33984381515 independently reproduced Ethiopian ADD–NBO October5:2 itineraries/3 fares. American’s fresh anonymous homepage returned200, current itinerary API returned309, and normal form returned Challenge Validation, the same as local Node. Qantas default Node fetch still403.

Follow-up run33985079120 tested the exact Qantas adapter with impit on hosted Linux. It returned403 after90ms, while Ethiopian again returned2 itineraries/3 fares. Qantas works in the local optimized Node22 server (16 itineraries/21 fares), but that does not establish hosted runtime access. Both GitHub CI runs for commit a057a35c passed; build success must not be confused with source connectivity. These diagnostics test GitHub's network, not Vercel's. Vercel’s existing preview is protected by SSO; no login or protection change was made.
