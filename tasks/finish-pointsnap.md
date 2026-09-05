# PointSnap completion work

Starting point: `2f26dd6` (latest assessment branch). Delivery branch: `codex/finish-pointsnap`, PR base `main`. Existing Vercel/Next.js and Supabase architecture retained.

- [x] Replace auth shells; verify identity; isolate wallet, staff pages and worker sessions.
- [x] Make airport search usable without service credentials; validate requests and implement stream cancellation/retry, URL-driven searches and separate return-leg searches.
- [x] Build and verify five scoped direct flight sources and one daily calendar source; implement documented Seats.aero and AwardTool contracts with explicit per-program failure states and booking handoffs. No estimate rows.
- [x] Implement manually maintained private wallet balances, expiry dates, card nicknames and per-party points/cash comparison.
- [x] Replace legacy airline-login onboarding with app-owned program coverage; provide removal of previously saved sessions; keep legacy operator view read-only.
- [x] Rebuild the interface for points enthusiasts, following the user's dark visual reference without copying the old UI. Add optional geographic exploration, slow automatic rotation, white route trails, drag-only rotation pause, release inertia, keyboard rotation and reduced-motion support. Fix drag text selection and mouse focus outline.
- [x] Record user preferences in `tasks/product-brief.md` and draft knowledge-base copy for review.
- [x] Verify 101 frontend/contract tests, 30 hermetic Python tests, wallet migration/RLS, live HTTP searches, typecheck, lint and optimized production build. Python also reports 1 optional transport skip and 1 intentionally excluded live test. Existing seed scripts have lint warnings.
- [x] Commit the initial rebuild, push feature branch and open draft PR #4. CI/preview verification continues.
- [ ] Expand direct airline coverage without paid subscriptions, per the latest user instruction.

## External work still required

- [ ] Verify broader direct airline coverage without paid subscriptions. The user declined the commercial-data path; optional commercial adapters remain inactive. Universal live coverage is not complete.
- [ ] Configure hosted Supabase auth/email/redirects and apply the additive wallet migration to a preview database; verify on that database. Local PostgreSQL/RLS tests pass.
- [ ] Configure production Redis for paid search quota and verify airline reachability and function limits from the hosting network.
- [ ] Review the feature branch, then explicitly authorize production release. Main and production data are unchanged.

## Deliberate limits

The new flow does not use unverifiable transfer ratios or award-chart estimates. Bank-point transfers/bonuses, automatic balance sync, credit-card ingestion and legacy operator mutation tools are not implemented. Virgin still supplies calendar prices, not flight schedules. JetBlue now supplies individual itineraries and all eligible fare choices. No user needs to connect a personal airline account for searching.

## Complete flight-list acceptance requirement

- [x] JetBlue: replace calendar-only feed with full anonymous search; audit all 16 itineraries /119 fares, all four transatlantic itineraries /28 fares, mixed-cabin references and exact cash matching. Completeness applies to verified source responses.
- [ ] Virgin Atlantic: retrieve full dated itineraries; reward calendar is incomplete for this requirement.
- [x] Alaska: preserve and audit all 35 returned itineraries / 68 fare options; verified local Show more behavior. Universal backend completeness is not claimed.
- [ ] Remaining airlines: verify full flight lists, connections, cabins and pagination; failed/blocked endpoints and static calendars are not completed integrations.
- [x] Separate calendar summaries from flight results in the interface and coverage descriptions.

- [x] Preserve all 35 Alaska itineraries and 68 fares in a fresh source fixture, fix lost mixed-cabin fares, and expose every supplied fare family. Official Show more is local slicing for this audited query.
- [x] Match actual cash flights, calculate cents per point, add saved searches and nearby dates, fix one-way navigation after viewing a return leg, and keep globe keyboard focus stable during rotation.

- [x] Add real anonymous Skywards easyJet/Jet2 flight search with incremental polling, complete render batches, included taxes, exact party totals, and fresh booking handoffs. Verified LGW–AMS adults1/2 and MAN–ALC; this does not connect native Emirates Classic Rewards.

- [x] Add Frontier domestic anonymous awards: 25 itineraries / 175 fare alternatives verified through actual two-adult SSE search.
- [x] Add Aeromexico anonymous Classic/Dynamic awards: 11 itineraries / 98 fares verified through actual two-adult SSE search; 25 connecting itineraries / 237 fares independently verified.
- [x] Build development-only live work dashboard and clarify request blocks versus login-required or unverified flows.
- [x] Research authorized Seats.aero Pro UI and public frontend architecture; record limits of visible code and personal API access.

- [x] September5 06:00UTC: JetBlue full connector verified through actual /api/search for two adults (16 itineraries,119 fares,119 cash matches in2.6s). 101 tests, typecheck, lint and optimized production build pass. Current investigation continues with Virgin Atlantic and previously inaccessible browser paths.
