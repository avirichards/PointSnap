# PointSnap — consolidated user requirements

Source: all user messages supplied in this task through September 5, 2026, including screenshots, browser comments, preference replies, and the request to reconcile the whole chat. This is the continuing scope; a newer UX request never replaces the live-search mission. Recorded does not mean implemented; checked implementation items still have the verification limits described below.

## Priority 1 — live award coverage

- [ ] Coverage-first sequence approved: establish the native airline connections through PointSnap with real flight/fare accuracy and frontend checks before substantial production reliability, hosting/load optimization or seven-day qualification. Keep those release requirements for a later pass; do not hold all other airlines behind American's hosting. American's initial integration gate is verified; continue the approved connection order while retaining earlier unresolved programs.
- [ ] Finish the entire app and keep investigating every airline until all practical access paths are exhausted. Treat a failed method as evidence about that method, not proof that an airline is impossible.
- [ ] Search every available flight, connection, cabin and fare option for the chosen route, day and party. JetBlue was specifically called out for missing flights. Current JetBlue adapter now returns 16 JFK–LAX itineraries / 119 fares, including connections, with exact cash matches; maintain this completeness standard for every source.
- [x] Users can search working direct sources without connecting their personal airline accounts.
- [ ] Approved public-site direction: customers must not need airline logins or a helper installation. For every airline, prioritize complete direct anonymous access, then app-operated anonymous browser access. Operator-held accounts are a fallback for demonstrated member-access needs, not the default; a denied request alone does not establish that a login will help.
- [x] Keep calendar minima separate from individual-flight availability; partner coverage does not imply the native program is connected.
- [ ] Connect remaining airlines without an award-data subscription. Prefer existing infrastructure and free allowances. Paid browser hosting/compute is an optional measured fallback within the approved total $100/month infrastructure ceiling; this does not authorize a paid award-data feed. App-owned anonymous sessions are acceptable; access not reproducible in PointSnap is not marked enabled.
- [x] Research the authorized Seats.aero Pro session and its publicly delivered code. Do not assume private backend code is available or use personal Pro access as a commercial feed.
- [x] Provide an actual live work feed per airline at /build-progress, including evidence and next attempts. Keep it accurate as investigation continues.
- [x] Calculate cents per point only from a matching cash itinerary/cabin/fare and known same-currency award fees. Alaska and JetBlue supported; expand when providers supply comparable quotes.


### Approved connection order (American-first planning update)

Work through this list in order before the remaining programs. American-first supersedes the earlier Aeroplan-first order. Try anonymous access first for each program; the airline order does not prescribe login-based access. The main mission and all earlier product requirements remain active. The release list remains open to a later explicit scope decision.

1. American AAdvantage
2. Air Canada Aeroplan
3. United MileagePlus
4. British Airways Avios
5. Qatar Privilege Club
6. Virgin Atlantic Flying Club
7. Singapore KrisFlyer
8. Turkish Miles&Smiles
9. Etihad Guest
10. ANA Mileage Club
11. Alaska Atmos Rewards
12. Delta SkyMiles
13. JetBlue TrueBlue
14. Qantas Frequent Flyer
15. Avianca LifeMiles
16. Emirates Skywards
17. Aeromexico Rewards

Current focus: **ANA, with anonymous methods first**. Etihad now has verified native local API and frontend integration; its remaining scope limits stay open. The latest Virgin, Singapore and Turkish entry experiments are recorded; none established a new native flight feed. American has a verified initial local connection; its remaining inventory gaps and deferred production qualification stay logged. A program is not complete merely because a partner sells its flights or a normal browser shows prices. The full [approved completion plan](completion-plan.md) carries the product, capacity, recovery and qualification decisions.

## Priority 2 — intuitive depth and comparison

- [x] Show the same physical itinerary once, with all programs and their points/fees/fare choices together. Match all segments and exact times; keep uncertain matches separate.
- [ ] Implement advanced sorting and filters inspired by the actual Seats.aero interface: programs, airlines, alliances, transfer partners, points, taxes, seats, cabin, weekday, stops, duration, departure/arrival windows, aircraft, fare classes and connection airports.
- [ ] Go further where reliable source fields permit: exact cash value, mixed-cabin controls, freshness, refundable awards, party costs, wallet affordability and useful comparison presets.
- [x] Click a column header to sort; repeated clicks reverse direction. Expose keyboard-accessible buttons and aria-sort.
- [x] True flexible-date ±N-day search, not just links to rerun one date: stream all requested dates, show day prices and day/program failures, preserve partial results and cancel queued work.
- [ ] Optional connection-exit / hidden-city comparison: label full-ticket destination and unused segments, genuine same-program/cabin price comparison, and baggage/onward-ticket/rerouting/entry/program-rule risks. Never quietly mix these into ordinary travel or invent prices.
- [ ] Originate and implement useful improvements, rather than asking the user to design the product or delivering ideas only.
- [x] Save search criteria locally and provide adjacent-day navigation. Enhance into the true range experience above.

