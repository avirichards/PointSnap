# PointSnap — airline access options

Reviewed September 5, 2026, after the user explicitly reopened airline-account connections as an option. Anonymous search remains the preferred experience, but is no longer the only architecture to evaluate. This is an options assessment, not a claim that the proposed connections work or that commercial access has been approved.

## Recommendation

Keep the working direct feeds and the new anonymous Delta browser service. Continue testing independent browser runtimes for missing programs, and investigate an optional local browser companion where an ordinary browser succeeds but the app-operated runtime does not. A traveler would sign in on the airline's own website when required, then let PointSnap organize the results of their searches. Test American first because its anonymous browser already shows full flight results; then test a member-only program such as United or Aeroplan with a user-authorized login. This is the most promising engineering experiment under the preference to avoid data subscriptions, not a proven universal solution.

If the eventual requirement is a public website that works on any device, searches in the background, and requires neither airline logins nor an extension, pursue commercial data access alongside direct connectors. Seats.aero and AwardTool have documented fresh-search interfaces; PointsYeah, point.me and Roame are additional commercial leads with different levels of public documentation. Pricing, acceptance of PointSnap's use case, and contracted coverage remain unknown.

## The practical choices

| Option | What the traveler does | What PointSnap could gain | Cost and principal limitation |
| --- | --- | --- | --- |
| Continue direct anonymous connectors | Searches normally | Fresh results from the sources we can reach, including their offered partner awards | No data subscription; ongoing engineering/hosting. Current coverage is partial and access varies by runtime. |
| Local browser companion | Installs an extension or desktop helper; signs in to individual airlines only when required | Results from searches in the same ordinary browser where the user can see them | No aggregator subscription required. Browser must be available; per-airline automation, login interruptions and complete result extraction need validation. Desktop-first initially. |
| Hosted browser with each user's airline connection | Connects each desired program and completes sign-in/MFA when necessary | Potential website/mobile experience with searches performed by PointSnap's browser service | Browser hosting, session isolation and maintenance costs. Login does not remove automation challenges; sessions expire and may need user intervention. Not currently verified. |
| App-operated browser service | May need no traveler connection for public searches; member-only access needs an appropriate authorized service arrangement | Potential centrally operated searches for visitors | Separate browser infrastructure experiment. Ordinary personal membership must not be assumed to authorize shared public use or identical prices for everyone. Delta now works through the app-operated anonymous browser service locally. The separate American pilot still reaches verification. Delta also passes a fresh hosted Mac search; hosted Linux reaches verification. Long-running hosting reliability and any shared member-access arrangement remain unverified. |
| Connect a Seats.aero Pro account | Signs in to Seats.aero and grants PointSnap access | Broad cached discovery through a documented integration | Each connected user needs eligible Pro access. No separate commercial API charge through the documented OAuth route; no live-search API. |
| License award data | Searches PointSnap normally | Fresh searches and/or cached discovery across the contracted programs | Provider approval and commercial pricing. Validate the actual program/route/fare coverage; no evidence supports a guarantee of every airline and every flight. |
| Direct airline/loyalty partnership | Potentially nothing, or airline consent depending on the agreement | Approved access to that partner's inventory | A business-development route, not a self-service universal API. Availability and terms would have to be established individually. |
| Contributed observations and official handoffs | Optionally shares non-sensitive search results, or finishes a search on the airline site | More discovery coverage and a useful fallback when an integrated search fails | Observations age and leave gaps. Public sharing requires an explicit opt-in and suitable data rights; this cannot replace a fresh exhaustive search. |

The same browser-service architecture now returns complete native Delta searches locally: 46 LAX–JFK itineraries across three pages and 17 JFK–LHR itineraries including partners. The main app has been verified with one- and two-adult requests, and a fresh hosted Mac runner returned 49 itineraries / 173 fares for a separate date. Hosted Linux still reaches verification. A dedicated American browser-worker pilot is also implemented and tested locally. The American pilot has not yet returned a complete live response: WebKit and Firefox submit the form but reach verification, while Chromium/Chrome are denied at booking entry. The companion and connected-user options below remain engineering proposals. Chrome documents permission-scoped content scripts that can read page content; this supports the architecture, not the reliability of any particular airline connector. A normal PointSnap webpage cannot simply read another site's logged-in tabs. A companion or an authorized hosted integration is a substantive requirement. [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [cross-origin boundaries](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

