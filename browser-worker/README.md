# PointSnap airline browser service

PointSnap sends a route, date and passenger count to a separate authenticated browser service. Each request creates a fresh anonymous browser context and uses the airline's ordinary booking form. No traveler login, personal browser profile, copied cookies or data subscription is used.

**Delta has verified local live responses.** LAX–JFK October 5: all 46 itineraries on 3 pages, 167 bookable fares for one adult and 166 for two. JFK–LHR:17 itineraries/41 fares, including offered Air France and KLM awards priced in SkyMiles. Delta's public brand catalog supplies partner cabin definitions. These observations establish the tested scope, not every route, runtime or future search.

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
POINTSNAP_BROWSER_AMERICAN="0"
POINTSNAP_BROWSER_WORKER_URL="http://127.0.0.1:3002"
POINTSNAP_BROWSER_WORKER_TOKEN="the-same-random-secret"
```

Never expose the token through `NEXT_PUBLIC_*`. Outside loopback, the worker URL must use HTTPS and the service should be private. Setting these variables alone does not install the runtime or establish hosted connectivity. Delta always uses WebKit in the current implementation.

## Live verification

These commands perform new airline searches. They do not use recorded fixtures:

```sh
POINTSNAP_TEST_PROGRAM=DL_SKYMILES pnpm test:browser-live LAX JFK 2026-10-05 2
pnpm exec tsx browser-worker/probe-delta.ts 2026-10-05 JFK LHR 1
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

## Remaining diagnostics

`POINTSNAP_BROWSER_AMERICAN=1` enables the separate American pilot. Its engine can be `chromium`, `webkit` or `firefox`; `POINTSNAP_BROWSER_CHANNEL=chrome` selects installed standard Chrome for Chromium. `POINTSNAP_BROWSER_HEADLESS=0` opens its own temporary browser visibly. Entry modes are `homepage`, `direct` and `homepage-form`. These choices are explicit experiments, not an automatic retry loop after denial.

`probe-southwest.ts` tests the official points booker. Its recorded WebKit/Firefox attempts returned shopping HTTP 403; no Southwest source is enabled.

## Hosted runtime evidence

The same Delta runner succeeds on a fresh GitHub macOS 15 / arm64 WebKit runtime: LAX–JFK October 6, one adult, all 49 itineraries / 173 fares / 9 nonstops in 24.0 seconds. The standard hosted Linux WebKit test reaches verification. These diagnostics use fresh anonymous contexts and are manual-only. They do not deploy a permanent browser service or establish load reliability.

American still fails in the hosted Mac runtime: Chrome receives homepage Access Denied; WebKit submits the form and reaches Challenge Validation. Keep `POINTSNAP_BROWSER_AMERICAN=0`. See the per-airline evidence under `docs/evidence/`.