## Visual and globe direction

- [x] Independent UI overhaul for airline/points geeks; reference conveys a dark, atmospheric, spatial style, not a mandatory copied layout. Practical usability takes precedence over decoration.
- [x] Slow autonomous globe rotation with modern whitish glowing route trails.
- [x] Remove all controls below the globe; rotation pauses only while grabbed, not on hover. Route trails continue during dragging.
- [x] Add release inertia, then resume autonomous spin.
- [x] Prevent drag text selection and unwanted pointer focus rectangle; preserve keyboard access and reduced-motion support.

## Working agreement

- [x] Keep every user instruction recorded, including browser annotation fixes; reconcile this log as features are verified.
- [x] Work autonomously without more questions; user is stepping away and authorized the necessary project work.
- [x] Choose an efficient working method. Earlier agents performed regional access research; current work is direct. Follow current delegation instructions.
- [x] User selected Max; no need to claim an assistant-driven model change.
- [ ] Do not call the app fully complete or all airlines connected while coverage or production readiness remains unresolved. Finish concrete work and report external limits accurately.

## Automatic local currency (latest screenshot feedback)

- [x] Detect visitor country from trusted hosting geolocation; local/browser-region fallback when no IP country is available. Convert award fees to that country's currency automatically, with a remembered manual override.
- [x] Use actual fetched exchange rates, show estimated converted amounts and rate date, preserve original ticketing currency/amount in booking details, and apply the same conversion to fee filters/sorting. Never label MXN as USD or invent a rate when unavailable.

## Frontend usability and QA (latest steering)

- [x] Keep cabin, stops, points/fees, airlines, booking programs and times in the main filter bar; put specialist controls behind All filters.
- [ ] Continue inspecting the actual rendered frontend after every UI change, including desktop/mobile layout, interaction, empty/loading/error states. This is a continuing acceptance condition, not a once-completed task. The user explicitly requests real browser QA; do not substitute source-code reasoning for this check.

### Verified September5 06:45UTC

Desktop browser: bidirectional Departs column changed first departure00:35→23:59; ≤20,000 points plus ≤USD100 fees left six matching itineraries and correctly excluded MXN1,873 (~USD110.67) fares. Program/fare dialogs retained five Aeromexico economy choices and original MXN fees. Three-day LAX–MEX search returned93 itineraries, with per-day incomplete-coverage states rather than claiming all programs checked. Mobile viewport used cards, no visible table or horizontal page overflow; override restored. No browser-console errors in the checked UI. Full121-test suite, typecheck, focused lint and optimized build passed. Airline investigation continues.

### September5 — polished product review and regression

- [ ] Review every designed screen through the lens of polished Google/Apple product interaction; use the Apple HIG skill from the user's quote-tool repository where it helps, adapt to the Web, and implement the improvements.
- [x] Replace the wide result keyword box with useful quick filters; move specialist flight-number/aircraft/fare search into Flight details.
- [x] Replace the sprawling advanced filter form with focused category panels, visible active selections, immediate feedback and straightforward reset. Actual desktop panel review caught and corrected inherited CSS translation that placed the sheet off-screen.
- [x] Fix the user-reported business-filter/date-price disagreement. Date tiles now use the exact filtered offers; cabin-specific sorting cannot stay on an excluded cabin. Two regression tests cover economy→business, multiple cabins, empty matches, date isolation and party totals.
- [ ] Complete actual browser interaction checks for filter combinations, date selection, sorting, mobile panels, keyboard focus/dismissal and the other product screens.

### September 5 — time, places, calendars, density and hidden-city example

