# Phase 4 — Date-Sweep Investigation Notes

**Status: investigation only. No sweep code written.** This documents
which of the 13 current plugins (if any) internally cap award searches
below their published booking window, and sketches the multi-call
date-sweep approach a future session would build for those that do.

Written 2026-05-20 alongside the Phase 4 per-program window registry
(`python-workers/common/program_windows.py`) and the `/programs/meta`
endpoint.

---

## Background — why a date sweep might be needed

Apify's competing actor (`igolaizola/airline-awards-actor`) caps every
query at **60 days out**. Per `tasks/scraper-research/agent-2-apify-igolaizola.md`,
that cap is **structural, not a config flag**:

> "The input schema has no min/max validation on `startDate` / `endDate`
> — meaning the cap is enforced **downstream**, inside the per-airline
> scrapers, not at input validation time. That tells us the cap is a
> property of the data sources he hits, not of his actor code."
>
> "The cap aligns with the unauthenticated public-API window of several
> carriers: Delta, AA, JetBlue, and Alaska all gate further-out award
> inventory behind logged-in sessions or only return partial data >60
> days out."

So the 60-day ceiling is the **lowest-common-denominator of the
*unauthenticated* per-airline public APIs** Apify hits. Two distinct
limits get conflated under "60-day cap":

1. **A response-size / page-window limit** — the endpoint only returns a
   bounded date range per call (e.g. one month, one week, a 60-day
   grid). The data past the window *exists*; you just need more calls.
   → **A date sweep fixes this.**
2. **An inventory-visibility limit** — the carrier genuinely hides
   award inventory beyond N days from *anonymous* callers, releasing it
   only to logged-in sessions. The data does **not** exist for an
   unauthenticated client at any number of calls.
   → **A date sweep does NOT fix this. Only T5' (authenticated cookie
   replay, Phase 2.5) does.** Per the rubric: *"T5' authenticated
   sessions are the primary mechanism for past-60-day queries."*

The Phase 4 window registry + `/programs/meta` + the calendar bound
solve the **UX half** — the cockpit now lets users *pick* a date up to
each carrier's real ~330-360-day window instead of being silently
capped. Whether a search at day 300 actually *returns rows* depends on
the plugin's transport, which is the subject of these notes.

---

## What is actually testable right now

Per `tasks/scraper-log.md` "Quick reference: working state"
(2026-05-19), only **2 of 13** plugins return real data:

| Plugin | Status | Can we test a date sweep? |
|---|---|---|
| VS_FLYING_CLUB | ✅ live (httpx) | **Yes** |
| AS_MILEAGEPLAN | ✅ live (httpx) | **Yes** |
| AA_AADVANTAGE | 🚧 stuck (Akamai wall) | No — transport not working |
| AC, DL, UA, BA, AF, LH, TK, NH, CX, AV | ❌ broken (BD migration untested) | No — transport not working |

