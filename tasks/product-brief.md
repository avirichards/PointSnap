# PointSnap — user direction

This brief records the user's current requirements and takes precedence over assumptions in earlier plans.

- Finish PointSnap to the best of our ability, including its central live award-search capability.
- The biggest previous failure was pulling live results across airlines. UI work must continue alongside data and reliability work; a polished shell does not complete the task.
- Users should sign into PointSnap and search across programs without ever connecting their own airline accounts. Provider access belongs to PointSnap's backend.
- Latest correction: the user has an existing Seats.aero Pro account and explicitly authorized inspecting its logged-in browser and browser-delivered code. No additional subscription or commercial license is authorized. Do not fabricate access, availability, schedules, prices, or universal coverage.
- Reconsider the app from a clean slate. Existing UI or code should influence choices only when it is useful.
- Audience: airline and points enthusiasts. Prioritize useful comparisons of points, cash fees, cabins, seat counts, routing, and data freshness.
- The user reiterated the globe is optional and trusts design judgment. The supplied Orbit screenshot is a visual reference: dark, quiet, precise, spatial, restrained accents. Its globe is optional inspiration, not a mandatory feature or a layout to copy.
- Choose the best design independently. Any globe/map/animation must improve route selection or understanding; it must not delay searching, displace useful results, imply unverified availability, or harm mobile usability.
- Continue the design overhaul and existing implementation/verification work together.
- Preserve these decisions across task continuations. Update this brief when the user changes direction.

Implementation direction: a dark award-search workspace with compact search controls, an optional interactive route explorer before searching, a practical cabin-comparison table after searching, clear provider coverage, and a private points wallet. Search remains fully usable without the map.

Current globe behavior: slow automatic rotation; white glowing route trails animate continuously, including during dragging. No controls below the globe and no hover/focus pause. Grabbing pauses rotation; release adds velocity-based inertia that decays smoothly into automatic rotation. Respect reduced-motion preferences. Prevent drag text selection and pointer focus rectangles while retaining keyboard access.

Current access constraint: no new paid data subscriptions or commercial license; the existing personal Seats.aero Pro account is authorized for research. Investigate and implement direct, subscription-free airline search integrations. Broad live coverage remains unfinished until verified. No end-user airline login is needed to search PointSnap.

Autonomy: user is stepping away; do not ask further questions. Take the full product as far as possible, including useful features such as cash-versus-points value, saved searches and nearby-date navigation. Preserve facts about coverage and source restrictions.

Coordination: user asked about parallel airline subagents, then expressly left the working method to our judgment. Earlier independent airline investigations are finished; current implementation is direct. Follow the current delegation instructions and report actual activity rather than implying agents are running.

Critical completeness requirement: live search must retrieve every flight option the airline offers for the selected route/date/travelers, including connections and available cabins, subject only to explicit user filters. A lowest daily fare, limited sample, cached summary, first page or handful of departures does NOT complete an airline integration. JetBlue now supplies full itineraries and all eligible source fare choices; Virgin remains calendar-only. Track completeness separately from simple endpoint reachability. Verify pagination, all returned itineraries, cabins, fare families and source limitations before claiming an airline complete. Calendar summaries must be separate from flight lists and cannot count as full flight coverage.

Live follow-along: user asked to see ongoing work in the browser. `/build-progress` is a local development dashboard backed by `work/live-progress.json`; update it at each meaningful finding or status change using `node scripts/report-progress.mjs work/progress-update.json`. Do not invent activity or repeat unchanged checks as progress. Keep current scope, evidence and blockers per airline. The feed polls every3seconds; state updates are actual recorded findings, not automated proof of airline availability. User can keep this page open alongside search.

## September 5 update — comprehensive filtering without losing the live-search priority

The user wants every useful Seats.aero sorting/filtering capability and additional depth, organized intuitively. Audit the actual authorized Pro interface and its current public frontend before implementing parity. Keep completing live airline connections as the main mission; this extends the existing objective and does not replace it.