- [x] Flight times default to AM/PM without changing the airport-local time. A remembered 12/24-hour preference is implemented in Display preferences; time-filter controls follow it.
- [ ] Verify changing the 12/24-hour preference, persistence, filter controls and all flight-detail views in the browser. Initial AM/PM rendering was checked; the entire preference flow has not yet been checked.
- [ ] Enter a city such as New York and search every explicitly listed airport in that city group. Show the member airports before selection; perform real airport-pair searches, retain all results and account for partial pair failures. Do not pass a city token to an airline as though it were a physical airport.
- [ ] Improve the departure and return calendars. Place date flexibility under each calendar instead of consuming another search-form column, with independent departure/return settings and valid date bounds.
- [x] Add a compact results view with a remembered preference. Desktop browser measurement: first result row reduced from about 108px to 81px; all 25 results on the current page and the full fare-dialog access remained present.
- [ ] Complete compact-view persistence, mobile, keyboard and booking-dialog checks. Keep important value and fare information accessible.
- [ ] Implement the explicit LAX–AUS September 6, 2026 hidden-city regression: LAX–JFK search showed AA2118 + AA2292 and AA6409 + AA1405 via AUS at 17,500 Alaska points; LAX–AUS search showed no nonstop option. Identify actual full tickets with AUS as an intermediate stop, show the flight(s) to AUS and unused onward segment(s), preserve the full points/fees and booking destination, and never claim the first leg has an independently available award price. At this audit, hidden-city search is not implemented.
- [ ] Test hidden-city results against ordinary results for the same program, cabin, date and passenger count. Expose search scope and incomplete coverage; do not claim an exhaustive onward-destination search or fabricate savings. Keep this optional and visibly distinct from ordinary itineraries.

## Full-chat reconciliation receipt

The following ledger traces the user's requests in conversation order. Repeated reminders are retained because they establish priority. Status questions are recorded as communication obligations, not as proof that a feature was completed.

