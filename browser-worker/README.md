# PointSnap airline browser service

PointSnap sends a route, date and passenger count to a separate authenticated browser service. Each request creates a fresh anonymous browser context and uses the airline's ordinary booking form. No traveler login, personal browser profile, copied cookies or data subscription is used.

**Delta has verified local live responses.** LAX–JFK October 5: all 46 itineraries on 3 pages, 167 bookable fares for one adult and 166 for two. JFK–LHR:17 itineraries/41 fares, including offered Air France and KLM awards priced in SkyMiles. Delta's public brand catalog supplies partner cabin definitions. These observations establish the tested scope, not every route, runtime or future search.

**Smiles has verified local native and partner responses.** GRU–GIG October 5, two adults: five flights / 42 regular award, cash-plus-miles and baggage choices. GRU–CDG: 40 itineraries / 280 choices. The actual app preserves every option and original BRL travel fees, with display conversion. Club/elite discounts are excluded. HTTP 452/code 113 means the airline withdrew a listed offer after its seat recheck; the app reports that count and retains verified offers. Other failures remain explicit. Hosted verification is separate from local success.

**American remains experimental.** Its ordinary browser shows native awards, but the dedicated worker's recorded local and hosted attempts reach denial or verification before inventory. Keep American disabled unless that runtime is separately verified. [Detailed evidence](../docs/airline-access-status.md).

## Setup

