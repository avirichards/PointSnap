# PointSnap completion plan

Approved in conversation; updated September 6, 2026 UTC with the user's coverage-first sequencing decision. Implementation is authorized. This plan and the current priorities in user-requirements.md supersede older access recommendations; historical findings remain evidence, not instructions or completion claims.

## Current execution priority — connect the airlines first

**Complete the airline-connection pass before spending substantial time on production reliability, hosting optimization, load testing or long-running qualification.** The user explicitly approved this sequence after distinguishing a working connection from a production-ready service. This changes work order, not the final completion requirements.

For each program, get real native award searches working through PointSnap itself, retain all supplied flights and fare choices, verify route/date/party/points/fees against the airline, and check the actual frontend. Fix faults that prevent normal searches or produce incorrect data during this pass. Then move to the next program in the approved order. Keep known inventory gaps explicit and queued for resolution; do not call partial coverage complete.

Hosted deployment, multi-user load, prolonged idle/restart recovery, the 50-search/seven-day reliability qualification and operating-cost optimization remain required before public release. They are a later pass, not a gate that holds all subsequent airline connections behind American. Do not launch further hosted American qualification merely because another hosting experiment is available. Use hosting research now only if it is needed to establish an otherwise unavailable native connection.

American's local native connector has passed the initial integration gate: actual API and frontend searches return its own AAdvantage prices, including nonstops. Preserve the newly discovered connection-city completeness work and the hosted evidence; continue the approved connection order while keeping working sources functional. Etihad has now passed the initial local integration gate; ANA’s current public award entries have been rechecked and reach member login; Southwest, SAS and Copa have now passed their initial local integration gates in PointSnap. Aeroplan, United, BA, Qatar, Virgin full flights, Singapore and Turkish retain their documented unresolved native-access work.

## Outcome and constraints

Deliver a practical, polished public award-search website with reliable native program data, complete flight and fare choices for each supported query, and all remaining product requirements verified in the actual browser. Customers must not need airline account connections or a helper installation. Keep existing working sources available.

**Anonymous connections come first for every airline.** First pursue complete, reproducible direct anonymous access. Use an app-operated anonymous browser when normal browser execution is necessary. Test persistent profiles or an operator-side collector when evidence supports them. Use an operator-held airline account only for demonstrated member-access needs or another verified need that anonymous access cannot meet; a failed anonymous request does not establish that login fixes it. Do not reduce inventory completeness just to describe a connector as free or working.

No award-data subscription. Prefer existing infrastructure and free test allowances; optional paid browser hosting or compute must fit within a total $100/month infrastructure ceiling, supported by measured workload and reliability. Pilot target: 100 submitted searches/day and five simultaneous visitors, with visible queues for large searches. The release airline list remains subject to a later explicit scope decision.

The working order is American, Aeroplan, United, British Airways, Qatar, Virgin Atlantic, Singapore, Turkish, Etihad, ANA, Alaska, Delta, JetBlue, Qantas, Avianca, Emirates and Aeromexico; then other programs. American-first replaces the earlier Aeroplan-first order. Existing source maintenance and necessary verification continue.

## Connection pass — direct anonymous access first

1. **American anonymous search:** reproduce ordinary-browser results for future dates, beginning with LAX–AUS, then representative connecting and international searches. Reconcile every itinerary, cabin, fare and results page for the exact passenger count. Historical result counts are not fixed expectations for new searches.
2. Use an actual app-owned anonymous session where needed, with one active search per profile. Verify that another normal search works and correct session faults that stop it. Extended idle/restart qualification belongs to the later release pass. Temporary profiles do not establish persistence; record exactly what has been tested.
3. If a dedicated ordinary browser receives inventory but the current worker does not, evaluate a restricted operator-side extension and local collector that submits the official search form and returns complete normalized results from that same browser. It must operate independently of the Codex conversation and require no customer installation. Do not transplant personal browser cookies into denied requests.
4. Establish native access for each remaining program in order. Carry reusable lessons into the next program. Evaluate a different execution environment only when it addresses a specific connection obstacle; defer hardening a working local connection for hosting.
5. For a program with demonstrated member-only access, evaluate the authorized operator-account fallback in an isolated session. Do not log credentials or codes. No mailbox access has occurred; any email-code integration requires explicit OAuth consent. Establish the basic native search before building long-term recovery, and record owner-action requirements without promising perpetual sessions.
6. Record latency and resource use as available, but defer infrastructure selection and load/cost optimization until the connection pass has progressed across the programs. Do not purchase award-data subscriptions or exceed the approved infrastructure budget.

