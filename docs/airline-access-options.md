# PointSnap — airline access options

Updated September 5, 2026, after approval of the completion plan and clarification that connections without a data subscription or airline sign-in come first. The current public-site plan below supersedes the earlier traveler-connected proposals retained in this assessment. An access option is not a verified connection.

## Recommendation

Keep the working direct feeds and anonymous American, Delta and Smiles browser services. Continue qualifying **American** first: native anonymous execution and normal restart now work locally, while expanded inventory completeness and hosted reliability remain open. For each program, first pursue a complete, reproducible direct anonymous connection. If ordinary browser execution is needed, use an app-operated anonymous browser, including a dedicated persistent profile where appropriate. Customers must not need airline connections or a helper installation.

Use an operator-held airline account only as a fallback for a demonstrated member-access requirement or a separately verified need that anonymous access cannot meet. A denied anonymous request is not, by itself, evidence that login is required or would fix it. Preserve member eligibility and evaluate the suitability of centrally operated access before public use. Account setup and repeated verification are not the default path for airlines that can be searched anonymously.

There is no award-data subscription in the approved plan. Prefer existing infrastructure and free test allowances; any paid browser hosting or compute must be justified by measured results and fit within the total **$100/month infrastructure ceiling**. Anonymous access avoids a data subscription and sign-in dependency, but does not imply zero compute or maintenance cost. The active goal states this priority explicitly. See the [approved completion plan](../tasks/completion-plan.md).

The working airline order is American, Aeroplan, United, British Airways, Qatar, Virgin Atlantic, Singapore, Turkish, Etihad, ANA, Alaska, Delta, JetBlue, Qantas, Avianca, Emirates and Aeromexico, followed by other programs. This airline order is separate from the access-method order: anonymous first for every program. The release list may be narrowed later only by an explicit scope decision.

## Account fallback — pilot status

The earlier Aeroplan-first recommendation is superseded by the approved American-first proof. The user authorized evaluation of operator-held airline accounts, persistent sessions and automatic recovery for programs that need them. This remains a fallback, with a separate reauthentication proof before building substantial shared infrastructure. No new airline account has been created from this proposal.

The user has now authorized using an existing Air Canada account. A dedicated visible Chrome profile has been created locally, separate from personal browser profiles, with restricted filesystem permissions and excluded from version control. The diagnostic does not save credentials, cookies, page bodies or traces as evidence. Browser-managed session storage remains inside that profile. This establishes the pilot environment, not a successful award-search connection.

Session retention cannot guarantee three months without verification. Air Canada's current account-support documentation says 2FA is required on every new sign-in. Reuse a valid session, test its behavior after a normal browser restart, and detect when the airline requires a fresh sign-in. A one-time verification code cannot be retained for future authentication. No remembered-device exception or 90-day session lifetime has been verified. [Air Canada account support](https://www.aircanada.com/ca/en/aco/home/customer-profile/frequently-asked-questions.html).

An Aeroplan account addresses the sign-in requirement observed on the current homepage. It does not yet prove complete inventory extraction, background reliability, session renewal, or access from a hosted machine. Accept the pilot only after PointSnap matches all visible itineraries, cabins, fares, taxes and party sizes across representative searches. Test reconnect behavior as well as a successful initial run. A public deployment that relies on centrally held accounts has separate capacity, eligibility and permitted-use questions; a personal member price must not silently become a universal fare.

An always-on machine or an operator-side extension can run these browser workers without requiring customer installation. Queue work per program and reuse explicitly labeled recent results for identical queries, with an automatic fresh search. These improve efficiency but do not independently remove login or browser-access failures. The earlier per-traveler extension option below is retained for comparison; it is not the approved public-site architecture.

The repository contains older account-capture and encrypted-session code, but it relies on paid browser tooling and cookie transplantation. Its existence is not a verified no-subscription connection. The proposed persistent normal-browser pilot needs separate implementation and acceptance testing.

## Options reviewed — current recommendation above takes precedence

| Option | What the traveler does | What PointSnap could gain | Cost and principal limitation |
| --- | --- | --- | --- |
| Continue direct anonymous connectors | Searches normally | Fresh results from the sources we can reach, including their offered partner awards | No data subscription; ongoing engineering/hosting. Current coverage is partial and access varies by runtime. |
| Local browser companion | Installs an extension or desktop helper; signs in to individual airlines only when required | Results from searches in the same ordinary browser where the user can see them | No aggregator subscription required. Browser must be available; per-airline automation, login interruptions and complete result extraction need validation. Desktop-first initially. |
| Hosted browser with each user's airline connection | Connects each desired program and completes sign-in/MFA when necessary | Potential website/mobile experience with searches performed by PointSnap's browser service | Browser hosting, session isolation and maintenance costs. Login does not remove automation challenges; sessions expire and may need user intervention. Not currently verified. |
| App-operated browser service | May need no traveler connection for public searches; member-only access needs an appropriate authorized service arrangement | Potential centrally operated searches for visitors | Separate browser infrastructure experiment. Ordinary personal membership must not be assumed to authorize shared public use or identical prices for everyone. Delta and Smiles now work through the app-operated anonymous browser service locally. Smiles returns native GOL and offered partner awards with complete payment choices and exact fees; some tax quotes fail. The new dedicated ordinary-Chrome American path now works locally without login: domestic 40/78 matches the independent two-adult website exactly and normal restart succeeds. International source-set completeness and hosted qualification remain open. Delta also passes a fresh hosted Mac search; hosted Linux reaches verification. Long-running hosting reliability and any shared member-access arrangement remain unverified. |
| Connect a Seats.aero Pro account | Signs in to Seats.aero and grants PointSnap access | Broad cached discovery through a documented integration | Each connected user needs eligible Pro access. No separate commercial API charge through the documented OAuth route; no live-search API. |
| License award data | Searches PointSnap normally | Fresh searches and/or cached discovery across the contracted programs | Provider approval and commercial pricing. Validate the actual program/route/fare coverage; no evidence supports a guarantee of every airline and every flight. |
| Direct airline/loyalty partnership | Potentially nothing, or airline consent depending on the agreement | Approved access to that partner's inventory | A business-development route, not a self-service universal API. Availability and terms would have to be established individually. |
| Contributed observations and official handoffs | Optionally shares non-sensitive search results, or finishes a search on the airline site | More discovery coverage and a useful fallback when an integrated search fails | Observations age and leave gaps. Public sharing requires an explicit opt-in and suitable data rights; this cannot replace a fresh exhaustive search. |