Use a concise everyday filter bar and clearly organized advanced controls. Candidate dimensions to verify against the competitor and available data: program and operating/marketing airline, alliance, cabin and mixed cabins, passengers/seats, points and total party points, taxes/currencies, matching cash price and cents per point, nonstop/stops, journey and layover duration, departure/arrival windows, connection airports, aircraft, freshness and source coverage, transfer currency eligibility, refundable fare families and inclusive sorting. Do not invent transfer ratios, cash comparisons, seating products, availability or unsupported filter semantics. Preserve every eligible flight and fare through sorting/filtering; show active filters and make resetting them easy. Saved searches should eventually include filter preferences. Missing source fields need an explicit inclusion policy rather than silently excluding flights.

### Flight-first comparisons (September 4 user direction)
- Show one physical itinerary once; compare all ticketing programs and fare choices within it, with points, cash fees, cabin, conditions, freshness, and booking handoff retained per offer.
- Consolidate only when every segment, operating-flight identity, airports, and departure/arrival time can be matched confidently. Never merge calendar quotes or similar-looking connections. Keep ambiguous codeshares separate rather than fabricate equivalence.
- Build the UX proactively: concise flight overview, program comparison and full fare detail on demand, deep offer-aware filtering, useful sorting, clear active filters and reset, and honest handling of unknown values. Apply all offer filters to the same offer so a cheap economy fare cannot qualify an expensive business fare.
- Main priority remains reproducible anonymous live award access and complete airline flight coverage. User wants implementation and autonomous design decisions, not questions or an ideas-only deliverable.

### Flexible dates and connection-exit exploration (September 4 user direction)
- A real ±N-day search must run each selected day, stream results, retain day/program coverage, and provide date prices and all-date comparison. Do not relabel the existing adjacent-date shortcuts as multi-day search. Bound concurrency and offer cancellation.
- Add an opt-in connection-exit / hidden-city research view, separate from ordinary valid itineraries. Compare full-ticket award costs against same-program/same-cabin normal trips. Clearly label the actual ticket destination, intended exit and unused legs, potential bag routing, canceled onward travel, rerouting, entry-document and program-rule risks. Do not present speculative routings or assumed savings as bookable prices.
- User asks us to originate and implement useful UX ideas while continuing all-airline connection work. No further clarification requested.

- Latest user screenshot: Aeromexico MXN fees should automatically display estimated USD to a US visitor. Detect country, offer manual currency override, retain original fees and rate observation date, and sort/filter in the selected display currency.

### September 5 — latest interaction requirements

- Default to AM/PM, with a remembered 12/24-hour preference applied consistently to flight details and time filters.
- Add a compact results view with a remembered preference; keep all program/fare options accessible.
- Support city selections (e.g. New York) that search all explicitly listed member airports. Never conflate a city token with an airline-supported physical airport code.
- Replace plain calendar fields with polished, accessible date selection and independent flexibility controls beneath the departure and return calendars, removing the separate flexibility column.
- The business-filter/date-tile mismatch is a required regression: the same filtered offers must drive both, including multi-cabin and partial-source states.
- Hidden-city concrete example: September 6 LAX–JFK includes a nonstop LAX–AUS first segment, but ordinary LAX–AUS results do not show it. Surface such full-ticket observations in the explicit connection-exit view, preserving onward destination, all unused legs, full price and search limitations; do not imply the first leg is independently bookable.
- Audit the entire product for polished Google/Apple-level interaction. The user's Apple HIG skill is optional guidance; actual browser checks are mandatory after UI changes.
- The reconciled message-by-message receipt is in tasks/user-requirements.md. Pending items remain pending even when logged.
- Latest priority correction: airline connections come before every other feature. Record new UI/UX ideas and implement them when possible; do not let them interrupt the live-data mission. Continue until the connections work, and preserve explicit unresolved access limitations rather than claiming success.
