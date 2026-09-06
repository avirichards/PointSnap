# PointSnap — Lessons Learned

## Current connection lessons — September 2026

Azul's public points-offer handoff yielded real anonymous inventory where its homepage failed, but fresh queries did not reproduce it. Keep browser access evidence separate from an enabled native connection. Public airport pickers can change a selection asynchronously: verify final fields and the actual request, not just a successful option click. Exclude nearby-airport alternatives from exact-route counts, retain account-holder pricing conditions and never confuse remaining aircraft capacity with award-fare seats.

SAS reuses the app-owned ordinary Chrome lifecycle successfully after earlier HTTP/managed-browser failures. Its regular points response contains a cash reference total distinct from the actual tax copayment; verify selected-cart prices. Some international visible fare titles are blank while accessible fare-rule labels are correct. Internal cabin codes are airline-specific: SAS Y can be European Business or long-haul Premium. Record unknown segment cabins instead of guessing.

The user explicitly approved a coverage-first pass: establish and verify native airline connections through PointSnap, then move to the next airline. Fix incorrect data and failures that prevent normal searches now; defer substantial hosting, load optimization and long-running reliability qualification until after the connection pass. Do not keep American in extended deployment experiments while other native connectors are still missing. Final completeness and public-release requirements remain unchanged.

The maintained [airline connection playbook](../docs/airline-connection-playbook.md) consolidates transferable findings, their evidence, reusable implementation and the procedure for each next airline. Read it together with the current completion plan before testing another program. Record the cause and first failing stage rather than labeling every unsuccessful request a blocked airline.

Anonymous access comes first. American's new app-owned ordinary Chrome connection supersedes the old assumption that a paid proxy or login is necessary for that program. A single search can still omit itineraries: separate all-cabin and Business/First searches now reveal additional flights. Carry those completeness checks, isolated sessions, normal form-state resets and staged diagnostics into the next connector.

The May notes below are historical observations and recommendations, not current instructions. In particular, the user now makes Apple HIG optional where useful, prioritizes real airline data and excludes award-data subscriptions. Follow the current user requirements rather than stale recommendations.

Per CLAUDE.md §3: after any correction from the user, write the pattern here so the same mistake doesn't repeat.

## Session 2 (2026-05-17)

### Always invoke `apple-hig` skill before any UI/UX work
Codified in CLAUDE.md top section. No exceptions, even for "small" design changes like badge colors or row-height tweaks.

### When mock data is the right call, defend it explicitly
User asked "do we need fake data instead of starting with real" and "build scrapers from the beginning … unless you feel strongly otherwise." Stayed with mock data and explained why: one scraper covers ~5 partner programs, the spreadsheet needs all 13 columns to design against, scraper infrastructure is days-to-weeks of co-design overhead, and mock data takes ~1 hour while scrapers take days. User accepted. Document the cost/benefit when the architecture answer differs from the user's first instinct.

### Don't generate a `down` migration in Drizzle, use Neon PITR
Drizzle-kit doesn't generate down migrations. Mitigation: Neon point-in-time recovery for "oh no" moments, additive-only changes within a release, destructive changes in a follow-on release. Codified in `docs/planning/04-data-model.md` §6.

### Pin pnpm to 10.33 in package.json — pnpm 11 enforces strict-dep-builds
pnpm 11.x treats ignored build scripts (sharp / @clerk/shared / esbuild / unrs-resolver) as fatal exit-1, even on a successful CLI run. Setting `packageManager: "pnpm@10.33.0"` in package.json restores the prior behavior. Necessary for `drizzle-kit generate` to work in CI/dev.

## Session 3 (2026-05-18) — Scrapers

### IPRoyal residential username vs password targeting
IPRoyal's geo/session targeting attaches to the **password** field, not the username. Format: `password_country-us_session-xxx_lifetime-10m`. Putting suffixes on the username causes `ERR_PROXY_AUTH_UNSUPPORTED` from Chromium. Default to `country-us` since most target sites are US-based and the bare residential pool returns random global exits (observed Vietnam IP, which then gets geo-filtered by airline edges).

### IPRoyal blocks airline domains at the proxy layer
`aa.com`, `delta.com`, and `aircanada.com` return `ERR_TUNNEL_CONNECTION_FAILED` regardless of exit country — IPRoyal refuses CONNECT requests to these specific domains at the upstream proxy server. They aren't on the public abuse list but are clearly filtered. Unblocking requires emailing IPRoyal support (their docs explicitly say no self-service). For these three sites we need a different proxy provider or a render-as-a-service (ZenRows / Bright Data Web Unlocker / ScraperAPI).

