# Agent 6 — Community Intel on Airline Award Scraping

Comprehensive community-knowledge sweep of FlyerTalk, Reddit (limited — Reddit blocks Anthropic's user-agent), Hacker News, niche blogs, GitHub OSS, and tooling chatter. Goal: surface specific endpoints, hidden parameters, anti-bot tricks, and operational lore for the 23+ airline scrapers PointSnap is rebuilding. Cap on coverage: Reddit and seats.aero's own forums returned HTTP 403 to programmatic fetching — most "community" intel below comes from FlyerTalk search results, niche blogs, GitHub source code, and one Hacker News thread. Many of the most useful leads are in **GitHub OSS scrapers** because they contain literal endpoint URLs and request bodies, not just opinions.

---

## FlyerTalk findings

### 1. "AC files suit against seats.aero" thread (16 pages, 2023–2024)
URL: `https://www.flyertalk.com/forum/air-canada-aeroplan/2138872-ac-files-suit-against-seats-aero.html` (multi-page; HTTP 403 to direct fetch but surfaced in search snippets)
Insight: Air Canada's lawsuit alleged that on a single day seats.aero displayed 265,552 routes through Aeroplan, "reflecting at least 265,552 shopping requests to Air Canada's API within the previous two days." Each shopping request also "generates a large number of collateral availability requests sent to partner airlines, and a single shopping request can result in as many as 100-300 availability requests." Community analysis on the thread says seats.aero "uses the exact same API endpoints that were used to scrape the data… makes requests using publicly available tokens found in JavaScript to API endpoints, with the structure being the same whether a browser makes the request or code does." Takeaway for PointSnap: AC's own JS leaks anonymous bearer tokens that the API will accept; the same is likely true for several other carriers.

### 2. "Award Availability Search Tools Use of Web Data Scraping" (2024 thread)
URL: `https://www.flyertalk.com/forum/travel-tools/2137686-award-availability-search-tools-use-web-data-scraping.html`
Direct fetch returned HTTP 403. From search results: thread discusses AwardFares as operating "through API connections to respective platform" — i.e. not all award engines scrape; some have negotiated API access.

### 3. "Flightplan: How to search a year of award inventory [no longer maintained]"
URL: `https://www.flyertalk.com/forum/travel-tools/1918538-flightplan-how-search-year-award-inventory.html`
Author: lg (also Flightplan/AwardWiz GitHub owner). Tool uses Puppeteer / Headless Chrome to drive airline sites and record HTML; results saved to local DB. Confirms that the de-facto OSS approach 2018–2024 has been browser automation rather than direct API.

### 4. "ExpertFlyer no longer offering *A award/upgrade inventory data/alerts? Alternatives?"
URL: `https://www.flyertalk.com/forum/united-airlines-mileageplus/2137627-expertflyer-no-longer-offering-award-upgrade-inventory-data-alerts-alternatives.html`
Late 2024 ExpertFlyer "removed all Star Alliance airlines, Virgin Australia, and Vistara from award and upgrade search." Community theorized "ExpertFlyer was potentially using United's website to search award availability, as United is the only airline that displays award availability for all of these partners." Important: this confirms united.com's partner-availability page is the de-facto Star Alliance award oracle.

### 5. "Data Sources Used by Award Search Engines"
URL: `https://www.flyertalk.com/forum/travel-tools/2150969-data-sources-used-award-search-engines.html`
Quoted in search snippets: "award alerts/notifications, for some airlines, are too instant/immediate to be triggered via web scraping" (i.e. some tools have actual GDS / API access for select carriers, not scraping). Direct fetch 403.

### 6. "Best tool to search for award availability" — r/AA forum
URL: `https://www.flyertalk.com/forum/american-airlines-aadvantage/2154362-best-tool-search-award-availability.html`
ExpertFlyer described as using "a robotic script which mines the GDS and also scrapes the more granular aircraft cabin data directly from airline websites." Combination GDS + airline-website scrape model.

### 7. "Award Seats API/Data?"
URL: `https://www.flyertalk.com/forum/information-desk/1755269-award-seats-api-data.html`
Surface mentions of "dummy accounts with various travel service providers from which they sweep GDS data, and ask users to enter their own frequent flyer account information so that they can question airline/alliance search forms to scrape that data." Confirms multiple tools require user-provided FF credentials to access partner award space.

### 8. "Matrix ITA but for award flights?"
URL: `https://www.flyertalk.com/forum/travel-tools/2036311-matrix-ita-but-award-flights.html`
ITA Matrix's `f bc=` fare-bucket syntax often referenced for finding award buckets (I, X, O, etc.). The Matrix is owned by Google but still works for inferring availability via published fare-class filters.

### 9. "Flight Search API Options (with Fare Class Filter)"
URL: `https://www.flyertalk.com/forum/travel-tools/2064199-flight-search-api-options-fare-class-filter.html`
Community pointers to commercial APIs (Duffel, Amadeus, Travelport) vs DIY scraping. ITA Matrix scrape mentioned as fragile due to throttling.

### 10. "Pointsme vs Seats.aero vs Roame vs PointsYeah vs anything else"
URL: `https://www.flyertalk.com/forum/travel-tools/2151694-pointsme-vs-seats-aero-vs-roame-vs-pointsyeah-vs-anything-else-best.html`
Community consensus: seats.aero is cache-based with multi-hour refresh; point.me is live but slow and 1-route-at-a-time; AwardFares is live on paid tiers, cached on free tier; PointsYeah and Roame are both cache-based with phantom-availability issues.

---

## Reddit findings

Reddit (`reddit.com`) blocks Anthropic's user-agent, returning HTTP 400 to all WebSearch and HTTP 403 to WebFetch. No direct Reddit thread content was retrievable in this sweep. Recommend running this slice from a real browser or with an authenticated Reddit MCP server. Known relevant subs and channels to mine manually:
- `r/awardtravel` (general)
- `r/churning` (specific scraping discussions occasionally surface)
- `r/awardhacking`
- `r/dataisbeautiful` (occasional award-data visualizations expose data sources)
- `r/webscraping` (airline-specific protection discussions)
- Posts from the seats.aero developer ("ammonbartram") on r/awardtravel are historically informative.

---

## Twitter/X findings

No Twitter/X content was retrievable via WebSearch in this sweep (search hits returned blog reposts only). Known accounts to monitor:
- `@seats_aero` — operator status, supported program updates
- `@pointme` — feature announcements
- `@awardfares` — feature announcements
- `@aviationswagger` (independent reviewer)
- `@FrequentMiler` — practical award-tool reviews
- Recommend grepping Twitter via the X API for `award OR scrape OR API` mentions of `aa.com`, `united.com`, `aircanada.com`, etc.

---

## Hacker News findings

### HN item 41100886 — "Show HN: AwardLoop" thread (Jul 31, 2024)
URL: `https://news.ycombinator.com/item?id=41100886`
Operator pitched a 365-day real-time search across loyalty programs. Direct fetch 429-rate-limited. Surfaced in search: "list of common competitors: 1. https://www.point.me/ 2. https://seats.aero/ 3. …". HN comments often dig into the technical mechanics of award scraping; thread is worth a manual revisit.

### HN item 12736433 — "How does one gain access to flight schedules/fares?"
URL: `https://news.ycombinator.com/item?id=12736433`
2016-era thread but enduringly cited; references ITA Matrix as the de-facto unofficial backend for Kayak, Orbitz, Google Flights, and various OTAs.

---

## Niche blogs

### One Mile at a Time — "Seats.aero: How This Fun, Geeky, Useful, Award Search Tool Works"
URL: `https://onemileatatime.com/guides/seats-aero/`
Quote: "Seats.aero refreshes all award availability for its supported programs several times per day, and then you can essentially search the database to see what's available." Tool is cache-based, not real-time. Phantom availability is acknowledged. ~24 frequent flyer programs covered.

### One Mile at a Time — "Airlines Try To Shut Down Websites Scraping Award Seats"
URL: `https://onemileatatime.com/news/airlines-shut-down-websites-scraping-awards/`
Notes seats.aero "has controls in place to rate limit all requests sent to Air Canada's systems." Implies seats.aero deliberately throttles per partner.

### One Mile at a Time — "The Secret Air France-KLM Flying Blue Award Calendar"
URL: `https://onemileatatime.com/insights/flying-blue-award-calendar/`
Trick: on airfrance.us / klm.com Book with Miles tab, **leave the departure date blank** and the response is a monthly calendar view of award pricing. Not URL hackery — just empty-date form submission triggers the calendar response from the same endpoint.

### Frequent Miler — "A new breed of award discovery tools"
URL: `https://frequentmiler.com/a-new-breed-of-award-discovery-tools/`
"These tools use data cached from earlier award searches and so the results are often out of date." Confirms cache-first architecture across point.me, seats.aero, Roame, PointsYeah.

### Live and Let's Fly — "Air Canada Lawsuit Seeks To Stop Award Seat Scraping"
URL: `https://liveandletsfly.com/air-canada-lawsuit-seats-aero/`
Mentions that seats.aero used to offer Avianca LifeMiles search and "that site does require you to login before searching (implying there was some technology that either circumvented or exploited individual accounts)." LifeMiles support was dropped — suggests they were using account-based scraping that became unsustainable.

### TechDirt — "Air Canada Would Rather Sue A Website…"
URL: `https://www.techdirt.com/2023/10/24/air-canada-would-rather-sue-a-website-that-helps-people-book-more-flights-than-hire-competent-web-engineers/`
Mike Masnick highlights AC's complaint distinguishing "screen scraping" from "API scraping" and calling the latter "more intrusive." Useful lore for legal-risk framing.

### Thrifty Traveler — "10 of the Best Flight Award Search Tools"
URL: `https://thriftytraveler.com/guides/points/award-search-tools/`
Practical taxonomy of which tools cover which programs. Useful to back-fill PointSnap's coverage targets.

### Nurse Michael Travels — "The Truth About Award Search Tools"
URL: `https://nursemichaeltravels.com/award-search-tools-problems/`
Confirms phantom-availability is universal across cached tools; verifying on the airline site is mandatory before transfer. PointSnap will face the same problem if cached.

### Dansdeals — "United's 2024 Hidden Saver Award Chart Changes"
URL: `https://www.dansdeals.com/points-travel/milespoints/uniteds-2024-hidden-saver-award-chart-changes/`
Documents United's saver-award chart changes mid-2024. Useful to remember united.com is the only widely-used award-search engine that displays partner *A availability — and thus a high-value scrape target.

### Thrifty Traveler — "United Flexible Date Award Search: Old Calendar View"
URL: `https://thriftytraveler.com/guides/points/united-award-calendar/`
"As of June 2024, a trick to use United's older calendar search is no longer working, and users now need to use United's newer interface and search day-by-day to find nonstop availability." United deprecated the legacy calendar API in mid-2024 — PointSnap must use the newer `api/flight/FetchFlights` endpoint instead.

### Australian Frequent Flyer — "Seats.aero a useful tool for finding Qantas & Velocity reward availability"
URL: `https://www.australianfrequentflyer.com.au/community/threads/seats-aero-a-useful-tool-for-finding-qantas-velocity-reward-availability.110423/page-2`
QF community: "Gyoza and others are using the API backend of what drives the QF website." QF's website backend is reverse-engineerable.

### Frequent Miler — "AwardTool: a powerful award search tool with up to 32 simultaneous searches"
URL: `https://frequentmiler.com/awardtool/`
Demonstrates that 32-thread parallelism is achievable against several program backends; useful PoC for scaling design.

---

## GitHub OSS scrapers found

This is the most actionable section: each repo below contains literal endpoint URLs we can lift for PointSnap's rebuild.

### lg/awardwiz (archived Sep 11, 2024)
URL: `https://github.com/lg/awardwiz`
Stack: custom "Arkalis" engine ("the detection-sensitive scraping engine written for this project"), Node.js/TypeScript. Supports aa, aeroplan, alaska, delta (temp broken), jetblue, southwest, united (temp broken), and skiplagged. **Archived but endpoints still illuminating.**

Endpoint specifics extracted from individual scrapers:

- **American Airlines** (`scrapers/aa.ts`): `POST https://www.aa.com/booking/api/search/itinerary` with JSON body `{ metadata, passengers, queryParams, requestHeader: { clientId: "AAcom" }, slices: [{ ...departureAirport, ...arrivalAirport, ...date, cabin, searchType: "Award" }], tripOptions, loyaltyInfo }`, content-type JSON. Note `"clientId": "AAcom"` and `"searchType": "Award"` are required.
- **United** (`scrapers/united.ts`): Page navigation to `https://www.united.com/en/us/fsr/choose-flights?f=&t=&d=&tt=1&at=1&sc=7&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&tqp=A`; actual data via `https://www.united.com/api/flight/FetchFlights`. Note `tqp=A` flag and `newHP=True`.
- **Aeroplan / Air Canada** (`scrapers/aeroplan.ts`): Page navigation to `https://www.aircanada.com/aeroplan/redeem/availability/outbound?org0=…&dest0=…&departureDate0=…&lang=en-CA&tripType=O&ADT=1&YTH=0&CHD=0&INF=0&INS=0&marketCode=TNB`; data delivered via XHR to `*/loyalty/dapidynamic/*/v2/search/air-bounds`. `marketCode=TNB` is the key undocumented param ("TNB" = Trans North-Bound? Trans-NB?). Aeroplan loyalty API path includes a tenant-id segment between `dapidynamic/` and `v2/`.
- **Delta** (`scrapers/delta.ts`): Initial `GET https://www.delta.com/flight-search/book-a-flight`; prefill `GET https://www.delta.com/prefill/retrieveSearch?searchType=RecentSearchesJSON*`; results `GET https://www.delta.com/shop/ow/search`. Anti-bot interstitial at `https://www.delta.com/shop/ow/flexdatesearch` — requires a continue-button click. Comment in source: "This scraper currently gets detected after the 3rd attempt unless a proxy is used."
- **Alaska Airlines** (`scrapers/alaska.ts`): `GET https://www.alaskaair.com/searchbff/V3/search?origins=&destinations=&dates=&numADTs=1&fareView=as_awards&sessionID=&solutionSetIDs=&solutionIDs=`. The `fareView=as_awards` toggles award mode. Blocks tracking domains `cdn.appdynamics.com`, `*.siteintercept.qualtrics.com`, `dc.services.visualstudio.com`, `js.adsrvr.org`, `bing.com`, `tiktok.com`.
- **JetBlue** (`scrapers/jetblue.ts`): Page nav to `https://www.jetblue.com/booking/flights?from=&to=&depart=&isMultiCity=false&noOfRoute=1&lang=en&adults=1&children=0&infants=0&sharedMarket=false&roundTripFaresFlag=false&usePoints=true`. After redirect, data delivered from `https://jbrest.jetblue.com/lfs-rwb/outboundLFS`. `usePoints=true` is the award toggle. 40-second timeout; throws on `"Invalid Request"` response.
- **Southwest** (`scrapers/southwest.ts`): `https://www.southwest.com/api/air-booking/v1/air-booking/page/air/booking/shopping` via navigation to `https://www.southwest.com/air/booking/select.html?adultPassengersCount=1&adultsCount=1&departureDate=…&destinationAirportCode=…&originationAirportCode=…&fareType=POINTS&tripType=oneway`. Notable: param order is **randomized** at request time (`paramsText.split("&").sort(() => Math.random() - 0.5).join("&")`). Code comment: "southwest seems to care about timezone of the ip." Error code `403050700` = "we know youre a bot" — falls back to manually clicking the search button.
- **Skiplagged** (`scrapers/skiplagged.ts`): `GET https://skiplagged.com/api/search.php?from=&to=&depart=&return=&format=v3&counts[adults]=1&counts[children]=0`. Useful for cash-equivalent comparisons in our valuation layer.

### flightplan-tool/flightplan
URL: `https://github.com/flightplan-tool/flightplan`
Stack: Puppeteer / Headless Chrome, Node.js. Engines: AC, AS, BA, CX, DL, KE (Korean Air SKYPASS), NH (ANA), SQ. Loyalty-program-name aware. Architecture: each engine has `index.js`, `parser.js`, `searcher.js`. Important quirks per engine:
- **AC (Air Canada)**: full Puppeteer, requires Aeroplan account credentials (config/accounts.txt).
- **NH (ANA)**: requires `accountNumber` + password; submits via `#amcMemberLogin`; checks for `verify your membership number` error string.
- **SQ (Singapore)**: requires `#kfLoginPopup #membership-1` (username) + `#membership-2` (password); has invisible captcha bypass via `captchaSubmit()`; cabin mapping F/J/S/Y.
- **CX (Cathay Pacific)**: form-based via `#account-login`; monitors XHR responses on `milesInfo` endpoints for pricing; iterates over award type tabs (standard, choice, tailored).
- **BA (British Airways)**: form via `#execLoginrForm`, `#membershipNumber`, `#input_password`, submit `#ecuserlogbutton`; main search form id `plan_redeem_trip`; pageid `PLANREDEMPTIONJOURNEY`. Handles stopover form `#noStopovers` and captcha `#captcha_form`.
- **AS (Alaska)**: Puppeteer (separate from awardwiz approach).

### timrogers/ba_rewards
URL: `https://github.com/timrogers/ba_rewards`
Reverse-engineered the **iOS Avios Flight Finder app's private API** (Ruby gem). Provides `BARewards.availability("LON", "SFO", :business, 2)`. Endpoint/auth not exposed in README — must clone and read source. Important lead: BA's mobile-app API is far less protected than ba.com.

### ak2912/Lifemiles
URL: `https://github.com/ak2912/Lifemiles/blob/master/lifemiles.py`
Endpoints (Avianca LifeMiles):
- Login: `https://www.lifemiles.com/lib/ajax/ENG/getSession.aspx`
- Route validation: `https://www.lifemiles.com/eng/use/red/dynredparsocae.aspx`
- Search: `https://www.lifemiles.com/eng/use/red/dynredcal.aspx`
- Results: `https://www.lifemiles.com/eng/use/red/dynredflts.aspx`
Auth via query params (`user=…&pass=…`). Search POST body: `cmbOrigen`, `cmbDestino`, `fechaSalida` (MM/DD/YYYY), `cabin` (Y for econ), `CmbPaxNum` (1), `hidRedemptionType` (1). Content-type `application/x-www-form-urlencoded`. Referer must be `https://www.lifemiles.com/eng/use/red/dynredpar.aspx`. Miles extracted from HTML via regex `r'1 x ((?:\d{1,3},)?\d{3})'`. **Account-based** — needs logged-in session.

### gaukas/63eafba2efbc45283a370b7328c9e545 (gist)
URL: `https://gist.github.com/gaukas/63eafba2efbc45283a370b7328c9e545`
Endpoints (United, c. 2022):
- Anonymous token: `GET https://www.united.com/api/token/anonymous` (returns `data.token.hash`)
- Search: `POST https://www.united.com/api/flight/FetchFlights` with header `x-authorization-api: bearer {token}` + `content-type: application/json`
- Upgrade list: `GET https://www.united.com/api/flight/upgradeListExtended?flightNumber=&flightDate=&fromAirportCode=`
Demonstrates the unauthenticated-bearer-token pattern is real for UA. May still work — worth re-validating.

### Sekinal/aa_contest
URL: `https://github.com/Sekinal/aa_contest`
2025-era American Airlines scraper, **production-ready with advanced bot evasion**:
- Uses **Camoufox** (real Firefox + anti-detection patches) "to handle Akamai bot challenges automatically."
- Two-stage: real-browser session to extract cookies, then HTTP requests using harvested cookies for 20 minutes before refresh.
- Files stored: `aa_cookies.json`, `aa_cookies_headers.json`, `aa_cookies_referer.txt`.
- "Automatic Header Ordering" mimics real browser request order — important because Akamai fingerprints header order.
- Force-refresh on 403; 1 rps default; exponential backoff; circuit-breaker pattern for cascading failures.
This is the closest open-source equivalent to what PointSnap likely needs for aa.com.

### xmsley614/nt_tool
URL: `https://github.com/xmsley614/nt_tool`
Python, supports AA (`use_aa.py`), AC (`use_ac.py`), DL (`use_dl.py`). README doesn't expose endpoints — must read `/src` files in repo for actual implementation.

### borski/travel-hacking-toolkit
URL: `https://github.com/borski/travel-hacking-toolkit`
Maintainer (borski) ships Docker images per airline:
- `ghcr.io/borski/sw-fares` — Southwest, Patchright-based
- `ghcr.io/borski/aa-miles-check` — AA balance, Patchright
- `ghcr.io/borski/chase-travel` — Chase UR portal, Patchright
- `ghcr.io/borski/amex-travel` — Amex MR portal, Patchright
- `ghcr.io/borski/ticketsatwork` — corporate perks, Patchright
For seats.aero data, uses official API; for Duffel, Ignav uses APIs. Confirms current best practice in 2025: **Patchright for sites with Akamai/PerimeterX; commercial APIs everywhere else.**

### NikolaiT/stealthy-scraping-tools
URL: `https://github.com/NikolaiT/stealthy-scraping-tools/blob/main/lufthansa-de.py`
Lufthansa scraper at `https://www.lufthansa.com/de/de/homepage`. Stealth strategy is unconventional: uses Chrome DevTools Protocol *only* to read DOM coordinates, then drives mouse/keyboard via pyautogui (not via CDP or JS), running in VNC. Rationale: "Browser based mouse and keyboard emulation is very easy detectable." Worth considering if Lufthansa has aggressive anti-bot.

### IanKhoo/SingaporeAir_Search
URL: `https://github.com/IanKhoo/SingaporeAir_Search`
Uses **official KrisConnect API** (developer.singaporeair.com) with a developer API key — not scraping. PointSnap could potentially do the same for Singapore.

### strawb3rryx7/tkapi
URL: `https://github.com/strawb3rryx7/tkapi`
Uses **official Turkish Airlines developer API** with API key + secret. Methods include `getAvailability`, `calculateAwardMilesWithTax`. Official, not scraping.

### Makoto-winter/Find_ANA_Award_Availability
URL: `https://github.com/Makoto-winter/Find_ANA_Award_Availability`
Selenium-based scraper for ANA's award calendar (which is not displayed visually). Implementation details in `main.py` not surfaced; worth a clone.

### lexande/awardsearch
URL: `https://github.com/lexande/awardsearch`
Programs to search Star Alliance awards by scraping ANA's web interface. Requires ANA account credentials. Three scripts: `award-server.py`, `award-client.py`, `award-dumpload.py`.

### pburka/aeroplanner
URL: `https://github.com/pburka/aeroplanner`
Scrapy-based Aeroplan scraper from 2016. Requires `member` + `pin` (Aeroplan login). Pre-dates the modern AC website; mainly useful as a historical reference.

### tszumowski/aa_flight_search_tool
URL: `https://github.com/tszumowski/aa_flight_search_tool`
Selenium + BeautifulSoup for AA. Notably author explicitly states "the URL used in this script is allowed based on that robots.txt" — implies AA's robots.txt allows the search page. No anti-bot bypass; "not being actively maintained."

### mayanez/flight_scraper
URL: `https://github.com/mayanez/flight_scraper`
Reverse-engineered **ITA Matrix** poll API + FlightStats for on-time. Archived Jun 2024.

### danielsmith-eu/britishairways-awards-tool
URL: `https://github.com/danielsmith-eu/britishairways-awards-tool`
Python BA Avios search via origin/destination + dates + class (M/W/C/F) + adults. Implementation in unseen subfolders.

### fgparamio/api-flight.com — Vueling scraper
URL: `https://github.com/fgparamio/api-flight.com/blob/master/microservice/back/scraper/go/europe/vueling/vueling_scraper.go`
Vueling endpoints: `https://tickets.vueling.com/ScheduleSelect.aspx` (page) + `https://tickets.vueling.com/XmlSearch.aspx` (POST). Required headers include `Origin: http://www.vueling.com`, Content-Type `application/x-www-form-urlencoded`. Body uses ASP.NET form fields: `__EVENTTARGET`, `RadioButtonMarketStructure=RoundTrip`, origin/destination stations, dates, pax counts. Source includes hardcoded ASP.NET session cookies (TODO comment notes they should be dynamic).

### evictorero/smiles (404 at fetch time)
URL: `https://github.com/evictorero/smiles`
Search snippet says it queries the Smiles (GOL) API for cheap mileage redemptions. May have been taken down.

### FeelingsLw/AAScraper
URL: `https://github.com/FeelingsLw/AAScraper`
**AirAsia** (not American Airlines) booking scraper. Useful if PointSnap covers AirAsia in any partner-award context.

### chkp-santoshg/flightscraper (santoshghimire)
URL: `https://github.com/santoshghimire/flightscraper`
Scrapy for Jetstar and AirAsia.

### kalil0321/reverse-api-engineer
URL: `https://github.com/kalil0321/reverse-api-engineer`
Generic "Claude engineer that captures traffic, writes documentation and automatically generates API clients." Possibly useful to point at each airline during PointSnap rebuilds.

### oxylabs/expedia-scraper, AchintyaAshok/Kayak-Scraper, omkarcloud/expedia-scraper
Aggregator scrapers — useful for cash-equivalent comparison and ITA Matrix-style hidden-city aware logic but not directly award.

---

## Synthesis: Top 10 actionable tips for the 23 airlines

Each numbered tip cites the source URL.

1. **AA's award search endpoint is `POST https://www.aa.com/booking/api/search/itinerary` with `clientId: "AAcom"` and `searchType: "Award"` in the JSON body.** Pair with Camoufox + 20-min cookie refresh + automatic header ordering to survive Akamai (per Sekinal/aa_contest's 2025 design). Source: `github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/aa.ts` and `github.com/Sekinal/aa_contest`.

