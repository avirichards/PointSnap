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

- Server-side persistent batching remains a later stabilization item. The browser queue now resumes HTTP 429 responses automatically while respecting the shared request limit; physical city expansion and independent return windows are implemented.
- Hidden-city exploration with real full-ticket pricing, a clear distinction from ordinary itineraries, and the actual unused-segment and baggage implications.
- Additional transfer and redemption comparisons when the relevant program data is available.

## Acceptance

Every implemented feature needs an actual browser check on desktop and mobile, including the main interaction, keyboard behavior, overflow and relevant failure states. Use meaningful tests for date, filtering, grouping or price calculations. Keep screenshots and notes of verified behavior. API changes require coordination with the airline task; no product redesign should weaken the accuracy or completeness of its data.

## September 6 — approved design and execution

The user explored eight design directions and explicitly selected Option D again: refined airport-ticket styling, warm ivory/chalk/evergreen, precise readable type and a subtle ticket detail panel. Execute the agreed full product plan. One adaptive experience, desktop side panel/mobile detail sheet, equal desktop/phone priority, optional points personalization after searching.

Delivery sequence: (1) design system and complete search-to-booking flow; (2) verified points guidance, private trips/shortlist comparisons, saved presets and availability-based Explore; (3) separately labeled hidden-city research and alerts only with working scheduled-search/notification services. Preserve all earlier requirements.

New search contracts must preserve single-airport URLs and every source fare. Transfer seed data requires a source/eligibility/ratio/minimum/increment audit before use. Personalization begins with temporary guest inputs; persistence is explicit and account-scoped. No point transfers or purchases are executed.

The approved first product pass is implemented and has been exercised in the browser on desktop and phone. Implementation, evidence, remaining data-dependent features and hosted database integration steps are tracked in `docs/product-ui-handoff.md`. Keep the airline work and all original requirements open independently. No hosted migration or canonical runtime update is claimed until verified.

## September 6 — appearance and calendar feedback

- User wants the light globe to fit the warm light palette, and dark mode to be more readable, less green, and feel like the same product. Implemented separate globe palettes, neutral charcoal surfaces, ivory text, cream primary actions and restrained sage accents. Airport labels now avoid overlapping while rotating.
- User wants flexibility inside the bottom of both calendars. Latest refinement supersedes the full 1–14 dropdown: show **Exact date, ±1, ±3, ±7 and ±14** tags. Implemented independent departure/return settings, a Done action, persistent closed-calendar summaries, and a centered phone dialog with the whole calendar visible at 390×844. Existing saved custom ranges remain usable.
- Search parsing and date expansion support ±14 (up to 29 dates). HTTP 429 now pauses and resumes remaining browser checks with a shared cooldown; Stop search cancels it. No server limit increase or collector changes.
- The two chats work independently; the user clarified that necessary cross-chat context/handoff messages are fine. Avoid routine cross-chat progress chatter.
- Verification and evidence: `docs/appearance-calendar-refinement.md`. Airline connection and hosted account-storage tasks remain with their existing owner.

## September 6 — results-page simplification

- User requested removal of the results route map unless it provided real decision-making value. Removed its toggle, duplicate globe panel, state and unused styles. It showed a representative route rather than the returned itineraries. The original homepage globe remains.
- User requested moving the separate display-preferences menu above the filters to the bottom of the filter menu. Currency, time format and layout now live in an expandable Display preferences section at the bottom of All filters, after presets. No extra preferences button remains above the toolbar.
- Display settings still update results immediately and persist on the device. They do not contribute to active-filter counts or reset with Reset all. Browser checks passed on desktop and phone, including currency conversion, 12/24-hour rendering, density changes, persistence and keyboard disclosure. Filter-sheet heading and actions remain fixed while its body scrolls.
- TypeScript, changed-file ESLint and diff checks passed. Screenshot and reproducible isolated-browser evidence: `docs/evidence/results-cleanup-2026-09-06/`. Search requests were intercepted; no live collectors or canonical runtimes were touched.

## September 6 — compact results header

- User reports that the top section takes too much room while reviewing flights. Replaced the always-expanded results form and duplicated route heading with one compact trip summary: cities, actual airport codes, dates including year, both flexibility ranges, adults and minimum cabin. Edit search expands the complete existing form; Cancel or Escape discards unsubmitted edits. The homepage keeps its full form and globe.
- Save and Refresh sit alongside Edit search. Saved-search history remains inside the editor. The slash shortcut opens the editor. Round-trip direction controls, city-airport details, source coverage, progress, errors, Stop and Retry remain accessible. Tightened the nearby-date strip. The labeled design preview shares the same header.
- Browser verification caught and fixed a duplicate React sibling key that could leave an old summary behind during date navigation. The final run has no JavaScript exceptions or React console warnings/errors.
- In the same 1440×1000 viewport with intercepted completed search responses, results heading moved from y=571.6 to y=289.7, filters from y=651.6 to y=364.3, and table from y=763.6 to y=476.3 (about 287 pixels recovered for filters/table). Verified edit focus, cancellation, nested Escape, saved searches, nearby dates, independent outbound/return windows, party/cabin submission, round-trip direction, and failure/retry. Phone checks at 390×844 passed for overflow, full calendar visibility and cancellation. Visually reviewed desktop and phone screenshots with labeled example fares.
- TypeScript, changed-file ESLint and diff checks passed. Evidence and reproducible QA: `docs/evidence/compact-header-2026-09-06/`. All search requests were intercepted; canonical runtimes and collectors were not touched.