Use Node 22 and the pinned pnpm/Playwright versions. Install the browser separately from Next.js:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install webkit
```

On a supported Linux host, use `pnpm exec playwright install --with-deps webkit` to install system dependencies too.

Create an ignored `.env.browser.local` containing a newly generated random token of at least 32 characters:

```dotenv
POINTSNAP_BROWSER_WORKER_TOKEN="your-random-secret-at-least-32-characters"
POINTSNAP_BROWSER_DELTA="1"
POINTSNAP_BROWSER_SMILES="1"
POINTSNAP_BROWSER_HOST="127.0.0.1"
POINTSNAP_BROWSER_PORT="3002"
POINTSNAP_BROWSER_EVIDENCE_DIR="work/browser-worker/evidence"
```

Run the worker:

```sh
node --env-file=.env.browser.local --import tsx browser-worker/start.ts
```

Configure Next.js in `.env.local` and restart it:

```dotenv
POINTSNAP_BROWSER_DELTA="1"
POINTSNAP_BROWSER_SMILES="1"
POINTSNAP_BROWSER_AMERICAN="0"
POINTSNAP_BROWSER_WORKER_URL="http://127.0.0.1:3002"
POINTSNAP_BROWSER_WORKER_TOKEN="the-same-random-secret"
```

Never expose the token through `NEXT_PUBLIC_*`. Outside loopback, the worker URL must use HTTPS and the service should be private. Setting these variables alone does not install the runtime or establish hosted connectivity. Delta and Smiles use WebKit. Smiles quotes each itinerary sequentially; the 40-flight partner search takes about two minutes. The app host must permit the search route's 210-second maximum. The worker cancels Smiles after 180 seconds; other runners retain their 95-second budget.

## Live verification

These commands perform new airline searches. They do not use recorded fixtures:

```sh
POINTSNAP_TEST_PROGRAM=DL_SKYMILES pnpm test:browser-live LAX JFK 2026-10-05 2
pnpm exec tsx browser-worker/probe-delta.ts 2026-10-05 JFK LHR 1
POINTSNAP_TEST_PROGRAM=G3_GOL_SMILES pnpm test:browser-live GRU GIG 2026-10-05 2
pnpm exec tsx browser-worker/probe-smiles.ts 2026-10-05 GRU CDG 1
```

The first exercises PointSnap's streaming API. A completed stream with a failed airline source still exits unsuccessfully. The second exercises the same Delta runner directly and writes counts, stages and an example fare to `work/browser-probes/`. The manual Delta GitHub workflow tests a fresh hosted Linux runtime; inspect the diagnostic result before claiming deployment success.

`POINTSNAP_SAVE_PUBLIC_FIXTURE=1` is an optional local diagnostic setting that also saves the sanitized guest flight payload for parser investigation. This is off in the application and hosted workflow. It excludes session/selection IDs and never substitutes its saved output for a new search.

## Correctness and lifecycle

- The worker accepts only supported airline route/date/party queries, never arbitrary URLs or browser commands. Authentication, request-size limits, a bounded queue and a shared two-search concurrency limit apply.
- Each request's context closes on success, failure, cancellation or deadline. Login or verification interrupts a search and remains a source error.
- Delta requests miles, all available cabins, Basic fares included, no nonstop restriction and no nearby-airport expansion. The app applies the user's filters to the complete response afterward.
- Every reported results page is required. Page numbers, total itineraries, duplicate flights, route, date and passenger count are validated. A temporarily hidden pagination button never counts as a finished search.
- Exact formatted taxes are preserved; rounded UI taxes are not substituted. Local airport clocks remain local. Delta's arrival-day marker is not added to elapsed trip duration.
- Available primary and secondary fare families, segment cabins, mixed cabins and operating flight numbers are retained. Unknown cabin definitions, promotional eligibility or malformed available fares fail explicitly instead of disappearing.
- The app independently revalidates the returned query, observation time, program, complete payload and counts. Fixtures are used only for regression tests.
- Smiles requires the rendered end marker, all source itineraries, all regular cash/miles offers, offered baggage checks and either a matching tax quote or the airline’s explicit no-seat response for every flight. Fees are per traveler even when the source tax response is a party total. Cash-only prices from a different fare family are not used for redemption value. Zero-result semantics have not yet been validated and therefore fail explicitly.

## Remaining diagnostics

`POINTSNAP_BROWSER_AMERICAN=1` enables the separate American pilot. Its engine can be `chromium`, `webkit` or `firefox`; `POINTSNAP_BROWSER_CHANNEL=chrome` selects installed standard Chrome for Chromium. `POINTSNAP_BROWSER_HEADLESS=0` opens its own temporary browser visibly. Entry modes are `homepage`, `direct` and `homepage-form`. These choices are explicit experiments, not an automatic retry loop after denial.

`probe-southwest.ts` tests the official points booker. Its recorded WebKit/Firefox attempts returned shopping HTTP 403; no Southwest source is enabled.

`POINTSNAP_BROWSER_TEMPORARY_PROFILE=1 pnpm exec tsx browser-worker/probe.ts webkit` tests an empty regular profile instead of a nonpersistent context. It creates and removes its own directory under `work/browser-profiles/`; it never accepts a personal-profile path. Local WebKit still reaches verification after form submission; standard Chrome still receives homepage 403. This diagnostic does not enable American in the app.

## Hosted runtime evidence

The same Delta runner succeeds on a fresh GitHub macOS 15 / arm64 WebKit runtime: LAX–JFK October 6, one adult, all 49 itineraries / 173 fares / 9 nonstops in 24.0 seconds. The standard hosted Linux WebKit test reaches verification. These diagnostics use fresh anonymous contexts and are manual-only. They do not deploy a permanent browser service or establish load reliability.

American still fails in the hosted Mac runtime: Chrome receives homepage Access Denied; WebKit submits the form and reaches Challenge Validation. Keep `POINTSNAP_BROWSER_AMERICAN=0`. See the per-airline evidence under `docs/evidence/`.


Smiles may include nearby airports despite an exact-airport search. The worker validates every candidate and quote, then returns only the requested route; the app discloses other-airport exclusions and seat withdrawals. Diagnostics with `POINTSNAP_SAVE_PUBLIC_FIXTURE=1` save sanitized rejected observations separately as `*-rejected-flights.json`. These are diagnostic evidence only and never live fallback data. Airport entry can fall back to a city name but always selects the exact IATA airport.

Smiles diagnostics can explicitly select a standard engine with `POINTSNAP_SMILES_ENGINE=webkit|chromium|firefox`. The application continues to use WebKit. Reports include the engine in their filenames; failure diagnostics retain only public paths, response status, visible text and form labels, never input values, session cookies or request headers. The manual hosted workflow exposes the same engine choice. An experiment failure does not automatically trigger other engines.
