# PointSnap product and UI work

The user assigned this task to features and UI on September 6, 2026, while the original task continues airline connections. This plan carries forward the full product requirements in `tasks/user-requirements.md`; it does not replace that backlog.

## Ownership and integration

- UI task: `codex/pointsnap-product-ui`, separate `work/PointSnap-ui` checkout, starting from `964708f`. Use a separate preview and build output. Do not restart the canonical app or airline worker.
- Airline task: canonical `work/PointSnap`, port 3000, airline collectors, credentials, verification, browser profiles and worker runtime. The original task acknowledged ownership of the paused worker and foreground-focus fix.
- Coordinate shared search types, API requests/responses, city expansion and pricing semantics before changing them. Keep UI commits focused so reviewed changes can be integrated without replacing newer airline work.
- Browser checks must not take focus from the user. Use background inspection and a separate preview. Never present test fixtures as current live availability.

## First product pass

1. Improve search dates: clear calendar popovers, readable selected dates, accessible month navigation, sensible departure/return behavior and date flexibility beneath the date controls. Preserve the current query contract while coordinating any independent return-flexibility extension.
2. Improve airport and city selection: show city names and airports clearly. City-wide search must expand actual airports through an agreed backend contract; a visual city label alone is not implementation.
3. Improve results: compact layout as the standard, one physical itinerary with clear program/fare comparison, explicit per-person versus party totals, original and converted fees, and useful value-per-point comparisons only when the cash match is valid.
4. Improve filtering and dates together: common controls immediately accessible, advanced controls organized by purpose, visible active filters, understandable empty/error/loading states, and date minima computed from the same eligible fares shown in results.
5. Audit the whole product: keyboard and mobile interactions, saved searches, preferences, navigation, accessible focus, wallet usefulness, and consistency across screens. Preserve AM/PM defaults and the globe's rotation, continuously animated routes and inertia.

## Later features requiring data coordination

- City-wide and independent outbound/return date windows.
- Hidden-city exploration with real full-ticket pricing, a clear distinction from ordinary itineraries, and the actual unused-segment and baggage implications.
- Additional transfer and redemption comparisons when the relevant program data is available.

## Acceptance

Every implemented feature needs an actual browser check on desktop and mobile, including the main interaction, keyboard behavior, overflow and relevant failure states. Use meaningful tests for date, filtering, grouping or price calculations. Keep screenshots and notes of verified behavior. API changes require coordination with the airline task; no product redesign should weaken the accuracy or completeness of its data.