### Akamai blocks Fly datacenter IPs even for sites IPRoyal doesn't reach
Earlier session believed Fly direct egress worked for `aircanada.com`; re-tested 2026-05-18 and got 403 "Access Denied" with `errors.edgesuite.net` reference — Akamai has the Fly IP range on their blocklist now. So the `use_proxy=False` AC fallback no longer works.

### `united.com` silently drops connections from both Fly and IPRoyal
Both Fly direct egress and IPRoyal US-residential exits time out on `Page.goto` to `https://www.united.com/en/us/fsr/choose-flights` — even with `wait_until=commit` (which fires on first byte). Their edge is blackholing these IPs at the TCP level. Needs a different scraping approach: render-as-a-service, mobile proxy, or paid clean-IP pool.

### `britishairways.com` returns "Information Page" interstitial through residential
Even with GB-targeted IPRoyal exit (BT residential 82.28.x), BA serves a queue/throttle page titled "British Airways - Information Page" instead of the login form. The page body says "We are experiencing high demand on ba.com at the moment". This is an Akamai-style load-shedder triggered by automation heuristics. Workaround: try direct API endpoints (skip the consumer login UI), use a queue-skipper service, or accept BA stays canonical.

### What works as of 2026-05-18
- **VS_FLYING_CLUB**: live (calendar API, no Akamai gating)
- **AS_MILEAGEPLAN**: live (SvelteKit SSR — alaskaair.com not protected by Akamai for that route)
Both via IPRoyal US-residential. All other 11 plugins hit one of the blockers above.

### ScraperAPI proxy mode is per-resource — burns credits fast
With ScraperAPI's proxy-port endpoint and `render=true`, every HTTP resource the browser fetches counts as one charged request. A single delta.com page load fired ~150 requests through the proxy = 150 credits. Free tier 5000 credits/mo → ~33 page loads of that complexity. Mitigation: `page.route("**/*", lambda r: route.abort() if resource_type in ("image","stylesheet","font","media","manifest") else route.continue_())` blocks heavy resources and saves ~15x. Better: switch to ScraperAPI's API endpoint mode (`https://api.scraperapi.com/?url=X&render=true`) which charges 5 credits flat per page, not per resource.

### ScraperAPI "premium" tier is required for AA/AC/UA
On the shared pool, aa.com and aircanada.com return 499 "We detected multiple users connecting from your IP address — only allowed for paid subscription plans"; united.com returns 500 "Protected domains may require premium=true". `premium=true` in the username (`scraperapi.render=true.premium=true.country_code=us`) uses clean residential exits and costs 25 credits/request instead of 5.

### ScraperAPI proxy needs ignore_https_errors
ScraperAPI's proxy port terminates TLS at their server and re-presents their own certificate; Chromium reports `ERR_CERT_AUTHORITY_INVALID` unless the context is created with `ignore_https_errors=True`. Same applies to any future MITM-style proxy.

### Two layers to fix per stuck plugin
1. **Network access** — ScraperAPI proxy + premium for hard sites. Done.
2. **Parse layer** — each plugin's XHR endpoint / form selector / response shape was written speculatively against historical AwardWiz references and never tested against live responses. Even with the page loading, scrapers return `rows: []` because the parsers don't match current API shapes. This is real iteration work per plugin (~30-60 min each), not infrastructure.

- 2026-09-05: PointSnap searches must use app-owned data access. Never require travelers to connect personal airline accounts to search. Distinguish provider coverage from user account connections in every UI label.
- 2026-09-05: Design for airline/points enthusiasts from a clean slate. The supplied dark globe reference is a direction; any map interaction must help route selection and preserve fast comparison.

- 2026-09-05: Draggable SVG maps must disable native text selection and prevent pointer-down focus/selection defaults. Preserve a visible keyboard-only focus state; avoid a mouse-triggered rectangular outline around the globe.

- User's core requirement is complete flight-level inventory, not just an endpoint that returns a daily award price. Mark calendar integrations as partial, separate them from flight lists, and explicitly verify completeness/pagination/cabins before describing an airline as connected and complete.


## Status questions during ongoing airline work

The user explicitly prioritizes airline access and asked not to stop until connections work or all remaining practical ideas are exhausted. Answer status questions briefly, then resume concrete work in the same turn. One denied endpoint, a browser-only proof, or a passing parser fixture is not overall completion. Record distinct attempts, response evidence and open leads, and keep the live feed aligned with actual activity.