The browser service now returns native American, Delta and Smiles results in the actual local app. American uses a separately launched ordinary Chrome process with a dedicated anonymous profile; all 40 domestic two-adult itineraries and 78 fares match the independent website and a normal restart succeeds. The combined all-cabin/premium collector now exposes 51 international itineraries / 130 fares and 52 domestic itineraries / 90 fares for two adults. Further search-scope completeness remains open. Delta also succeeds in a fresh hosted Mac diagnostic. These results establish specific tested paths, not a universal architecture or permanent hosted service. Earlier managed-browser denials remain historical evidence. No customer companion or copied personal browser state is needed for the new American path. See the [current evidence](evidence/american-persistent-session-2026-09-05.json).

There is a relevant product precedent: award.sh describes an extension that collects observations as members search airline websites. That is vendor-described behavior, not a tested PointSnap integration, a public API entitlement, or evidence of complete worldwide coverage. [award.sh](https://award.sh/).

## Earlier traveler-connected proposal — outside the current public-site plan

PointSnap should show available direct results immediately. For an additional program, offer a clear connection action explaining which airline must be opened. The traveler completes that airline's normal sign-in on its own site. A local companion can then extract allowed flight-result fields and return them to the traveler's comparison without sending passwords or session cookies to PointSnap. This is the proposed design, not an implemented privacy guarantee.

Keep member-specific offers scoped to that user. A login can affect eligibility, inventory and pricing; a personal observation must not silently become a universally bookable public fare. Expired sign-in, incomplete pagination, unavailable data and a completed search with no seats must remain distinct outcomes. The traveler needs an obvious disconnect action.

For a hosted version, retain isolated browser contexts and design explicit reconnect handling. Existing repository code contains an older credential/MFA/session-capture implementation and encrypted storage helpers. Its presence is not proof of current airline compatibility or production readiness. It would need substantial validation before activation; the active search engine does not establish a working authenticated feed merely because those files exist.

## Provider research — retained for reference, outside the approved no-subscription plan

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

American now returns native AAdvantage awards through PointSnap's own anonymous runtime. The missing LAX–AUS nonstops are present, with every domestic two-adult flight and fare reconciled against the ordinary website. The additional Business/First search is now integrated and exposes additional itineraries. The remaining work is further route/search-scope completeness, qualification and hosting. A password has not been needed for the working American path. The initial proof now runs independently of the Codex conversation.

United's observed native miles flow asks for member sign-in, and separate server inventory attempts encountered verification. A user connection may resolve the first boundary; it has not yet been shown to resolve the second. Aeroplan, Flying Blue, LATAM and other login-gated programs are additional candidates for authenticated research, not automatically enabled connections.

Connecting one program can expose its offered partner flights. It cannot establish the native award inventory or prices of every partner program. For example, American flights sold through Alaska are different booking offers from native AAdvantage awards. The existing [airline evidence report](airline-access-status.md) records the tested distinctions.

## What must be proven before selecting an architecture

1. Run fresh searches across multiple routes, dates, cabins and party sizes, including the user's missing LAX–AUS nonstop example.
2. Reconcile every itinerary, fare family and result page against the airline; preserve exact taxes/currency or explicitly mark unknown precision.
3. Repeat after an idle session, browser restart and required reauthentication. Demonstrate recovery rather than only one successful login.
4. Verify the actual intended environment: local companion, hosted browser or deployed API. A local success is not hosted production evidence.
5. Establish supported coverage, observed age, member eligibility, concurrency limits and recurring cost. For a supplier, confirm data-use rights and the contracted fresh-search product.

No new airline account, data subscription, commercial inquiry or OAuth application was created during this options review. Operator-account fallback is authorized for evaluation, but remains secondary to anonymous methods. American, Delta and Smiles have verified local native responses; only Delta has a successful hosted browser diagnostic so far. Other proposals do not change verified coverage until their own checks pass.

Historical Smiles follow-up: no traveler login or subscription was needed for native GOL or offered partner awards. At that checkpoint, twelve local and seven hosted managed American attempts had failed. The new dedicated ordinary-Chrome American milestone above supersedes that local status; its hosted behavior is a separate pending test.