2. **United exposes anonymous bearer tokens at `GET https://www.united.com/api/token/anonymous`; the search endpoint is `POST https://www.united.com/api/flight/FetchFlights` with `x-authorization-api: bearer {token}`.** Re-validate in 2026 since the gist is 2022, but the pattern (token issuance via separate anonymous endpoint, then bearer-token API) is unusual and useful. Source: `gist.github.com/gaukas/63eafba2efbc45283a370b7328c9e545`.

3. **Air Canada Aeroplan's award API is at `*/loyalty/dapidynamic/{tenant}/v2/search/air-bounds`, fed by a page-load at `https://www.aircanada.com/aeroplan/redeem/availability/outbound?…&marketCode=TNB`.** The `marketCode=TNB` parameter is required and undocumented. Throttle aggressively — AC sued seats.aero for ~265,552 reqs/day and is litigious. Source: `github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/aeroplan.ts` and `seats.aero/lawsuit` / FlyerTalk AC thread.

4. **Alaska Airlines award search is `GET https://www.alaskaair.com/searchbff/V3/search?…&fareView=as_awards`.** The `fareView` toggle is the award/cash switch. Block tracking domains for cleaner stream (e.g. `*.siteintercept.qualtrics.com`, `cdn.appdynamics.com`). Source: `github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/alaska.ts`.

