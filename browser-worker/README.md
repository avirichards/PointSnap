# American background-browser pilot

This is an experimental transport, disabled by default. PointSnap's server sends a route/date/party request to a separate browser process. That process uses American's ordinary public booking form and validates the complete native response. No traveler airline login is required by this implementation.

**A working parser and service are not a working airline connection.** Local Chromium and Chrome attempts receive booking-page denial. WebKit and Firefox successfully submit the form but reach verification before flight data. See [the evidence report](../docs/airline-access-status.md) for the current measured result; do not enable this as a production source until the intended runtime returns complete live responses reliably.

## Local setup

Use Node 22 and the repository's pinned pnpm/Playwright versions. Browser binaries are installed separately; they are not shipped with the Next.js application.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install --no-shell chromium
```

Create an ignored `.env.browser.local` file with a newly generated random token of at least 32 characters. Set the same token in the Next server's `.env.local`. Never expose it through `NEXT_PUBLIC_*` or the browser client.

Worker settings:

```dotenv
POINTSNAP_BROWSER_WORKER_TOKEN="your-random-secret-at-least-32-characters"
POINTSNAP_BROWSER_HOST="127.0.0.1"
POINTSNAP_BROWSER_PORT="3002"
POINTSNAP_BROWSER_ENGINE="chromium"
POINTSNAP_BROWSER_CHANNEL="chromium"
POINTSNAP_BROWSER_HEADLESS="1"
POINTSNAP_BROWSER_ENTRY="homepage"
POINTSNAP_BROWSER_EVIDENCE_DIR="work/browser-worker/evidence"
```

```sh
node --env-file=.env.browser.local --import tsx browser-worker/start.ts
```

For an isolated PointSnap pilot, explicitly configure its server:

```dotenv
POINTSNAP_BROWSER_AMERICAN="1"
POINTSNAP_BROWSER_WORKER_URL="http://127.0.0.1:3002"
POINTSNAP_BROWSER_WORKER_TOKEN="the-same-random-secret"
```

Restart the Next server after changing these settings. An optional `POINTSNAP_NEXT_DIST_DIR=work/browser-pilot-next` keeps a second local instance's build files separate. Outside loopback, the worker URL must use HTTPS and the service must run behind an authenticated private deployment. This repository does not provision or claim a verified hosted browser deployment.

## Reproduce the live check

```sh
POINTSNAP_TEST_URL=http://localhost:3000 pnpm test:browser-live LAX AUS 2026-10-05 1
```

This exercises PointSnap's real streaming API and exits unsuccessfully for a source failure even when the HTTP stream itself completed. It prints only the query, coverage, counts and elapsed time. It does not use recorded flight fixtures.

The separate `browser-worker/probe.ts` diagnostic exercises the same browser driver directly. The optional GitHub workflow runs it on hosted Linux across Chromium, WebKit and Firefox. Each engine runs once in sequence; source failure is stored in its evidence JSON and is not a claim of connectivity merely because the diagnostic job uploaded its artifact.

```sh
pnpm exec playwright install webkit firefox
pnpm exec tsx browser-worker/probe.ts webkit 2026-10-05
```

`POINTSNAP_BROWSER_ENGINE` accepts `chromium`, `webkit` or `firefox`. `POINTSNAP_BROWSER_CHANNEL=chrome` uses an already installed standard Chrome only with the Chromium engine. `POINTSNAP_BROWSER_HEADLESS=0` opens the worker's own temporary browser visibly. `POINTSNAP_BROWSER_ENTRY=direct` tests the direct advanced-booking entry instead of the normal homepage link. These are explicit diagnostic choices, not an automatic retry loop after denial.

## Request and correctness boundaries

- The authenticated worker accepts only American airport/date/party queries, never arbitrary URLs or browser commands. It binds to loopback by default, limits request size and runs at most two searches with a bounded queue.
- Each request creates and closes its own anonymous context. No personal browser profile, login cookies, challenge tokens, passwords or payment information are imported. Verification stops the search.
- Cancellation, queue expiry and client disconnect close the request's context. Searches time out before PointSnap's outer streaming deadline.
- Origin/destination autocomplete selections are checked and nearby-airport expansion is disabled. All cabins and airlines are requested; the shared engine applies the user's cabin filter afterward.
- The native parser checks the requested route, date, party totals, live metadata, every itinerary/segment/fare, pagination flags and counts. The PointSnap bridge independently revalidates the returned payload, timestamp, query and counts.
- Flight fixtures exist only in tests. Browser failure, login/verification, empty availability and complete results remain distinct. Sanitized diagnostics omit page HTML, cookies and session-bearing URLs.

Before promoting this pilot, reconcile all native fares against the airline across multiple routes and party sizes, repeat after browser restart/idle periods, and prove the actual deployment runtime. This pilot currently falls short of those acceptance criteria.