For each airline, record hypothesis, changed variable, current official flow, outcome and next action. Distinguish implementation errors, access verification, login requirements, incomplete extraction and valid empty availability. Do not repeat an unchanged failed experiment as a new idea. Public access and member-specific eligibility must remain distinct.

Read and update the [airline connection playbook](../docs/airline-connection-playbook.md) as discoveries accumulate. Carry tested session handling, transport diagnostics, completeness checks and pricing normalization into the next program. Keep airline-specific assumptions as hypotheses until independently verified.

## Search service after the access proofs

- Retain the Next.js frontend and Node airline workers. Add durable jobs, events, observations and connection health in the existing Postgres/Supabase stack with appropriate access control. Query identity must include passenger count and eligibility; legacy keys that omit these are insufficient.
- Introduce POST /api/search/jobs, streamed job events and cancellation while keeping compatibility with the existing search API. Split work by program, airport pair and date; coalesce identical concurrent queries. A visitor leaving must not cancel work still needed by other viewers.
- Prefill matching observations up to 15 minutes old with explicit cached labels and an automatic live refresh. Replace each source snapshot atomically so withdrawn fares disappear. Partial responses must never be labeled complete or substituted for valid empty results.
- Apply shared anonymous as well as authenticated limits, per-program queues and weighted limits for expanded searches. Explain capacity before submission instead of silently omitting airport pairs or dates.
- Keep the owner progress dashboard accurate: current method/stage, last complete search, counts, latency, success rate, recovery state, current issue, next experiment and projected cost. Health checks should not generate airline searches. During qualification, use two bounded live canaries per program per day with bounded transient retries.

## Product completion after airline work

Preserve every request in user-requirements.md. Implement city-wide airport groups with explicit members and pair coverage; accessible departure/return calendars with independent flexibility beneath each; compact default results and a Roomy preference; one physical itinerary with all booking programs and fares; clear one-way versus actual round-trip pricing; fees in the user's display currency with original amounts retained; AM/PM preference; and value-per-point only from a comparable cash fare.

Quick filters, specialist controls, sorting and date-window prices must use the same matching fares. Finish accounts, wallet, saved searches and correct airline handoffs. Additional useful features include a shortlist, shareable filter URLs, fare export and an in-app watchlist governed by the same freshness and cost limits. Verify actual desktop, mobile and keyboard interactions, including loading, error, empty and partial states. Preserve the requested globe animation, route glow, drag behavior and inertia.

Hidden-city exploration remains explicitly opt-in. Discover actual observed tickets through the requested intermediate destination, preserve the full ticket cost and onward destination, and clearly show the unused segment and relevant booking limitations. Begin with up to eight verified onward endpoints with visible scope and expansion. Include the LAX–AUS via a ticket to JFK regression. Do not invent an independently available first-leg award or imply an exhaustive onward search.

## Qualification and release

This phase follows the airline-connection pass. Before selecting permanent infrastructure, compare the proven flow on the actual candidate host and measure workload cost within budget. For member-only access, prove session recovery separately using a dedicated operator arrangement; an initial account search is not proof of durable public service. A personal-inbox test must become a dedicated operator inbox before public operation, and any email-code integration still requires explicit OAuth consent. Historical hosted diagnostics remain useful evidence and need not be rerun now.

Qualify each program with at least 50 real representative searches over at least seven days, including two daily canaries. Reconcile all displayed itineraries and fare choices, validate route/date/party/cabin/fees/pagination, distinguish valid empty searches, and target at least 98% completion on the defined sample. Test the actual host, normal restarts and idle periods; for member access, test deliberate sign-out and automatic recovery with no routine manual login during qualification. This is measured qualification, not a promise of permanent access. Continue implementing the next program while collecting reliability evidence for the prior one.

Verify shared jobs, cancellation, crashes, streaming recovery, member isolation, cache withdrawals, Business-filter date prices, currency/value calculations, airport-local times and DST, city-pair partial coverage and hidden-city semantics. Use fixtures for load tests and bounded real searches for access checks. Review the real frontend after changes. Verify projected monthly cost against the workload.

Deploy a preview, verify migrations and runtime, then promote a tested commit only when its declared release scope passes. Use feature flags and a rollback path. An enabled parser, partner inventory or ordinary-browser screenshot does not qualify as a complete native connection. For unresolved access, retain a decision record with the distinct options tested, observed failures, remaining capability needed and next available action; never label an unresolved program complete.
