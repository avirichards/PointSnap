# PointSnap completion work

Starting point: `2f26dd6` (latest assessment branch). Delivery branch: `codex/finish-pointsnap`, PR base `main`. Existing Vercel/Next.js and Supabase architecture retained.

- [x] Replace auth shells; verify identity; isolate wallet, staff pages and worker sessions.
- [x] Make airport search usable without service credentials; validate requests and implement stream cancellation/retry, URL-driven searches and separate return-leg searches.
- [x] Build and verify one direct flight source and two daily calendar sources; implement documented Seats.aero and AwardTool contracts with explicit per-program failure states and booking handoffs. No estimate rows.
- [x] Implement manually maintained private wallet balances, expiry dates, card nicknames and per-party points/cash comparison.
- [x] Replace legacy airline-login onboarding with app-owned program coverage; provide removal of previously saved sessions; keep legacy operator view read-only.
- [x] Rebuild the interface for points enthusiasts, following the user's dark visual reference without copying the old UI. Add optional geographic exploration, slow automatic rotation, white route trails, drag-only rotation pause, release inertia, keyboard rotation and reduced-motion support. Fix drag text selection and mouse focus outline.
- [x] Record user preferences in `tasks/product-brief.md` and draft knowledge-base copy for review.
- [x] Verify 67 frontend/contract tests, 30 hermetic Python tests, wallet migration/RLS, live HTTP searches, typecheck, lint and optimized production build. Python also reports 1 optional transport skip and 1 intentionally excluded live test. Existing seed scripts have lint warnings.
- [x] Commit the initial rebuild, push feature branch and open draft PR #4. CI/preview verification continues.
- [ ] Expand direct airline coverage without paid subscriptions, per the latest user instruction.

## External work still required

- [ ] Verify broader direct airline coverage without paid subscriptions. The user declined the commercial-data path; optional commercial adapters remain inactive. Universal live coverage is not complete.
- [ ] Configure hosted Supabase auth/email/redirects and apply the additive wallet migration to a preview database; verify on that database. Local PostgreSQL/RLS tests pass.
- [ ] Configure production Redis for paid search quota and verify airline reachability and function limits from the hosting network.
- [ ] Review the feature branch, then explicitly authorize production release. Main and production data are unchanged.

## Deliberate limits

The new flow does not use unverifiable transfer ratios or award-chart estimates. Bank-point transfers/bonuses, automatic balance sync, credit-card ingestion and legacy operator mutation tools are not implemented. JetBlue and Virgin supply calendar prices, not flight schedules. No user needs to connect a personal airline account for searching.

## Complete flight-list acceptance requirement

- [ ] JetBlue: retrieve and verify every matching flight option; calendar-only feed is incomplete.
- [ ] Virgin Atlantic: retrieve full dated itineraries; reward calendar is incomplete for this requirement.
- [ ] Alaska: all returned itineraries retained, but verify pagination/fare options and completeness against the airline before claiming exhaustive coverage.
- [ ] Remaining airlines: verify full flight lists, connections, cabins and pagination; failed/blocked endpoints and static calendars are not completed integrations.
- [x] Separate calendar summaries from flight results in the interface and coverage descriptions.

- [x] Preserve all 35 Alaska itineraries and 68 fares in a fresh source fixture, fix lost mixed-cabin fares, and expose every supplied fare family. Official Show more is local slicing for this audited query.
- [x] Match actual cash flights, calculate cents per point, add saved searches and nearby dates, fix one-way navigation after viewing a return leg, and keep globe keyboard focus stable during rotation.
