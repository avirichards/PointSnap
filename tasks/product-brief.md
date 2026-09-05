# PointSnap — user direction

This brief records the user's current requirements and takes precedence over assumptions in earlier plans.

- Finish PointSnap to the best of our ability, including its central live award-search capability.
- The biggest previous failure was pulling live results across airlines. UI work must continue alongside data and reliability work; a polished shell does not complete the task.
- Users should sign into PointSnap and search across programs without ever connecting their own airline accounts. Provider access belongs to PointSnap's backend.
- The user has no current data-service subscription. Do not fabricate access, availability, schedules, prices, or claims of universal coverage.
- Reconsider the app from a clean slate. Existing UI or code should influence choices only when it is useful.
- Audience: airline and points enthusiasts. Prioritize useful comparisons of points, cash fees, cabins, seat counts, routing, and data freshness.
- The user reiterated the globe is optional and trusts design judgment. The supplied Orbit screenshot is a visual reference: dark, quiet, precise, spatial, restrained accents. Its globe is optional inspiration, not a mandatory feature or a layout to copy.
- Choose the best design independently. Any globe/map/animation must improve route selection or understanding; it must not delay searching, displace useful results, imply unverified availability, or harm mobile usability.
- Continue the design overhaul and existing implementation/verification work together.
- Preserve these decisions across task continuations. Update this brief when the user changes direction.

Implementation direction: a dark award-search workspace with compact search controls, an optional interactive route explorer before searching, a practical cabin-comparison table after searching, clear provider coverage, and a private points wallet. Search remains fully usable without the map.

Current globe behavior: slow automatic rotation; white glowing route trails animate continuously, including during dragging. No controls below the globe and no hover/focus pause. Grabbing pauses rotation; release adds velocity-based inertia that decays smoothly into automatic rotation. Respect reduced-motion preferences. Prevent drag text selection and pointer focus rectangles while retaining keyboard access.

Current access constraint: no paid data subscriptions or commercial license. Investigate and implement direct, subscription-free airline search integrations. Broad live coverage remains unfinished until verified. No end-user airline login is needed to search PointSnap.

Autonomy: user is stepping away; do not ask further questions. Take the full product as far as possible, including useful features such as cash-versus-points value, saved searches and nearby-date navigation. Preserve facts about coverage and source restrictions.

Coordination: user asked about parallel airline subagents, then expressly left the working method to our judgment. Three independent airline investigations now run in parallel; root owns shared application integration, UI and verification. Use delegation only where it helps.

Critical completeness requirement (latest user instruction): live search must retrieve every flight option the airline offers for the selected route/date/travelers, including connections and available cabins, subject only to explicit user filters. A lowest daily fare, limited sample, cached summary, first page or handful of departures does NOT complete an airline integration. JetBlue's current calendar-only feed explicitly fails this acceptance requirement. Track completeness separately from simple endpoint reachability. Verify pagination, all returned itineraries, cabins, fare families and source limitations before claiming an airline complete. Calendar summaries must be separate from flight lists and cannot count as full flight coverage.