**Conclusion:** the date-sweep question can only be empirically answered
for VS and AS today. The other 11 must be (re)assessed in Phase 1/2
*after* their transports are fixed — a broken scraper returning `[]`
tells you nothing about the underlying API's date window. A `# Phase 4
date-sweep audit` checkbox should be added to each plugin's Phase 1/2
validation so the question is answered the moment a transport goes live.

---

## Per-plugin findings (the 2 testable plugins)

### VS_FLYING_CLUB — no per-date cap; already month-windowed

VS's plugin (`python-workers/vs/search.py`) does **not** query a single
date. It POSTs to virginatlantic.com's reward-seat-checker calendar API
with a **whole-month** body:

```python
{
  "slice": {"origin": ..., "destination": ..., "departure": "<1st of month>"},
  "years":  [d.year],
  "months": [MONTH_NAMES[d.month - 1]],
}
```

The response is a per-month object with a `pointsDays[]` array — one
entry per day of that month. `_extract_for_date()` then picks the single
requested day out of the month payload.

Implications for Phase 4:
- VS has **no 60-day-style cap**. It is the *opposite* shape — one call
  already returns ~30 days of availability.
- A "sweep" for VS is trivial and arguably already half-built: to cover
  the full ~331-day window you issue **~11 month-calls** (`years`/`months`
  pairs) and concatenate `pointsDays`. The plugin already knows how to
  parse a month payload; only the fan-out loop is missing.
- **Open question (needs a live test):** does the VS calendar endpoint
  return real data for months 6-11 out, or does it thin out past some
  horizon? Quick test: call `_build_body` for `today + 300d`'s month and
  inspect whether `pointsDays` entries carry non-zero `cabinPointsValue`.
  This is a 1-request probe; do it when next touching the VS plugin.

### AS_MILEAGEPLAN — single-date SSR; cap unverified

Alaska's plugin (`python-workers/as_mileageplan/search.py`) GETs a
single-date SSR URL:

```
https://www.alaskaair.com/search/results?O=..&D=..&OD=<YYYY-MM-DD>&...
```

The full award JSON is inlined into the SvelteKit HTML hydration
literal — one GET = one date.

Implications for Phase 4:
- AS is a **pure per-date** scraper. There is no built-in date range, so
  covering the window is inherently one-call-per-date — but that is just
  how the cockpit already drives it (the user picks one date). No sweep
  is needed for the current single-date UX.
- A sweep would only matter if the cockpit later adds a "flexible dates
  / whole-month grid" feature. At that point AS needs N sequential GETs.
- **Open question (needs a live test):** Apify's notes single out Alaska
  as one of the carriers that caps anonymous inventory at ~60 days.
  Verify directly: GET the AS results URL for `today + 250d` on a known
  route (LAX→NRT per the cockpit's own example) and check whether the
  inlined payload has itineraries or is empty. If empty at 250d but
  populated at 50d, AS has an **inventory-visibility cap**, not a
  page-window cap — and no sweep helps; only an authenticated session
  (T5', though AS award search is currently "anonymous OK" per the
  rubric) or accepting the shorter real window would.

---

## The 11 currently-broken plugins — what to check once they are live

These cannot be tested now. When each plugin's transport is fixed in
Phase 1 (AA) / Phase 2 (the other 10), add this 3-step audit to its
validation matrix:

1. **Probe near horizon.** Run the plugin at `today + 30d` on a
   known-good route. Confirm it returns rows (baseline that the
   transport works at all).
2. **Probe far horizon.** Run the same route at `today + ~300d` (inside
   the registry's `maxDaysOut` for that program). Record: rows returned?
   HTTP/app status? empty-with-200 vs error?
3. **Classify the result:**
   - Rows at 300d → **no cap.** Plugin is done; the Phase 4 registry
     value is honest.
   - Empty-but-200 at 300d, rows at 30d → **probable cap.** Determine
     which kind:
     - Re-run the *raw upstream call* with an explicit wide date range
       (if the endpoint takes one). If a wider range returns later
       dates → it was a **page-window cap**; build the sweep (below).
     - If no date range / wider range still empty → **inventory-
       visibility cap**; a sweep won't help. Tag the plugin
       `anon_window_<N>d` and document that past-N-days needs T5'.
   - Error/challenge at 300d → transport issue, not a date cap; handle
     per the normal failure tree.

Carriers Apify's research explicitly flags as likely-capped for
anonymous callers — **prioritize the audit for these**: DL_SKYMILES,
AA_AADVANTAGE, B6_TRUEBLUE (not in current 13), AS_MILEAGEPLAN.

---

## Sketch of the date-sweep approach (build only when a real cap is confirmed)

For any plugin confirmed to have a **page-window cap** (kind 1 above),
the sweep is a generic fan-out wrapper. Do **not** scatter this per
plugin — put it in `python-workers/common/` as a reusable helper, the
same central-module discipline used for `program_windows.py`.

### Shape

```
common/date_sweep.py  (NOT created yet — sketch only)

async def sweep(
    fetch_window,            # async (start_date, end_date) -> list[NormalizedResult]
    *,
    target_date: str,        # the date the cockpit actually asked for
    program_id: str,         # -> program_windows.max_days_out(program_id)
    window_days: int,        # the per-call cap the endpoint enforces (e.g. 60)
    mode: str = "single",    # "single": just cover target_date's window
                             # "full":  cover today .. max_days_out
) -> list[NormalizedResult]:
    ...