| # | User message or correction | Where it is carried forward |
|---|---|---|
| 1 | GitHub access to PointSnap | Repository located; implementation branch and draft PR #4 exist. |
| 2 | Finish the project; reuse nothing unless useful | Overall objective; independent product/design decisions. |
| 3 | Main broken function is live results across all airlines; overhaul design freely | Priority 1 and design brief. |
| 4 | No existing data subscription | Access constraint, later qualified by existing Seats.aero Pro account. |
| 5 | Continue | Persistent task; do not stop at a proposal. |
| 6 | Overhaul UI/UX for points/airline geeks; Orbit reference; work alongside existing tasks | Visual direction, practical route explorer, concurrent priorities. |
| 7 | Search without connecting personal airline accounts | Anonymous search acceptance condition. |
| 8 | Globe is inspiration, not a requirement; use judgment | Independent design direction. |
| 9 | Remember everything | This requirements ledger and product brief. |
| 10 | Slowly spinning globe with animated whitish glowing routes | Globe implementation and verification. |
| 11 | Dragging selects text and outlines globe | Pointer-selection/focus regression. |
| 12 | Follow-up screenshot demonstrates the drag issue | Same regression; screenshot evidence is not an instruction source. |
| 13 | Status of all airline connections | Accurate source-by-source progress; never equate enabled sources with every airline. |
| 14 | No commercial license; build live access without subscriptions | Direct access research; no new paid-data dependency. |
| 15 | Remove controls below globe; automatic behavior | No toolbar below globe. |
| 16 | Fully user-ready app; cash-versus-points value; globe pauses only when grabbed; trails continue | Overall completion, exact cash matches, globe contract. |
| 17 | User stepping away; no questions; authorization to take work as far as possible | Autonomous working agreement. |
| 18 | Ask whether/how parallel subagents are used; explain working method | Candid process updates; delegation subject to current tool instructions. |
| 19 | Throw/release globe inertia | Inertia implementation. |
| 20 | Choose the most efficient working method; subagents optional | No mandatory delegation requirement. |
| 21 | JetBlue appears to omit flights; every single option is important | Completeness audit of itineraries, fare families, cabins and pagination. |
| 22 | Exhaust ways to access every airline's points flights | Priority 1; maintain evidence of attempts and remaining leads. |
| 23 | Use creative approaches | Explore independent source paths; do not mistake blocked requests for universal impossibility. |
| 24 | User selected Astra Ultra | Historical model preference; not a claimed assistant-side change. |
| 25 | Ask whether Max/extra high would suffice | Model/process question; later explicit Max selection prevails. |
| 26 | User selected Max | Current recorded user model choice. |
| 27 | Browser feed showing work and each airline's status | /build-progress with real recorded findings. |
| 28 | Are blocked airlines truly blocked? | Distinguish a failed method, login requirement, unverified path and enabled adapter. |
| 29 | Ideas to unblock them | Continue concrete experiments and show remaining paths. |
| 30 | How does Seats.aero do it? | Evidence-backed public architecture research; private backend unknown. |
| 31 | Existing Seats.aero Pro login; inspect site/code | Authorized session/public-frontend research; no claim to private code or commercial redistribution rights. |
| 32 | Are airline connections still being worked on? | Priority and honest work-status obligation. |
| 33 | Take it to completion; exhaust every option | Persistent main objective, not replaced by UI requests. |
| 34 | All Seats.aero sorting/filtering and more, while preserving main mission | Comprehensive fare-aware comparison backlog and live-access priority. |
| 35 | One physical flight, multiple booking programs/costs; consider every useful UX improvement | Confident itinerary grouping and progressive program/fare comparison. |
| 36 | Originate ideas and implement them | Autonomous product work; not ideas-only responses. |
| 37 | ±N-day search, hidden-city/skiplagged feature, additional ideas | Multi-day implementation; hidden-city remains open at this audit. |
| 38 | Column-header sorting; read and log all messages | Bidirectional accessible sorting and this receipt. |
| 39 | Most important: keep unblocking every airline | Explicit priority 1 reminder. |
| 40 | American browser shows points; explain progress | Browser proof versus reproducible server connector kept separate. |
| 41 | Convert airline fees to visitor-country currency; MXN example | Country/locale defaults, actual FX, original currency and manual override. |
| 42 | Make relevant filters accessible and everything easy to use | Everyday quick filters, specialist progressive disclosure. |
| 43 | Always inspect the actual frontend after coding | Continuing browser acceptance condition. |
| 44 | Replace wide result keyword box with more quick filters | Implemented; keyword search moved to Flight details. |
| 45 | Filters look poor; inspect Apple HIG skill in GitHub | Read the user's quote-tool skill; focused panels and consistent controls. |
| 46 | American progress/status | Accurate native connection status; browser results alone do not count as enabled. |
| 47 | HIG optional if helpful; aim for Google/Apple polish | Adapt useful principles to the web; no required imitation or skill dependency. |
| 48 | Audit every designed screen through that lens | Whole-product audit remains open. |
| 49 | Business filter incorrectly makes flexible-date prices unavailable | Fixed shared filtered-fare semantics; regression tests and actual browser confirmation. |
| 50 | Default AM/PM, with user preference | Implemented; remaining interaction QA explicitly listed. |
| 51 | City-wide airport search; nicer calendars; flexibility below departure/return calendars; polish audit | Explicit pending implementation items above. |
| 52 | Airline connection status | Main mission remains open; report measured progress. |
| 53 | Add compact results view | Implemented; desktop density checked; remaining QA listed. |
| 54 | Is hidden-city working? LAX–JFK via AUS exists but LAX–AUS has no nonstop | Concrete hidden-city regression above; not implemented at this audit. |
| 55 | Scan the whole chat and confirm all messages are logged | This full reconciliation; user-facing copy in outputs/PointSnap-requirements.md. |
| 56 | Compact looks good; are there downsides to making it the only view? | Make compact the default, remove the toolbar toggle, retain Roomy in Display preferences for reading/tap-space needs, and restore the cents-per-point line that compact had hidden. Verify both layouts and persistence. |
| 57 | Approves compact default and Roomy in preferences: “nice, do that” | Explicit authorization; implementation and real browser verification. |
| 58 | Keep all to-dos logged but build airline connections before anything else; log later UI ideas for when possible | Airline work now takes precedence over the UI backlog. Complete only necessary verification of changes already made, then resume data access. |
| 59 | Do not stop until all airlines are successfully connected | Persistent live-connection objective. Do not substitute a polished UI, partner-only coverage, browser-only proof or a blocked request for a completed native connection. |
| 60 | Ask about American and United; American appeared close | Report the precise remaining transport gap. September 7 LAX–AUS native AA browser returned 40 itineraries including nonstop AA4945 at32,000 + USD5.60 and AA6409 at76,500 + USD5.60. Server booking entry still403 and itinerary309. Native United sign-in gate remains; offered United partner awards work through TrueBlue. |
| 61 | Why did work stop? | Do not turn a status question or one failed access method into a task endpoint. Resume airline investigation against current, untested flows; keep the feed honest and continue useful independent work when a source is blocked. |
| 62 | American seemed close; keep working until every airline is connected or every remaining idea has actually been exhausted | Prioritize American’s fresh-session transport gap. Keep distinct experiments and outstanding leads explicit. A failed endpoint alone is not evidence of exhaustion; continue airline work autonomously. |
| 63 | What options remain? | Compare the actual access architectures and provider products, costs, traveler friction, freshness and remaining evidence gaps in docs/airline-access-options.md. |
| 64 | Airline accounts may have to be connected; figure out all available options | Reopens authenticated and browser-assisted approaches for evaluation. No-account access remains preferred, not a prohibition on presenting connections. Review all choices without assuming a purchase, provider inquiry, account creation or successful connection. |