There is a relevant product precedent: award.sh describes an extension that collects observations as members search airline websites. That is vendor-described behavior, not a tested PointSnap integration, a public API entitlement, or evidence of complete worldwide coverage. [award.sh](https://award.sh/).

## What the connected approach would look like

PointSnap should show available direct results immediately. For an additional program, offer a clear connection action explaining which airline must be opened. The traveler completes that airline's normal sign-in on its own site. A local companion can then extract allowed flight-result fields and return them to the traveler's comparison without sending passwords or session cookies to PointSnap. This is the proposed design, not an implemented privacy guarantee.

Keep member-specific offers scoped to that user. A login can affect eligibility, inventory and pricing; a personal observation must not silently become a universally bookable public fare. Expired sign-in, incomplete pagination, unavailable data and a completed search with no seats must remain distinct outcomes. The traveler needs an obvious disconnect action.

For a hosted version, retain isolated browser contexts and design explicit reconnect handling. Existing repository code contains an older credential/MFA/session-capture implementation and encrypted storage helpers. Its presence is not proof of current airline compatibility or production readiness. It would need substantial validation before activation; the active search engine does not establish a working authenticated feed merely because those files exist.

## Provider choices checked against official sources

### Seats.aero: personal, connected-user and commercial are separate

An eligible existing Pro account offers a personal, noncommercial API allowance of 1,000 calls per day, including cached search and trip details. It cannot be used as the shared commercial backend for all PointSnap visitors. This could be useful for the user's own personal version without another subscription. [Pro API access and limits](https://docs.seats.aero/article/68-seatsaero-pro-api-access-limits-and-usage).

The documented **Login with Seats.aero** integration lets eligible Pro users authorize an app. Each user's 1,000-call allowance is shared across their personal key and connected apps. New OAuth apps have a ten-user limit; the documentation says approval to remove that limit is free. Eligibility and the OAuth addendum apply. These tokens cannot call Live Search. [OAuth overview](https://developers.seats.aero/reference/overview).

Fresh Live Search requires a commercial agreement and covers supported mileage programs. Dynamic-price filtering is enabled by default, so a completeness evaluation must account for it. PointSnap already has an adapter, but credentials, provider acceptance and actual integration verification are still required. [Live Search](https://developers.seats.aero/reference/live-search).

### AwardTool: another documented fresh-search supplier

AwardTool documents an asynchronous flight-search API: submit a specific date/program/cabin/party search and retrieve the task's results. Its separate Panorama product uses previously collected availability. PointSnap has a prepared AwardTool adapter; that is not a purchased or verified live connection. Commercial pricing and the programs available to this app still need confirmation. [Real-time search](https://docs.awardtool.com/award-tool-api/real-time-award-flight-search/real-time-search-api-crawler-trigger), [Panorama](https://docs.awardtool.com/award-tool-api/panorama).

### PointsYeah: commercial API lead, with a freshness question

PointsYeah publishes developer documentation and invites commercial-use discussions. The specific flight endpoint reviewed is an Explorer dataset with approximately 61 days of forward-looking data. Its general introduction describes real-time pricing, but the reviewed endpoint does not establish a new airline search for each request. Ask for the exact on-demand product and freshness contract before selecting it for the main mission. [Getting started](https://beta.pointsyeah.com/developers/getting-started), [Flight Search endpoint](https://beta.pointsyeah.com/developers/flights/search).

### point.me and Roame: partnership leads

point.me advertises Gateway, a branded/API-oriented redemption platform for financial institutions and loyalty partners. This establishes a business offering, not PointSnap's eligibility, an off-the-shelf price or a tested standalone feed. [point.me Gateway](https://www.point.me/partnerships/).

Roame lists enterprise solutions separately from its noncommercial consumer memberships. Its public membership page does not specify a developer contract or API pricing, so it is an inquiry lead rather than an available connector. [Roame membership and enterprise options](https://roame.travel/subscription).

AwardFares says it has no public developer API. A consumer subscription there should not be treated as an integration license. [AwardFares product comparison](https://awardfares.com/blog/awardfares-vs-awardtool/).

### Useful additions that do not supply missing award searches

AwardWallet's Account Access API shares authorized loyalty-account information and existing itineraries. It could help with balances and wallet usability; the reviewed account API does not establish a fresh award-availability search endpoint. [AwardWallet Account Access API](https://awardwallet.com/api/account).

Amadeus explicitly says its Self-Service APIs do not display loyalty-point prices or book with points. Cash-search tools may support the cash-versus-points comparison, but this offering does not solve the missing award inventory. [Amadeus FAQ](https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/).

## American, United and the meaning of “connected”

American's ordinary anonymous browser already returned 40 itineraries and 69 fares in the recorded LAX–AUS test. Its candidate parser preserves that response. The unresolved part is reliable search execution from PointSnap's runtime; adding an AAdvantage password is not an established fix. The browser-companion experiment should first prove that the complete ordinary browser result can reach PointSnap reliably, without transplanting verification/session credentials into denied server requests.

United's observed native miles flow asks for member sign-in, and separate server inventory attempts encountered verification. A user connection may resolve the first boundary; it has not yet been shown to resolve the second. Aeroplan, Flying Blue, LATAM and other login-gated programs are additional candidates for authenticated research, not automatically enabled connections.

Connecting one program can expose its offered partner flights. It cannot establish the native award inventory or prices of every partner program. For example, American flights sold through Alaska are different booking offers from native AAdvantage awards. The existing [airline evidence report](airline-access-status.md) records the tested distinctions.

## What must be proven before selecting an architecture

1. Run fresh searches across multiple routes, dates, cabins and party sizes, including the user's missing LAX–AUS nonstop example.
2. Reconcile every itinerary, fare family and result page against the airline; preserve exact taxes/currency or explicitly mark unknown precision.
3. Repeat after an idle session, browser restart and required reauthentication. Demonstrate recovery rather than only one successful login.
4. Verify the actual intended environment: local companion, hosted browser or deployed API. A local success is not hosted production evidence.
5. Establish supported coverage, observed age, member eligibility, concurrency limits and recurring cost. For a supplier, confirm data-use rights and the contracted fresh-search product.

No new airline account, data subscription, commercial inquiry, OAuth application or connected session was created during this options review. Account connections are now in scope for evaluation; Delta has passed local application checks and one complete hosted Mac diagnostic; the remaining proposals do not change verified coverage until their own checks pass.
