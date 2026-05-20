# Agent 2 — Apify `igolaizola/flight-award-scraper` Reverse-Engineering

Research date: 2026-05-19. All findings are from public Apify Store pages and igolaizola's public GitHub profile. The actor's source code is **not** public; what follows is the maximum we can infer from the public surface (input schema, output shape, pricing, developer's other code, supported list, response-time SLAs) plus an explicit list of unknowns.

---

## Actor overview

| Field | Value |
|---|---|
| Actor URL | https://apify.com/igolaizola/flight-award-scraper |
| Full title | "Flight Award & Itinerary Scraper – Miles, Taxes & Cabins" |
| Developer | Iñigo Garcia Olaizola (`igolaizola`) — Basque Country, Spain |
| Tagline | "Fast and robust web scrapers from the Golang Automation Guy" |
| Last modified | ~2 months ago (relative to 2026-05-19) |
| Maintained by | "Maintained by Community" (i.e. solo dev, no Apify employee SLA) |
| Total users | 164 |
| Monthly active users | 26 |
| Rating | 0.0 / 5 (0 reviews — too small to have accumulated public feedback) |
| Issues response time | ~20 hours |
| Member since | September 2024 |
| Categories | Travel, Automation, Integrations |
| Pricing tier shown | "$3.00 / 1,000 results" (the Business-tier headline) |
| Free / Starter price | $10.00 / 1,000 results, $0.001 per actor start |
| Business price | $3.00 / 1,000 results, $0.0003 per actor start |
| Tier discounts | Free 0% → Starter 50% → Scale 60% → Business 70% off list |
| Platform usage | Included (no extra compute-unit / proxy add-on cost) |
| Support channel | Telegram `@igolaizola` (no email, no GitHub issues) |
| Source code | **Not published.** No GitHub link visible on the store page; no matching repo under `igolaizola/` on GitHub (searched `flight`, `award`, `airline` — all returned "no repositories match"). |

### Programs supported (verbatim from the input schema's `issuers` enum)

The store page lists exactly **24 issuers** (we said "23+" but the public list is 24):

`aeromexico, aeroplan, alaska, american, azul, copa, delta, emirates, ethiopian, etihad, eurobonus, finnair, flyingblue, jetblue, lufthansa, qantas, qatar, saudia, singapore, smiles, turkish, united, velocity, virginatlantic`

Mapping to canonical program names (best effort, since the store uses lowercase short codes):

| Code | Program | Carrier(s) it queries |
|---|---|---|
| `aeromexico` | Aeromexico Rewards | AM + SkyTeam partners |
| `aeroplan` | Air Canada Aeroplan | AC + Star Alliance partners |
| `alaska` | Alaska Mileage Plan | AS + oneworld + partners |
| `american` | American AAdvantage | AA + oneworld + partners |
| `azul` | Azul TudoAzul | AD + partners |
| `copa` | Copa ConnectMiles | CM + Star Alliance |
| `delta` | Delta SkyMiles | DL + SkyTeam partners |
| `emirates` | Emirates Skywards | EK + partners |
| `ethiopian` | Ethiopian ShebaMiles | ET + Star Alliance |
| `etihad` | Etihad Guest | EY + partners |
| `eurobonus` | SAS EuroBonus | SK + Star Alliance (was) / SkyTeam now |
| `finnair` | Finnair Plus | AY + oneworld |
| `flyingblue` | Air France-KLM Flying Blue | AF/KL + SkyTeam |
| `jetblue` | JetBlue TrueBlue | B6 + partners |
| `lufthansa` | Lufthansa Miles & More | LH + Star Alliance |
| `qantas` | Qantas Frequent Flyer | QF + oneworld |
| `qatar` | Qatar Privilege Club | QR + oneworld |
| `saudia` | Saudia Alfursan | SV + SkyTeam |
| `singapore` | Singapore KrisFlyer | SQ + Star Alliance |
| `smiles` | GOL Smiles | G3 + worldwide partners |
| `turkish` | Turkish Miles & Smiles | TK + Star Alliance |
| `united` | United MileagePlus | UA + Star Alliance |
| `velocity` | Virgin Australia Velocity | VA + partners |
| `virginatlantic` | Virgin Atlantic Flying Club | VS + partners |

This 24-program list overlaps heavily with seats.aero and AwardFares, but is missing some PointSnap targets (no Asiana, no ANA, no JAL, no British Airways Avios, no Iberia Plus, no LATAM Pass, no South African Voyager).

---

## Input/output schemas (verbatim)

### Input schema

Fields, types, defaults, options, descriptions (lifted from the store's `/input-schema` page):

| Field | Type | Default | Options / validation | Description (verbatim) |
|---|---|---|---|---|
| `maxItems` | integer (≥1) | 100 | — | "Maximum number of items to scrape" |
| `sortBy` | string | "" (empty) | `economy`, `premium`, `business`, `first` | "Criteria to sort the search results" |
| `origins` | string[] | `["JFK"]` (UI default) | IATA codes | "IATA codes of the origin airport or city codes (leave empty to search all origins). At least one of origin or destination must be provided." |
| `destinations` | string[] | `["LHR"]` (UI default) | IATA codes | "IATA codes of the destination airport or city codes (leave empty to search all destinations). At least one of origin or destination must be provided." |
| `startDate` | string | — | `YYYY-MM-DD` | "Start date of the search (YYYY-MM-DD)" |
| `endDate` | string | — | `YYYY-MM-DD` | "End date of the search (YYYY-MM-DD)" |
| `cabin` | string | "" (empty) | `economy`, `premium`, `business`, `first` | "Cabin class for the search" |
| `issuers` | string[] | `[]` (all 24) | the 24-program enum above | "Loyalty program issuers to search (leave empty to search all issuers)" |

**Notable input invariants from the docs:**
- "At least one of origin or destination must be provided" — supports "from anywhere" and "to anywhere" via leaving one empty.
- City codes are accepted (e.g. `NYC`, `LON`), not just airport codes.
- The store page calls out that issuers can be referenced by their familiar names in copy (e.g. "Flying Blue", "AAdvantage", "MileagePlus"), but the wire enum is the lowercase short code.

### Output schema (per result row)

The store page describes the result structure but does not show a full schema file. Reconstructed from documentation + example JSON:

**Route-level fields**
- `date` — departure date
- `origin` / `destination` — airport codes
- `originName` / `destinationName` — airport names
- `issuer` — loyalty program short code (one of the 24)
- `issuerDetails` — nested object (likely full program name + currency unit)
- `distance` — route distance
- `coordinates` — lat/lon for origin & destination

**Cabin-level fields (array of available cabins for the route+date)**
- `name` — one of `economy | premium | business | first`
- `available` — boolean
- `mileage` — points/miles required
- `taxes` — tax/fee amount
- `airlines` — operating carriers
- `direct` — boolean (nonstop indicator)

**Itinerary-level fields (each search returns one or more itineraries)**
- Departure time, arrival time
- Duration
- `stops` — number of stops
- `connections` — array of connection airports
- `aircrafts` — array of aircraft types
- `flightNumbers` — array of flight numbers

**Segment-level fields**
- `cabin` per segment
- Remaining seat counts per cabin per segment

Note: the docs mention "shortened JSON example" with fields `mileage`, `taxes`, `cabins`, `flightNumbers`, `aircrafts[]` — but Apify's render trims the full schema. We don't have a 1:1 field map without running the actor. PointSnap's own normalized result type should be a superset of these fields; this list is enough to validate ours.

---

## Architecture (library, proxy, stealth, per-airline pattern)

**The actor source is closed.** No GitHub repo, no Apify "view source", no leaked archive. We're inferring from (a) the developer's public Go scrapers, (b) Apify platform conventions, (c) pricing/perf signals.

### Most likely stack (confidence: medium-high)

**Language: Go.** Strongest signal in the entire research dump. The developer:
- Self-describes as "the Golang Automation Guy" on his Apify profile.
- Has 99 public repos; nearly every scraper / automation one is Go (`fr24`, `idealista-scraper` infrastructure, `bulkai`, `vidai`, `chromedp` fork, `localproxy`, `gdown`, `webcli`, `goobar`).
- His one Apify-shipped scraper with a public Go counterpart (`fr24` / Flightradar24) is "a small, dependency-light Go library and command-line tool" that uses **`net/http` with browser-mimicked headers** — no Crawlee, no headless browser, no Playwright.
- His `chromedp` fork (Go CDP driver) and `darkpanda` fork (Zig Lightpanda — a headless browser for AI/automation) show he reaches for **lightweight browser drivers**, not the JS/Crawlee/Playwright stack Apify usually pushes.

So the Apify actor is almost certainly a Go binary wrapped as an Apify "Standby"/Docker actor. Apify supports Go via Docker images that talk to the Apify SDK over HTTP. This is materially different from the Node-first Apify default and explains why the actor's pricing is low ($3/1000 — possible only with cheap compute).

**Proxy: Apify residential proxy (default).** All three other igolaizola Apify actors we found (`apify-store-scraper`, `idealista-scraper`, `planeslive-scraper`) explicitly state "Apify RESIDENTIAL group" is the default. He clearly piggybacks on Apify's bundled proxy rather than running his own Bright Data / IPRoyal account through the actor.

**Stealth: almost certainly direct API hits, not browser automation.** The signals:
- $3 / 1000 results at the headline tier and $1.40 / 1000 on the PlanesLive actor are too cheap for headful or even headless browser runs. Browser-based award scrapes typically cost 5-20¢ per result on Apify (compute units stack up). Direct JSON API hits are the only architecture that fits the price.
- The `fr24` precedent: "rely on standard `net/http`; requests mimic the browser headers expected by Flightradar24" — that's igolaizola's house pattern. Mimic the airline's mobile or web JSON API directly, with rotating residential IPs.
- No mention of Akamai, DataDome, Cloudflare, Patchright, Camoufox, Playwright, Puppeteer, rebrowser, sensor.js, captcha, or any anti-bot vendor anywhere in the actor docs.
- The 60-day cap (see next section) is itself a tell: it almost certainly mirrors the carrier-specific API cap (e.g. Delta's award API only returns within ~60 days for unauthenticated calls).

**Per-airline pattern (inferred): one handler per issuer, dispatched by `issuer` enum.** With 24 programs and a single Go binary, the most likely shape is `internal/issuers/{aeromexico,aeroplan,alaska,...}/scrape.go` each implementing a common interface like `Query(ctx, origin, dest, dateRange, cabin) ([]Result, error)`. The `issuers` input field selects which subset to fan out to. The high "0% review" + "164 users" suggests low complaints — most likely because users only enable the issuers they trust, and the broken ones silently return 0 rows.

**Cookie / session handling per airline: per-request.** No mention of session persistence. Given the residential-proxy + direct-API model, the actor probably re-establishes any required cookie/CSRF token per query, per airline, on the fly. This is fragile against carriers that watch for fast cold-start behavior (AA, Delta), which may be why igolaizola's actor has only 26 monthly active users despite the broad program list — power users probably found half the issuers silently empty.

### What we don't know (be honest)

- **Which carriers actually return real data vs. silently empty.** With 0 reviews, no public test results, and a "Maintained by Community" badge (i.e. no Apify QA), the 24-issuer claim is a marketing surface. The PointSnap scraper log already shows AA, UA, AS, and others are very hard. It is highly likely a meaningful subset of the 24 (especially `american`, `united`, `alaska`, `delta`) either return nothing, return only direct-flight inventory, or silently degrade.
- **The exact API endpoints he calls per airline.** Inferable only by running the actor and capturing his outbound traffic from Apify's perspective (which we cannot do from outside; Apify's residential proxy egress IPs would be the only thing the airline sees).
- **Whether he uses captcha solvers at all.** Probably not — no captcha-vendor mention anywhere, and the per-result price wouldn't sustain CapSolver/2Captcha fees.
- **Concurrency model.** Not documented. Could be goroutine fan-out per issuer × per date × per origin/destination pair.
- **Error / partial-result semantics.** Not documented. Whether failure on one issuer returns partial dataset or aborts the whole run is unknown.

---

## 60-day cap analysis

**The cap is real, documented prominently, and likely structural — not a configurable flag.**

Verbatim from the actor page:
> "⚠️ Date limit: searches more than 60 days in advance are not supported. Only departure dates within the next 60 days will return results."

Evidence it is not a recent restriction the actor might soon lift:
- The input schema has no min/max validation on `startDate` / `endDate` — meaning the cap is enforced **downstream**, inside the per-airline scrapers, not at input validation time. That tells us the cap is a property of the data sources he hits, not of his actor code.
- The cap aligns with the unauthenticated public-API window of several carriers: Delta, AA, JetBlue, and Alaska all gate further-out award inventory behind logged-in sessions or only return partial data >60 days out. The cap is the lowest-common-denominator across the 24 issuers.
- The changelog is not public, but "modified 2 months ago" with no mention of cap extension and a stable 24-program list suggests this is the architectural ceiling.
- The cap is also a documented limitation in user reviews of competing tools — PointSnap-relevant context: seats.aero (paid tier) and AwardFares (paid tier) both routinely return inventory beyond 60 days, because they use authenticated sessions and richer carrier integrations. igolaizola's unauthenticated approach can't get there.

**Why PointSnap can't accept this:** Award travel users plan 6-11 months ahead. A 60-day window is a "last-minute deals" tool, not a planning tool. This is the single biggest reason to build our own.

**Implication for our build:** Wherever igolaizola has a 60-day floor, the data lives behind an authenticated session or a carrier-internal mobile-app API. Our per-carrier strategy needs to invest in session/cookie/device-ID acquisition per program — exactly the work the scraper log is already tracking for AA/UA/Alaska.

---

## igolaizola's other open-source work

Selected from his ~99 public repos. Filtered to anything relevant to PointSnap (scraping, browser automation, anti-bot, proxy, airlines):

| Repo | Lang | What it is | Borrowable for PointSnap? |
|---|---|---|---|
| `igolaizola/fr24` | Go | "Unofficial data scraper for flightradar24.com" using JSON endpoints + gRPC-web + login/sub-key/anonymous device ID. **Uses `net/http` with browser-mimicked headers — no Playwright, no Puppeteer.** | Yes — strong template for our direct-API-hit pattern for any program where we can RE the mobile/web JSON. The device-ID anonymous flow is reusable. |
| `igolaizola/chromedp` (fork) | Go | "A faster, simpler way to drive browsers supporting the Chrome DevTools Protocol" — Go CDP driver. | Useful if/when we need full browser automation in a Go worker; lighter than Playwright. |
| `igolaizola/darkpanda` (fork) | Zig | Fork of Lightpanda — a brand-new headless browser written in Zig, 9x less memory than Chrome, 11x faster, CDP-compatible. "Designed for AI and automation." | Watch this. If Lightpanda matures, it could become the lightweight headless engine to replace Camoufox/Patchright for low-defense carriers. Not production-ready yet (his fork has 0 stars). |
| `igolaizola/idealista-scraper` | HTML + Apify wrapper | Real-estate scraper on Apify; uses Apify residential proxies, no mentioned stealth library. | Lesson: he reuses the same Apify-residential pattern across all his actors. |
| `igolaizola/localproxy` | Go | "Lightweight HTTP proxy that forwards traffic to an upstream server." | Possibly useful as the egress point from PointSnap's workers when chaining through Bright Data / IPRoyal. |
| `igolaizola/uaconst` | Go | Go package with "User-Agent consts values." | Trivial but useful — drop-in UA pool for header rotation. |
| `igolaizola/planeslive-scraper` (Apify only) | unknown | FlightRadar24-alternative scraper, $1.40/1000. Same MO. | Confirms his pattern: direct JSON, residential proxy, Go binary, no headless browser. |

**No public repo named `airline-awards`, `award-scraper`, or anything matching the 24 issuers.** Searched `flight`, `award`, `aeroplan`, `aeromexico` — zero matches on his GitHub. The Apify actor's source is intentionally not open.

**No standalone bot-defense or captcha-solving tools** in his public repos. He does not appear to maintain a custom Akamai/DataDome bypass or captcha solver — consistent with the "no captcha vendor needed" theory of the actor architecture.

Adjacent interesting projects (not directly useful but speak to his style): `bulkai` (AI image automation, 226⭐), `vidai` (RunwayML client, 94⭐), `igogpt` (Go AutoGPT, 74⭐). He's a prolific Go automation hacker who ships fast and treats Apify as a distribution channel, not as a platform he's invested in.

---

## What we should steal vs. invent (synthesis)

### Steal (concretely)

1. **The 24-issuer naming convention.** `aeromexico`, `aeroplan`, ..., `virginatlantic` — exact lowercase short codes. We're going to need wire-level enum strings for our own program identifiers; lifting his naming saves time and earns interop credit if anyone is comparing outputs side-by-side. PointSnap's program enum should match these where they overlap, with a clean extension pattern for the programs he doesn't cover (Asiana, ANA, JAL, BA, LATAM, ...).
2. **The flat input schema shape.** `origins[] / destinations[] / startDate / endDate / cabin / issuers[] / maxItems / sortBy` is a clean minimal contract. PointSnap's search RPC should mirror this so any user who's already integrated with the Apify actor can drop ours in. Add `tripType` (one-way / round-trip / multi-city), `passengers`, and `connections` (max stops) — all gaps in his schema.
3. **The output row contract — route × date × issuer with cabin sub-rows.** That's the same shape seats.aero exposes, and it's the right granularity for PointSnap's spreadsheet view. Adopt his nested cabin array + segment-level remaining-seats fields. Add `bookingClass` (RBD letter) and `directBookable` (boolean — can the program ticket this without phone/agent), which his schema lacks.
4. **Direct-API-first pattern, browser-as-fallback.** His architecture (`fr24` precedent + low pricing) confirms what the scraper log already concluded: hitting carrier JSON endpoints with rotating residential IPs + browser-mimicked headers is cheaper and more reliable than headless-browser automation **for carriers without modern bot defense**. Our scraper log's "Quick reference: working state" should explicitly tag each carrier as "API-hit possible" vs. "must use headless browser" — igolaizola's 60-day cap suggests he's all-API, and the carriers where that approach truncates inventory are the ones we'll need to invest in authenticated/headless flows for.
5. **Per-program file isolation.** One Go file (or TypeScript module in our case) per issuer, behind a shared `Scrape(ctx, query) Result` interface. Lets one carrier break without affecting the others. The PointSnap `python-workers/<program>/` layout is already aligned with this.
6. **Apify residential proxy as a cheap default fallback.** For low-defense carriers, paying $3/GB residential through Apify is cheaper than Bright Data direct. Worth a price/perf experiment for non-Akamai carriers.

### Invent (do not copy)

1. **Past the 60-day cap.** This is the entire reason we're building. Every program with a meaningful planning use case (AA, UA, AS, DL, AC, LH, SQ, VS, EK, QR, ...) needs to return data 11+ months out. That requires authenticated sessions, mobile-app device IDs, and program-specific token / refresh flows — work he explicitly doesn't do.
2. **Authenticated session pool per program.** PointSnap needs to maintain a small pool of warmed cookie jars / device fingerprints per program, refreshed in the background. Not visible in igolaizola's actor; it's the unlock for the long-date window and for premium-cabin inventory many programs hide from anonymous queries.
3. **Anti-bot tooling for the hard carriers.** AA (Akamai), Delta (Imperva), Alaska (Cloudflare), United (Datadome at times). igolaizola apparently sidesteps these by accepting whatever short-date public window each exposes; we have to actually beat them. This is what the scraper-log work is for — none of his code helps.
4. **Caching + diffing across runs.** His actor is stateless one-shot. PointSnap's product needs incremental refresh, change detection ("3 new business seats appeared on this route last hour"), and per-user notification — none of which is in his scope.
5. **Mixed-cabin itineraries + per-segment award class.** His output shows per-segment cabin info, but the schema doesn't expose booking class letters (RBD codes like X, U, I, O) — which is what serious award hackers actually need to confirm partner award eligibility. Bake those in from day one.
6. **Honest "broken" reporting.** A 0-row response from his actor doesn't distinguish "no availability" from "the scraper broke for this issuer today." PointSnap should always emit a per-issuer health/status alongside the dataset, so users can see when a program is dark. The scraper log already tracks this internally; expose it to users too.
7. **Carriers he doesn't cover.** ANA Mileage Club, JAL Mileage Bank, British Airways Avios, Iberia Plus, LATAM Pass, Asiana Club, Air China PhoenixMiles, South African Voyager, and a handful of the ME3/Asian programs are missing from his 24. Several of these (Avios in particular) are essential to a North-American award-search audience.

### Open questions worth resolving before we ship

- Run the actor once on a couple of issuers we already understand (e.g. `flyingblue` JFK→CDG, 7 days out) and capture output JSON to validate our normalized schema is a strict superset of his.
- For the carriers where the scraper log marks us as 🚧, check whether his actor returns real data on the same route. If yes, that's a strong signal the API approach is viable and we just haven't found the right endpoint yet. If no, our hypothesis (carrier needs authenticated/headless approach) is corroborated by his omission.
- Telegram-DM `@igolaizola` — he answers in ~20 hours per the actor page, and he has a "side project enthusiast" attitude that's compatible with a low-stakes conversation about technique. Worst case he says no; best case he reveals which programs he considers "well-behaved" vs. which silently empty.

---

## Citations

- Actor store page: https://apify.com/igolaizola/flight-award-scraper
- Actor input schema: https://apify.com/igolaizola/flight-award-scraper/input-schema
- Actor API tab: https://apify.com/igolaizola/flight-award-scraper/api
- Developer profile: https://apify.com/igolaizola
- Developer GitHub: https://github.com/igolaizola
- igolaizola GitHub — recently updated repos page: https://github.com/igolaizola?tab=repositories&sort=updated
- igolaizola `fr24` (closest open-source analog): https://github.com/igolaizola/fr24
- igolaizola `idealista-scraper` (Apify proxy precedent): https://github.com/igolaizola/idealista-scraper
- igolaizola `darkpanda` (Zig Lightpanda fork): https://github.com/igolaizola/darkpanda
- igolaizola `chromedp` (Go CDP fork): https://github.com/igolaizola/chromedp
- igolaizola `localproxy`: https://github.com/igolaizola/localproxy
- igolaizola `uaconst`: https://github.com/igolaizola/uaconst
- igolaizola `planeslive-scraper` (architectural sibling): https://apify.com/igolaizola/planeslive-scraper
- igolaizola `apify-store-scraper` (architectural sibling): https://apify.com/igolaizola/apify-store-scraper

Searched and confirmed missing (no public source for the airline awards actor):
- `https://github.com/igolaizola?tab=repositories&q=flight` → "doesn't have any repositories that match"
- `https://github.com/igolaizola?tab=repositories&q=award` → "doesn't have any repositories that match"
- Google site:github.com igolaizola scraper → only `idealista-scraper`, `twai`, `fr24`, `freepik-nanobanana-automation`, `ff7book` returned; no airline repo.