| 65 | Clarify whether American can connect without a login | American's ordinary anonymous browser produces native AAdvantage results. The unsolved boundary is reliable execution by PointSnap, not a demonstrated member-login requirement. |
| 66 | Run that normal browser search in the background when PointSnap is searched | Implement and test a dedicated anonymous browser worker through the actual search engine. Validate route, date, party, freshness, all itineraries and all fares before enabling it. |
| 67 | Challenge the claim that every option was tested; do not give up prematurely | Correct the earlier exhaustion wording. Full browser execution was a missing architecture, so test it end to end; record specific failures and still-unverified options. |
| 68 | Other platforms demonstrate the capability; keep figuring it out | Continue concrete independent access experiments. Other platforms' availability does not establish their private backend method or prove our connector works; measured PointSnap results remain the acceptance criterion. |

| 69 | Earlier goal update supplies an explicit 17-program connection order | Historical Aeroplan-first order, superseded by the later approved American-first plan in group 79. Preserve the remaining relative order and keep other programs afterward. |

| 70 | What is the easiest way to complete PointSnap? | Compared licensed data with self-operated access. No provider purchase or inquiry authorized by this question. |
| 71 | Exclude another provider subscription; evaluate registering airline accounts and searching while signed in; propose other self-operated approaches | Earlier Aeroplan-first and per-traveler proposals were evaluated, then superseded by the approved American-first public-site plan in group 79. An account is not proof of reliable automation or universal pricing. Do not create accounts merely from this exploratory question. |
| 72 | Ask what is needed to use the existing Air Canada account | Prepare a dedicated persistent browser and perform sign-in on Air Canada's own site. Do not request credentials in project files or progress logs. |
| 73 | Authorize Air Canada sign-in by providing account credentials | Use only for the requested airline sign-in. Credential values are intentionally excluded from this requirements record, code, evidence files and progress feed. |
| 74 | Retain verification so another code is not needed three months later | Reuse the same dedicated browser session where Air Canada permits it. Its published policy requires 2FA for every new sign-in; do not promise a 90-day lifetime or reuse a one-time code. Detect expiry and provide a clear reconnect step. |
| 75 | Stop and plan because continual re-login is not acceptable | Reevaluate the architecture and recovery requirements before expanding account integrations. Reusing an active session is not a guarantee against future verification. |
| 76 | Explain why the successful direct anonymous approach cannot simply be duplicated everywhere | Separate public endpoint access, ordinary-browser access, runtime verification, member-only inventory and extraction completeness. Prefer the successful anonymous patterns on every new program, with current evidence. |
| 77 | Originate ideas; explain American scraping and whether Brave Search or another browser would help | American's ordinary anonymous results are evidence of public access, while its independent worker still fails before inventory. Test genuine persistent profile reuse and an operator-side collector; distinguish a web-search API from browser execution. |
| 78 | Produce a comprehensive completion plan | Approved plan saved in tasks/completion-plan.md, including early access proofs, a queued search service, product completion, cost limits and release qualification. |
| 79 | Planning decisions: public site, no customer connections, operator recovery, infrastructure budget, freshness, American first and pilot workload | No customer airline login/helper; anonymous methods first; operator-account fallback with recovery proof; no data subscription; total infrastructure up to $100/month; recent observations plus automatic live refresh; 100 submitted searches/day and five simultaneous visitors; release airline list may be revised explicitly. Mailbox access was discussed but no OAuth consent or mailbox access has occurred. |
| 80 | Ask whether the plan is credible | Distinguish confidence in the testable process from a guarantee of universal access. Prove repeated anonymous American searches, member-session recovery and operating cost before substantial infrastructure work. |
| 81 | Approve the plan and start implementation | Execute the approved plan in Default mode, keeping airline access first and all earlier UI/product requirements active. |
| 82 | Ask whether to set a goal before starting | Goal is optional; proposed wording references the full plan and measurable completion criteria. No goal was active at that setup check; the later explicit goal activation is recorded in group 84. |
| 83 | Confirm free anonymous connections are prioritized in the plan and goal | Explicit order: direct anonymous connection, app-operated anonymous browser, then justified operator-account fallback. Prefer existing/free infrastructure; optional paid hosting remains within $100/month and no award-data subscription. Correct stale Aeroplan-first/traveler-connected recommendations and verify anonymous-first language in the active goal. |
| 84 | Activate the approved completion goal | Goal state verified active through the goal tool. Keep the full approved objective, prioritize American anonymously, and continue toward complete native connections and the remaining product requirements. No token budget was specified. |
| 85 | Confirm lessons from one airline help the next and are saved | Maintain docs/airline-connection-playbook.md with evidence, transferable findings, implemented shared components and next-airline procedure. Link it from tasks/lessons.md and the completion plan; update it after meaningful discoveries. Separate proven behavior from a hypothesis for another airline. |
| 86 | Explain production reliability and whether it is needed before connecting all airlines | Distinguish a verified native connection from sustained hosted operation, multi-user load, extended recovery and release qualification. Recommend a coverage-first pass while preserving flight/fare accuracy and the final reliability requirements. |
| 87 | Approve coverage-first sequencing; save it in the plan and clarify whether the goal needs editing | Completion plan and playbook now explicitly move extended production/hosting qualification after the airline-connection pass. The active goal already points to the approved completion plan and retains the same final objective; no goal recreation or scope reduction is needed. Record this decision in the readable goal copy and current progress feed. |

