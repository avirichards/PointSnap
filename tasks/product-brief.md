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

Latest animation request: the globe should rotate slowly on its own, with modern white glowing route trails and moving points from airport to airport. Pause on manual interaction, provide play/pause, and respect reduced-motion settings. This enhancement remains subordinate to fast searching and accurate data.
