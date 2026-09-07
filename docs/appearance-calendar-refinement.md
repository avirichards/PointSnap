# Appearance and flexible-calendar refinement — September 6, 2026

## User feedback implemented

Dark mode now uses warm charcoal surfaces, ivory text and cream primary actions. Sage is a small brand/cabin accent instead of tinting every surface. Light and dark modes keep the same visual hierarchy. The light globe has lighter teal oceans, sage land, softer shading and off-white labels; dark mode has its own globe colors. Airport labels avoid overlapping, with thin lines back to their markers. Auto-rotation, drag-only rotation pause, moving white routes, inertia and reduced-motion support remain in place.

Each calendar contains five date-flexibility tags at its bottom: **Exact date, ±1, ±3, ±7 and ±14**. This replaces the earlier full dropdown. A legacy saved search with another supported range keeps its current value visible rather than silently changing the search. Departure and return settings change independently; older links that inherited outbound flexibility retain that meaning when first opened. Picking a day keeps the calendar open so the traveler can choose flexibility, then Done closes it. The selected range remains beneath the closed date field.

On phones, the calendar is a centered, focus-trapped dialog. Entirely outside-month trailing weeks are omitted. The month, date grid, typed-date input, tags and Done all fit in the tested 390×844 viewport. Smaller/landscape viewports retain internal scrolling and accessible controls. Desktop keeps an anchored popover.

Both URL validation and date expansion now accept up to ±14, or 29 days before booking-window clipping. The existing two-worker client queue pauses on HTTP 429 and retries the same date after Retry-After, falling back to the server's current ten-minute window. Other queued dates share the wait. The UI explains the pause, retained results stay visible, and Stop search cancels the wait immediately. Server rate limits and airline workers were not modified. This is active-tab recovery, not a persistent background job; reopening a closed tab starts a new search.

## Verification

- 36 focused tests passed in five files: date/city expansion, query round trips and bounds, currency/date regressions, shared cooldown timing/extension/cancellation, engine behavior and API request protections.
- TypeScript passed. Changed TypeScript files and search components passed ESLint with zero warnings. `git diff --check` passed.
- Browser tests on the isolated UI runtime at port 3001 intercepted all search requests with labeled QA responses. No live collectors were called.
- Browser coverage: 29 distinct outbound dates at ±14, a rate-limited date retried exactly once, no new requests during the shared cooldown, 15 distinct return dates at ±7 with reversed physical airports, URL persistence, independent flexibility, and cancellation while waiting.
- Desktop/phone calendar tags, native arrow-key radio selection, Done focus restoration, optional-return removal, full phone calendar visibility, and flight-detail sheet focus restoration passed. No browser page errors.
- Globe checks: automatic rotation, rotation held still while grabbed, white trails continuing during the hold, release inertia, no selected text, and nonoverlapping visible airport labels.
- Measured dark-token contrast: primary text/card 13.77:1; secondary text/card 8.53:1; secondary text/popover 7.58:1; primary action label/fill 11.78:1. These are specific token checks, not a claim of a complete accessibility certification.

Screenshots and browser-check output are in `docs/evidence/appearance-calendar-2026-09-06/`. Flight examples in those screenshots are fixtures, not live availability. The archived `verify.mjs` is a dated QA run and targets only the isolated preview; its search interception must remain enabled.

## Integration boundary

Changes are on `codex/pointsnap-product-ui` in the UI checkout. The airline task was informed about the shared date-window and client-cooldown changes; it owns canonical integration, live source qualification and runtime restarts. The preview remains on port 3001. No account credentials, email codes, airline sessions, collector implementations, or server limit configuration were changed.