## Current completion boundary

Ten scoped live individual-flight feeds are now enabled in the configured local app, including anonymous American, Delta, Smiles and Etihad browser services, plus cached Qantas flights and the Virgin daily calendar. Additional partner inventory does not equal a native airline-program connection. Delta now has a reproducible native connection through the actual local PointSnap app. American now works natively through the actual local app without login: 40 domestic itineraries / 78 two-adult fares match the airline website, and normal restart succeeds. Additional ordinary cabin searches now produce 51 international itineraries / 130 fares, with all 40 independent premium itineraries and 52 fares matched; domestic expansion returns 52 / 90 for two adults. Wider exhaustiveness remains unresolved. Southwest remains unconnected. Ethiopian now has a verified anonymous Node adapter and actual PointSnap API/browser evidence for Economy, Business, multiple passengers and connecting flights. Native all-airline coverage, full provider-by-provider completeness, city-wide search, redesigned calendars, hidden-city exploration, remaining advanced reference-data filters, the whole-product audit and hosted production verification remain unfinished. No document checkbox or progress-feed event should describe them as complete without fresh evidence.

### Earlier airline-first verification — historical checkpoints

American: fresh native browser evidence was reconciled against 40 itineraries and 69 fares. A replacement candidate parser now preserves all of them and rejects incomplete or mismatched data; native transport remains disabled. Matching AA's ordinary client-generated correlation cookie and header still produced API error309 and a server-rendered Challenge Validation page. United: the actual PointSnap page showed all four offered EWR–LHR partner itineraries for two adults. UA14 details correctly showed 40,000 TrueBlue points + USD5.60 per person, 80,000 + USD11.20 for the party, local AM/PM times and a fresh two-adult JetBlue handoff. Native MileagePlus still requires sign-in.

Follow-up polish logged during that verification: an airline filter currently falls back to “AM” instead of the Aeromexico name in an Alaska-derived carrier entry. Keep this in the deferred UI/data-label backlog; it does not replace the airline-access priority.

Ethiopian milestone: anonymous Economy and Business integrated and verified in the actual app. All four native one-person Economy options match; two-person search preserves four itineraries/five fares, exact party miles, unknown cash fees and same-flight stops. American remains a priority; latest ordinary client-header test still did not resolve native transport.

Qantas milestone: anonymous cached Classic Rewards connected with all result pages and21 fares across16 JFK–LHR itineraries. Source observation time, per-person/party values, mixed cabins, currency conversion and First eligibility verified. This adds Qantas-priced American/Emirates/other offered partner inventory without claiming native AAdvantage or immediate Qantas live rechecks. Hosted Linux test independently confirmed Ethiopian; American309/Challenge Validation persists.

Hosted completion audit: the exact integrated code now returns Alaska35 itineraries/68 fares and Aeromexico11/100 on GitHub Linux Node22 after transport fixes. JetBlue16/119, Frontier25/175, Skywards partners4/4, Ethiopian2/3 and Virgin's calendar also succeed. Qantas remains403 there despite local success. Ethiopian's current local entry is intermittently interrupted despite hosted success. These limitations narrow earlier successes; they are not hidden as empty availability.

United's fresh token redirect now succeeds200, but native award inventory428 persists. Delta current GUEST444 and Southwest current shopping403050700 persist on hosted Linux. LATAM and Korean Air normal public booking paths were added to the wider review and reach member login; Korean's separate public calendar is explicitly daily cached data. Six further programs have primary-source redemption/access evidence, distinguished from tested server contracts. See the permanent airline access report for all41 tracked programs/flows and the precise evidence level.

Latest actual frontend acceptance: Alaska all35 itineraries/68 fares verified across both result pages; Aeromexico all11/100, three Business fare families, original MXN fees and USD conversion checked. All147 tests, type/lint, optimized build, GitHub CI and Vercel preview build pass. Vercel runtime access remains unverified behind its existing sign-in. All earlier open product requests remain logged above; no all-airline or fully user-ready completion claim is made.