5. **JetBlue's actual data endpoint is `https://jbrest.jetblue.com/lfs-rwb/outboundLFS`, reached by initial nav to `jetblue.com/booking/flights?…&usePoints=true`.** `jbrest.jetblue.com` is a separate REST hostname that returns clean JSON. Source: `github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/jetblue.ts`.

6. **Delta has an anti-bot interstitial at `https://www.delta.com/shop/ow/flexdatesearch` that requires clicking continue.** Their scrapers "get detected after the 3rd attempt unless a proxy is used." Plan on a residential proxy rotation and the interstitial click step. Source: `github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/delta.ts`.

7. **Southwest randomizes parameter order and IP-geofences by timezone.** Their bot-trigger error code is `403050700`. When triggered, fall back to manual UI click instead of direct API. Source: `github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/southwest.ts`.

8. **Air France/KLM Flying Blue's "secret" award calendar is just the normal Book with Miles endpoint with an empty departure date.** No URL hacking required — leave the field blank and the same endpoint returns a monthly award calendar. Source: `onemileatatime.com/insights/flying-blue-award-calendar/`.

9. **British Airways' iOS Avios Flight Finder app has a private API that is far less protected than ba.com's web flow.** Reverse-engineering the mobile app traffic (Charles/mitmproxy on a rooted device or simulator) is the canonical BA scraping technique. Pattern: many airlines under-protect their mobile-app APIs vs their websites. Source: `github.com/timrogers/ba_rewards`.