```

### Algorithm

1. Resolve the ceiling: `horizon = program_windows.max_days_out(program_id)`.
2. Build a list of `[start, end]` chunks of at most `window_days` each,
   from `today` (or from `target_date` in "single" mode) up to
   `min(target_date or horizon, horizon)`.
3. Fire the chunk fetches with **bounded concurrency** (e.g. an
   `asyncio.Semaphore(3)`) — never all at once. Honor the rubric's
   politeness cap: *"max 2 calls/minute per upstream airline domain."*
   A sweep across 11 months at 60-day chunks is ~6 calls; pace them.
4. **Dedupe + merge.** Chunk boundaries overlap by design (a flight on
   the seam appears in two chunks). Key each `NormalizedResult` by its
   `itinerary_hash` (already computed in `serve.py::_serialize` via
   `common/hash.py::itinerary_hash`) and keep the first occurrence.
5. Return the merged, deduped list. The caller (`serve.py /search`)
   serializes it unchanged.

### Cost / risk notes

- **Cost multiplies by chunk count.** A T3/T4 plugin (Camoufox + Bright
  Data) at ~$0.005/req becomes ~$0.03 for a 6-chunk full-window sweep.
  The sweep MUST default to `mode="single"` (cover only the requested
  date's window — usually 1-2 chunks) and only do `mode="full"` behind
  an explicit "flexible dates" cockpit feature. A naive always-full
  sweep would blow the $50/day Bright Data cap fast.
- **Latency multiplies too.** 6 sequential paced chunks at ~2-8s each is
  a 15-50s search. Fan out concurrently within the politeness limit; SSE
  already streams partials so the cockpit can render the near-date chunk
  first.
- **Rate-limit / ban risk.** Sweeping is a louder traffic pattern than a
  single call — more likely to trip Akamai/Imperva rate rules. Pace
  per-domain, jitter the delays, reuse the warmed session/cookie jar
  across chunks rather than re-minting per chunk.
- **Most plugins likely will NOT need this.** VS already returns a month
  per call. AS is single-date by nature. The carriers that genuinely
  need a sweep are the subset with both (a) a working transport and
  (b) a confirmed *page-window* (not visibility) cap — possibly an empty
  set once Phase 1/2 transports are fixed and the real APIs are probed.

---

## Recommendation

1. **Ship Phase 4's UX half now** (done): the window registry,
   `/programs/meta`, and the calendar bound. This alone removes the
   60-day cap from the *user's* perspective for every program.
2. **Do not build `common/date_sweep.py` yet.** No plugin has a
   *confirmed* page-window cap, because 11 of 13 transports are broken
   and the 2 working ones (VS month-windowed, AS single-date) don't
   exhibit a 60-day page cap.
3. **Add the 3-step date-sweep audit** (above) to the validation matrix
   of every plugin fixed in Phase 1/2. The sweep becomes a real task
   only if/when that audit confirms a page-window cap on a live plugin.
4. For plugins that turn out to have an *inventory-visibility* cap (data
   genuinely hidden from anonymous callers past N days), the answer is
   **T5' authenticated cookie replay (Phase 2.5)**, not a sweep —
   consistent with `tasks/scraper-rubric.md` Phase 4 note.

---

## Open questions for the user / next session

- **VS far-horizon probe:** does virginatlantic.com's calendar API
  return real availability for months 8-11 out? One request answers it;
  worth doing next time the VS plugin is touched.
- **AS far-horizon probe:** is Alaska's anonymous SSR results page
  capped at ~60 days (as Apify's research implies) or does it serve the
  full ~330-day window? One GET on LAX→NRT at +250d answers it.
- **Flexible-dates feature:** the sweep's `mode="full"` only matters if
  the cockpit gains a whole-month / flexible-date grid. Is that on the
  roadmap? If not, the sweep stays `mode="single"` and is far cheaper.
- **Per-domain rate limits:** the rubric's "2 calls/min per domain"
  politeness cap would make a full-window sweep slow. Acceptable, or
  should sweeps be background-prefetched and cached rather than run
  synchronously inside `/search`?