### Full-browser architecture follow-up

The user’s challenge to the earlier exhaustion claim prompted an actual opt-in American browser worker. All68 messages above remain logged. Eight local browser attempts and five hosted attempts cover standard Chromium/Chrome, WebKit, Firefox, advanced entry, homepage initialization and the homepage booking widget. The widget’s custom-radio issue and hosted Chrome launch issue were fixed; real form submissions still reach verification before inventory. Native AAdvantage remains disabled in the normal app. Two new Southwest full-browser attempts receive shopping403. A local Chrome companion test is waiting on macOS Computer Use permissions and is not falsely marked implemented. Source evidence is in docs/evidence/american-browser-2026-09-05.json and southwest-browser-2026-09-05.json. This is the historical American/Southwest checkpoint; the subsequent Delta milestone adds a verified local native source while the unfinished product backlog remains open.

### Delta native browser milestone — September 5, 2026 (Pacific)

The user’s latest insistence on further independent experiments remains priority 1. A fresh anonymous WebKit service now runs Delta searches from PointSnap without an airline account or paid data source. It verifies every reported response page and preserves every available fare family. LAX–JFK October 5: all 46 itineraries / 167 fares for one adult and 46 / 166 for two. JFK–LHR: 17 itineraries / 41 fares, including Delta-priced AF/KLM partners. This does not connect native Flying Blue.

The main production app was rebuilt and checked in the real browser: all 46 Delta rows accessible, exact USD 5.60 per-person fees, USD 11.20 for two, and all fare choices available through comparison. An overnight duration bug discovered in that review was corrected and regression-tested. Main production API also returned 17 / 41 internationally. All 169 tests, TypeScript, focused lint, optimized build and GitHub CI pass. A separate hosted Mac browser returned all 49 itineraries / 173 fares for October 6 in 24.0 seconds; hosted Linux reached verification. Two hosted Mac American attempts still fail. A successful isolated hosted Delta search is not a deployed production service or an all-airline completion claim. No existing UI/product request was removed or silently completed.

### Smiles native and partner milestone — September 5, 2026 (Pacific)

The airline-first objective remains active and all 68 message groups remain logged. Fresh anonymous Smiles searches now return GRU–GIG five native flights / 42 regular payment and baggage choices for two adults and GRU–CDG 40 partner itineraries / 280 choices. Both pass through the actual PointSnap API. The real UI retains all 14 first-flight fares, original BRL costs, USD conversion, exact party totals and AM/PM times. A later-month calendar bug was caught and fixed during acceptance testing. All 185 tests and the optimized build pass. Two earlier tax-quote errors remain documented; no all-route or hosted reliability claim is made.

American remains a priority: four new local runtime/profile experiments did not connect it, bringing recorded attempts to twelve local / seven hosted. Newly created profiles contain no personal state and are removed after the diagnostic. No existing request has been discarded or checked off without evidence.

Additional UI improvement logged during the source audit: large cash-plus-miles fare families can create a long radio list. Consider a clearer fare-family/payment chooser after airline coverage work, preserving every option and visible total. Cash-plus-miles totals are now labeled “Cash for your party” rather than describing the entire cash portion as taxes. General fare notes no longer imply special eligibility automatically.


### Smiles US partner follow-up

All68 requests remain logged and airline access stays first. A new exact-airport bug was identified in the actual Smiles LAX–AUS response: the airline includes ONT alternatives. Every candidate is still validated, but matching LAX itineraries are retained and other-airport exclusions disclosed. The captured fixture contains three American nonstops and168 fare choices across22 matching itineraries. This is Smiles partner coverage, not native AAdvantage or the still-unimplemented hidden-city feature. Three new regression checks pass. The first hosted macOS Smiles test could not expose the booking form, so hosted access remains unverified.


The US partner change is now verified in the actual app: 22 Smiles itineraries/168 fares, all three nonstops retained by the Nonstop filter, original BRL and USD conversion correct. AA2118 consolidates three booking programs and nine choices after timezone-aware exact matching. A stale group-level stop label was also fixed. All 192 tests and the optimized build pass. Native American and United access remain unfinished; no requirement is marked complete solely because partner flights are available.

### Further native and hosted access tests