- Airline response graphs can reuse flight segments by reference and count same-flight technical stops. Completeness checks must resolve references and compare every native itinerary before enabling a source. Passenger-total quotes and missing tax amounts require explicit normalization; verify the selected cabin survives booking handoff in the real browser.


- Qantas: public cached search can work through a compatible Node HTTP client while default fetch returns403. Test transport separately from login and data-contract hypotheses. Keep original observation times; a successful fetch is not a live availability check.
- Never equate a source’s “direct” count with nonstop: QF1 SYD–LHR is a single represented flight with an omitted intermediate stop. Preserve data and disclose uncertainty rather than inventing segments or offering a false nonstop match.
- An isolated tsx diagnostic in this CommonJS package must wrap await calls in async main; a typecheck alone does not verify its runtime entry.

## September 6 — Virgin, Singapore and Turkish connection pass

Current evidence is stored in the three dated entry reports. Virgin’s public deal handoff reaches login; its calendar final dialog uses the already-tested full-reward form. Singapore’s advertised new booking mode was confirmed before checking redemption and still requests login. Turkish’s normal keyboard controls completed the actual query before validation returned 403. Treat a form-interaction failure separately from an access denial, and never count metadata or calendar minima as full flight inventory. Etihad and ANA are next in the approved order; earlier native gaps remain open.

## September 6 — Etihad native awards and reusable collection lessons

- A normal dedicated Chrome session can succeed after an interrupted direct request. Reuse the browser lifecycle, then independently verify each airline’s actual public entry and response contract.
- Etihad’s Economy URL requests Economy/Business; its Business URL requests Business/First. One successful response misses cabins. Both source requests and query details must validate.
- `showSoldOut:true` supplies prices for zero-seat fares. Count actual available party-sized offers, not every priced object: the JFK sample is 38 available fares, not 45.
- The published client pairs `convertedMiles.base` with exact cash taxes. Alternative converted-total/remaining-cash fields represent another payment choice. Reconcile adult totals and currency decimal places before normalization; do not infer cents per point from an unrelated cash fare.
- Airline-marketed segments can be trains with a station-to-airport transfer. Preserve operating names, technical stops, local clocks and explicit transfers. Use word-boundary transport detection so AIRBUS is not mislabeled BUS.
- Later cabin searches can withdraw or change fare classes. Replace the covered cabin’s earlier fare set on shared itineraries; never retain a stale cheap price merely because its booking class changed.
- A returned 25-combination limit is not proof of completeness. Report a capped response explicitly and keep expansion open. Valid empty searches and full route scope require their own evidence.
- Check the actual booking handoff from the selected fare. First now opens Etihad’s premium search instead of the default Economy search.
- Wait for dialogs and their transitions before visual screenshots. Desktop and 390px mobile views, source grouping, original fees and rail details were inspected; no horizontal overflow or page errors in the final check.
- Preserve only flight/fare evidence. Selection tokens, office/corporate metadata and account fields never belong in normalized payloads or permanent fixtures.

## September 6 — transferable Southwest and member-entry lessons

- Reusing the proven app-owned ordinary Chrome lifecycle unlocked Southwest after direct HTTP and managed WebKit/Firefox failures. Reuse the runtime, then independently validate each airline's request and data contract; it does not remove ANA, LifeMiles or Emirates member gates.
- Create a new page for each Southwest request. Validate both adult-count fields in the site's own POST. A reused page or visible old result does not establish the new passenger query.
- Reconcile available and unavailable fare buttons separately. Southwest's internal BUSRED is Choice Extra in Economy, not Business. The aggregate containsAvailability flag was false despite actual available fares and cannot be trusted as inventory status.
- Same-flight stopsDetails includes the final arrival. Exclude that arrival from intermediate stops and validate physical-leg duration, layover and plane-change data. Never promote a service with an intermediate stop to nonstop.
- Preserve per-person points and fees, exact party totals, unknown seats/refund terms and optional same-flight/family cash matches. Do not infer a booking guarantee from a positive source price.
- Check the normal multi-source page, not just a provider-only diagnostic. Start short queries early; expensive collectors can consume another source's deadline in a shared queue. The regression test proves Southwest can finish while four other browser sources remain pending, with all five eventually attempted.
- Browser checks should operate the visible label of styled inputs and use the mobile drawer's Show flights action or Escape; desktop Done and direct clicks on clipped inputs are not interchangeable. Close each owned QA browser before launching another so duplicate diagnostics do not compete for airline sessions.