10. **For Akamai-protected sites (AA, AC, others) the modern stack is Camoufox (or Patchright) + real-browser cookie harvesting + Akamai's `_abck` cookie reuse for 20 minutes before refresh + automatic header ordering.** Identify Akamai-protected sites by the cookies `_abck`, `ak_bmsc`, `bm_sv`, `bm_mi`. Source: `github.com/Sekinal/aa_contest` + `scrapfly.io/bypass/akamai`.

**Bonus tip 11.** ExpertFlyer's loss of Star Alliance coverage in late 2024 strongly suggests **united.com is the single best oracle for all Star Alliance partner award availability** (United still shows partner inventory even after ExpertFlyer's GDS feed was cut). For PointSnap's *A coverage, prioritize a robust UA scraper. Source: `flyertalk.com/forum/united-airlines-mileageplus/2137627`.

**Bonus tip 12.** For carriers that publish official developer APIs (Singapore Airlines KrisConnect, Turkish Airlines, Air France-KLM via NDC, Hawaiian via NDC through Sabre), **register for the developer program first** before attempting to scrape — official tier is more reliable, less legal risk. Source: `developer.singaporeair.com`, `developer.turkishairlines.com`, `developer.airfranceklm.com`.

---

## Citations

- `https://www.flyertalk.com/forum/travel-tools/1918538-flightplan-how-search-year-award-inventory.html` — Flightplan FT thread
- `https://www.flyertalk.com/forum/travel-tools/2137686-award-availability-search-tools-use-web-data-scraping.html` — FT scraping discussion (403)
- `https://www.flyertalk.com/forum/travel-tools/2151571-seats-aero.html` — seats.aero FT thread (403)
- `https://www.flyertalk.com/forum/air-canada-aeroplan/2138872-ac-files-suit-against-seats-aero.html` — AC v seats.aero lawsuit (403 main URL)
- `https://www.flyertalk.com/forum/united-airlines-mileageplus/2137627-expertflyer-no-longer-offering-award-upgrade-inventory-data-alerts-alternatives.html` — ExpertFlyer Star Alliance loss
- `https://www.flyertalk.com/forum/travel-tools/2150969-data-sources-used-award-search-engines.html` — data-source discussion (403)
- `https://www.flyertalk.com/forum/american-airlines-aadvantage/2154362-best-tool-search-award-availability.html` — AA tool comparisons
- `https://www.flyertalk.com/forum/information-desk/1755269-award-seats-api-data.html` — Award seats API
- `https://www.flyertalk.com/forum/travel-tools/2036311-matrix-ita-but-award-flights.html` — ITA Matrix for awards
- `https://www.flyertalk.com/forum/travel-tools/2064199-flight-search-api-options-fare-class-filter.html` — API options
- `https://www.flyertalk.com/forum/travel-tools/2151694-pointsme-vs-seats-aero-vs-roame-vs-pointsyeah-vs-anything-else-best.html` — tool comparison
- `https://www.flyertalk.com/forum/cathay-pacific-cathay/2141654-request-escalating-api-issue-cathay-pacific-s-department.html` — CX API issue
- `https://news.ycombinator.com/item?id=41100886` — HN AwardLoop launch thread
- `https://news.ycombinator.com/item?id=12736433` — HN flight schedules/fares discussion
- `https://onemileatatime.com/guides/seats-aero/` — OMAAT seats.aero deep-dive
- `https://onemileatatime.com/news/airlines-shut-down-websites-scraping-awards/` — OMAAT scraping lawsuits
- `https://onemileatatime.com/insights/flying-blue-award-calendar/` — Flying Blue calendar trick
- `https://onemileatatime.com/news/expertflyer-loses-star-alliance-award-availability/` — ExpertFlyer Star Alliance loss
- `https://onemileatatime.com/insights/virgin-australia-award-tickets/` — VA award trick
- `https://frequentmiler.com/a-new-breed-of-award-discovery-tools/` — Frequent Miler tools overview
- `https://frequentmiler.com/which-award-search-tool-is-best/` — Frequent Miler comparison
- `https://frequentmiler.com/awardtool/` — AwardTool review
- `https://frequentmiler.com/seats-aero/` — Frequent Miler seats.aero
- `https://thriftytraveler.com/guides/points/award-search-tools/` — Thrifty Traveler award tools
- `https://thriftytraveler.com/guides/points/united-award-calendar/` — UA calendar trick
- `https://liveandletsfly.com/air-canada-lawsuit-seats-aero/` — LALF AC lawsuit
- `https://www.techdirt.com/2023/10/24/air-canada-would-rather-sue-a-website-that-helps-people-book-more-flights-than-hire-competent-web-engineers/` — TechDirt
- `https://www.dansdeals.com/points-travel/milespoints/uniteds-2024-hidden-saver-award-chart-changes/` — Dansdeals UA changes
- `https://www.australianfrequentflyer.com.au/community/threads/seats-aero-a-useful-tool-for-finding-qantas-velocity-reward-availability.110423/page-2` — AFF QF/VA
- `https://nursemichaeltravels.com/award-search-tools-problems/` — NMT tool review
- `https://www.mightytravels.com/2024/05/7-award-travel-search-tools-to-unlock-hidden-flight-availability-in-2024/` — Mighty Travels 2024
- `https://www.mightytravels.com/2024/11/7-award-flight-search-tools-that-actually-work-in-2024-a-data-driven-analysis/` — Mighty Travels Nov 2024
- `https://www.thewaystowealth.com/awardhacker-review/` — AwardHacker decline
- `https://github.com/lg/awardwiz` — AwardWiz repo
- `https://github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/aa.ts` — AA scraper
- `https://github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/united.ts` — UA scraper
- `https://github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/aeroplan.ts` — Aeroplan scraper
- `https://github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/delta.ts` — DL scraper
- `https://github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/alaska.ts` — AS scraper
- `https://github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/jetblue.ts` — B6 scraper
- `https://github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/southwest.ts` — WN scraper
- `https://github.com/lg/awardwiz/blob/master/awardwiz-scrapers/scrapers/skiplagged.ts` — Skiplagged scraper
- `https://github.com/flightplan-tool/flightplan` — Flightplan repo
- `https://github.com/flightplan-tool/flightplan/blob/master/README.md` — Flightplan README
- `https://github.com/flightplan-tool/flightplan/blob/master/docs/api.md` — Flightplan API docs
- `https://github.com/flightplan-tool/flightplan/blob/master/src/engines/nh/searcher.js` — ANA searcher
- `https://github.com/flightplan-tool/flightplan/blob/master/src/engines/sq/searcher.js` — SQ searcher
- `https://github.com/flightplan-tool/flightplan/blob/master/src/engines/cx/searcher.js` — CX searcher
- `https://github.com/flightplan-tool/flightplan/blob/master/src/engines/ba/searcher.js` — BA searcher
- `https://github.com/xmsley614/nt_tool` — nt_tool repo
- `https://github.com/Sekinal/aa_contest` — production AA scraper
- `https://github.com/borski/travel-hacking-toolkit` — Patchright-based MCP toolkit
- `https://github.com/NikolaiT/stealthy-scraping-tools` — stealthy scraping repo
- `https://github.com/NikolaiT/stealthy-scraping-tools/blob/main/lufthansa-de.py` — LH script
- `https://github.com/ak2912/Lifemiles/blob/master/lifemiles.py` — LifeMiles scraper
- `https://gist.github.com/gaukas/63eafba2efbc45283a370b7328c9e545` — UA token + FetchFlights gist
- `https://github.com/pburka/aeroplanner` — Aeroplanner Scrapy repo
- `https://github.com/rafaelborja/deltaAwardSearcher` — DL Ruby scraper
- `https://github.com/superflyer/ual` — UA inventory CLI
- `https://github.com/tszumowski/aa_flight_search_tool` — AA Selenium scraper
- `https://github.com/danielsmith-eu/britishairways-awards-tool` — BA awards Python
- `https://github.com/lexande/awardsearch` — *A via ANA scraper
- `https://github.com/Makoto-winter/Find_ANA_Award_Availability` — NH calendar scraper
- `https://github.com/IanKhoo/SingaporeAir_Search` — SQ official KrisConnect
- `https://github.com/strawb3rryx7/tkapi` — TK official API wrapper
- `https://github.com/mustafakucuk/thy-api` — TK PHP API class
- `https://github.com/timrogers/ba_rewards` — BA iOS API reverse
- `https://github.com/mayanez/flight_scraper` — ITA Matrix scraper
- `https://github.com/fgparamio/api-flight.com/blob/master/microservice/back/scraper/go/europe/vueling/vueling_scraper.go` — Vueling Go scraper
- `https://github.com/FeelingsLw/AAScraper` — AirAsia scraper
- `https://github.com/santoshghimire/flightscraper` — Jetstar/AirAsia
- `https://github.com/kalil0321/reverse-api-engineer` — generic API reverse tool
- `https://github.com/evictorero/smiles` — Smiles/GOL scraper (404 at fetch)
- `https://github.com/0xBabacan/TokensAndSmiles` — TK Miles token repo
- `https://github.com/duffelhq/hackathon-starter-kit` — Duffel SDK
- `https://github.com/pim97/anti-detect-browser-tools-tech-comparison` — anti-detect tools comparison
- `https://github.com/xiaoweigege/akamai2.0-sensor_data` — Akamai sensor_data bypass
- `https://github.com/pfei-sa/seats-aero-viz` — seats.aero visualizer
- `https://seats.aero/lawsuit` — seats.aero's lawsuit page (403)
- `https://seats.aero/chatgpt` — seats.aero ChatGPT integration
- `https://seats.aero/guides/gettingstarted` — seats.aero docs
- `https://developer.singaporeair.com/` — SQ official developer portal
- `https://developer.turkishairlines.com/documentation` — TK official developer portal
- `https://developer.airfranceklm.com/` — AF/KL developer portal
- `https://developer.alaskaair.com/apiresources/explorer` — AS official portal
- `https://developers.cathaypacific.com/` — CX NDC developer portal
- `https://ndc.aircanada.com/en/api/gettingstarted/apisetup` — AC NDC portal
- `https://apify.com/igolaizola/flight-award-scraper` — Apify multi-airline award scraper
- `https://awardwallet.com/api/loyalty` — AwardWallet Web Parsing API
- `https://awardwallet.com/api/account` — AwardWallet Account Access API
- `https://scrapfly.io/bypass/akamai` — Akamai bypass overview
- `https://scrapfly.io/blog/posts/how-to-scrape-hidden-apis` — Scrapfly hidden APIs guide
- `https://scrapfly.io/blog/posts/how-to-bypass-datadome-anti-scraping` — DataDome bypass
- `https://www.zenrows.com/blog/patchright` — Patchright guide
- `https://www.zenrows.com/blog/web-scraping-with-camoufox` — Camoufox guide
- `https://www.scrapingbee.com/blog/how-to-scrape-with-camoufox-to-bypass-antibot-technology/` — Camoufox bypass
- `https://www.scraperapi.com/blog/top-bot-blockers/` — bot-blocker landscape
- `https://substack.thewebscraping.club/p/bypassing-akamai-for-free` — Akamai for free
- `https://medium.com/@glizzykingdreko/akamai-v3-sensor-data-deep-dive-into-encryption-decryption-and-bypass-tools-da0adad2a784` — Akamai v3 sensor data deep dive
- `https://gist.github.com/0xdevalias/b34feb567bd50b37161293694066dd53` — anti-bot bypass notes gist
- `https://asadfix.github.io/scraping-guide/` — 2026 scraping/anti-bot guide
- `https://www.proxies.sx/blog/datadome-akamai-bypass-mobile-proxies` — DataDome + Akamai mobile proxies
- `https://www.flyingblue.com/en/spend/flights/rewards` — Flying Blue official
- `https://www.lifemiles.com/fly/find` — LifeMiles official
- `https://www.flyertalk.com/forum/travel-tools/2042417-aerolopa-making-sense-airline-seat-maps.html` — AeroLOPA seat maps
- `https://flightrewardfinder.qantas.com/` — Qantas official reward finder
- `https://www.australianfrequentflyer.com.au/qantas-flight-reward-finder/` — AFF QF reward finder analysis
- `https://help.qantas.com/support/s/article/Booking-Reward-flights-online` — QF help
- `https://www.velocityfrequentflyer.com/api` — Velocity API portal
- `https://www.travelpayouts.com/blog/delta-flights-api/` — Delta flights API review
- `https://airlabs.co/united-airlines-developer-api` — AirLabs UA wrapper
- `https://airlabs.co/jetblue-airways-developer-api` — AirLabs JetBlue
- `https://airlabs.co/american-airlines-developer-api` — AirLabs AA
- `https://airlabs.co/virgin-australia-developer-api` — AirLabs VA
- `https://duffel.com/flights/airlines/american-airlines` — Duffel AA
- `https://duffel.com/flights/airlines/jetblue` — Duffel B6
- `https://www.flyertalk.com/forum/sas-eurobonus/2185149-sas-partner-airline-award-search-tool.html` — SAS partner award tool
- `https://www.flyertalk.com/forum/all-nippon-airways-ana-mileage-club/2055053-ana-award-availability-35.html` — ANA award availability thread
- `https://www.flyertalk.com/forum/all-nippon-airways-ana-mileage-club/2117629-what-west-coast-time-pacific-time-does-ana-release-award-seats.html` — ANA release time thread

Total distinct sources cited: ~90 URLs. Target was ≥20; actionable tips identified: 12 (target ≥10).

---

**End of agent-6 community intel report.**