All68 requests remain logged and airline access remains the priority. Azul’s ordinary browser returns eight points flights; fresh WebKit/Firefox inventory403 and Chromium entry403 keep its native connector disabled. SAS’s normal points booker exposes all20 CPH–ARN itinerary rows and first-fare taxes anonymously, superseding the inference drawn from its denied award-finder path. Its independent worker attempts still fail; two form-automation mistakes are recorded separately from actual403s. Six hosted Smiles attempts have produced no flights, including a runtime sandbox launch failure that is not airline evidence. Local Smiles remains verified. Browser-only availability is not marked as a completed PointSnap connection.

### Current American milestone — anonymous first

The active goal and saved plan both explicitly prioritize direct anonymous access, then an app-operated anonymous browser, then justified operator-account fallback. A dedicated ordinary Chrome process now returns native AAdvantage results through the local worker, streaming API and real frontend. Every LAX–AUS October 5 two-adult itinerary and fare matches the independent airline website: 40 itineraries, 78 prices, all three nonstops. Program grouping, both result pages, cabin prices, taxes and party totals verified. A normal browser/service restart preserves access. A cookie notice covering Search was caught in an international test and handled normally.

JFK–LHR October 6 returns 40/116 in the worker and its own rendered browser. An independent browser has 40/123 with four different connections; all 36 shared itineraries match. Source-set exhaustiveness, hosted deployment, seven-day qualification and measured cost remain open. A trip-prefilled American handoff is being verified. See docs/evidence/american-persistent-session-2026-09-05.json. No airline-wide completion checkbox has been marked.


Latest American completeness finding: the official Business/First form exposes ten itineraries absent from the independent all-cabin JFK–LHR search. The all-cabin/premium union is now integrated and verified in the real frontend. Keep remaining source limits, hosted access and qualification ahead of UI work. A fresh trip deeplink failed with ERRCODE858 and remains disabled; the generic official form handoff is retained.


Expanded American checkpoint: 206 automated tests, TypeScript, focused lint and optimized Node 22 build pass. Actual UI checks show 51 international and 52 domestic itineraries, with source scope, full pagination and all three domestic nonstops. The initial hosted ordinary Mac search reaches verification; Linux fails at browser startup, which is tracked separately from airline access. All prior product requirements remain active behind the airline-connection priority.

### September 6 UTC — saved connection lessons and hosted American progress

All85 request groups remain logged. The connection playbook consolidates evidence and reusable implementation for subsequent airlines. Standard hosted Linux Chrome now returns native anonymous American results on initial search, after30 seconds idle and after restart:40 itineraries/80 fares in each test. This follows the explicit first-run startup diagnostic; previous Linux launch failures were not proof of airline denial. Expanded hosted searches and remaining completeness work are still in progress.

## September 6 — Etihad initial integration checkpoint

Etihad Guest is now enabled as a native anonymous flight source through the actual local PointSnap API and frontend. The app-owned ordinary Chrome session uses the official public AWARD entry, with no airline login, imported personal profile or data subscription. It combines the actual Economy/Business and Business/First searches, preserves all available returned fare families, and rejects a capped or incomplete list.

JFK–AUH October 5 returned six itineraries / 38 available fares for one and two adults. The raw Economy response contains 45 priced choices, but seven have insufficient seats and must not appear as bookable awards. EY2 Economy is 60,000 miles + USD224.90 per person; the website rounds that cash amount to USD225. LHR–AUH for two adults returned seven itineraries / 76 fares, including four nonstops, First Class and three explicitly labeled rail connections. Another live observation had 73 fares before a later normal search again returned 76; fare availability can change between searches. EY66 First Comfort GuestSeat is 120,000 miles + GBP514.19 per person, or 240,000 + GBP1,028.38 for two.

The full multi-source frontend grouped Etihad, American and JetBlue options under the same EY62/EY64/EY68 flights. Native program filtering, all seven native itineraries, available fare families, original GBP and USD display conversion, party totals, AM/PM times, rail transfers and the premium-cabin handoff were checked in the actual browser. A focused repeat uses the real search API with only Etihad selected; it does not replay fixtures. Settled desktop and 390px mobile screenshots have no horizontal overflow or page errors.

This is scoped local integration, not universal Etihad coverage. The normal request limits each cabin search to 25 flight combinations; hitting that cap is an explicit error while expansion remains open. Verified valid-empty semantics, broader routes and parties, member-specific prices, detailed refund restrictions, hosted access and sustained release qualification remain open. No exact matching cash fare is supplied, so value per point is not fabricated. ANA is next in the anonymous entry pass; previous unresolved airlines and completeness gaps remain logged.

Validation: 218 tests, TypeScript, focused lint and an optimized Node22 build passed. The 87 requirement groups remain intact. Neither the airline-wide completeness requirement nor release qualification is marked complete.
