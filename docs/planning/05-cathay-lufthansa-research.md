# PointSnap Scraper Research Dossier: Cathay & Lufthansa Miles & More

Two stragglers from the original architecture matrix, both of which represent high-value redemption programs that enthusiasts will absolutely expect to see on day one of PointSnap, but neither is straightforward. This document fills the gap with the same depth as the other 12 program rows.

## Intelligence Matrix Rows

| Program | Endpoint type | Login req. | Anti-bot stack | Mobile API alt. | ToS / Legal history | Practical difficulty |
|---|---|---|---|---|---|---|
| Cathay (Asia Miles) | JSON over `book.cathaypacific.com/CathayPacificAwardV3/dyn/air/booking/availability` (REST-ish, checksum-gated, 20 calls per checksum) | Yes for pricing; partial guest browse on legacy paths | Akamai Bot Manager v2 + Akamai-issued challenge interstitial; checksum/token rotation; reported TLS/JA3 sensitivity | Native app exists, traffic is Akamai-edged with cert-pinning; no public successful MITM writeup | No public C&D against scrapers; ToS prohibits automated access generally; userscripts (Greasyfork, Verylvke "Unelevated") tolerated to date | 4 / 5 |
| Lufthansa Miles & More | Web XHR behind `miles-and-more.com` + `lufthansa.com` SPA; partner pricing on fixed chart; LH/LX/OS on dynamic pricing as of Jun 2025 | Yes — 7,000-mile minimum balance to even query award search; Travel ID required | Akamai Bot Manager (case-studied by Akamai themselves); famously aggressive — multiple "I am not a robot" interstitials per search; Travel-ID-bound OTP layer | M&M and Lufthansa mobile apps both exist; Akamai-edged; no clean public bypass | No public C&D specifically from LH against award scrapers, but LH Group is in the same Star-Alliance bloc as Air Canada (which sued seats.aero in 2023); NDC distribution agreements add a contractual gloss | 5 / 5 |

---

## 1. Cathay (Asia Miles)

### A. Award search endpoints

The current Cathay award flow lives at `book.cathaypacific.com/CathayPacificAwardV3/dyn/air/booking/availability` with a `TAB_ID` query parameter and a per-session checksum that is good for ~20 API calls before it must be refreshed. The pattern is documented by community reverse-engineering: the "Unelevated" CX Award Search super-plugin (FlyerTalk; verylvke.com tutorial) intercepts the XHR, replays it with mutated origin/destination pairs, and amortises the captcha bootstrap across a 20-day window. The "Cathay Award Search Fixer 2022" Greasyfork userscript (v3.1) was specifically updated to intercede on the Akamai captcha — strong evidence that the captcha is the choke point, not auth.

There is also a public `developers.cathaypacific.com` NDC portal, but it is gated behind an IATA travel-agent agreement and is not the same surface the consumer site hits. NDC is irrelevant for scraping; it's a B2B distribution channel.

No GraphQL is observed on the award path. It's a classic REST-ish JSON endpoint with a heavy session/checksum wrapper.

### B. Authentication

Award space *browse* tolerates an unauthenticated session through the bootstrap captcha, but most useful queries — especially mixed-cabin and partner-routed itineraries — require a logged-in Cathay member. Cathay restricted username and social sign-on in 2024; the supported flow is now verified mobile-number or verified-email + password, with a per-mobile/per-email uniqueness constraint (a complaint thread on FlyerTalk documents the friction of trying to attach the same phone to a second account). There is **no formal KYC** for account creation, but the mobile-uniqueness rule is the practical wall: you cannot trivially spin up 200 accounts with a SIM farm without unique numbers.

Account lockouts are conservative — several bad password attempts triggers a 24-hour or longer lock that requires a password reset to clear. Sessions, anecdotally, last on the order of 30 minutes idle.

### C. Anti-bot stack

**Akamai Bot Manager.** This is well-documented: the captcha interstitial that the Unelevated plugin "intercedes on" is the standard Akamai-issued challenge page, and Cathay's public-facing edge is on Akamai (Cathay also uses Aryaka SASE internally per a 2024 case study, but the consumer site is Akamai-fronted). Practical consequences:

- **TLS/JA3 sensitivity is high.** Akamai Bot Manager's primary detection vector in 2025-2026 is JA4 fingerprinting, and curl_cffi-style impersonation is the table-stakes mitigation. Plain `requests` or `httpx` will be 403'd at the edge.
- **Challenge cadence is bootstrap-then-amortise.** The community plugins all describe the same pattern: solve one captcha at the start of a session, then the checksum is good for ~20 calls before it expires. This is exactly the shape we expect for an Akamai `sec-cpt` / `bm_sz` / `_abck` cookie-based session.
- **Behavioural biometrics:** Akamai's `bmak` sensor data collects mouse and keyboard telemetry. A pure curl_cffi replay will work *if* we can extract a valid `_abck` and `bm_sz` from a real browser bootstrap; otherwise we need full Patchright/Camoufox to bootstrap and then hand off.
- **Geo-blocking:** No reports of regional blocks; Cathay sells globally. Hong Kong egress is not required, but a stable Asia-Pacific egress reduces challenge frequency anecdotally.

### D. Mobile API

The Cathay iOS/Android app is Akamai-edged and uses certificate pinning (no public Frida bypass writeups found). It does not appear to be materially less defended than the web, which is unusual — for many airlines the mobile API is the easy door, but Cathay's app and web hit the same `book.cathaypacific.com` backend with similar wrappers. **No path of less resistance via mobile.**

### E. Quirks specific to award search

- **April 2025 chart change.** Cathay refreshed its Asia Miles award chart on 15 April 2025: own-metal and oneworld multi-carrier awards went up ~5% in most bands. The chart is still zone-based and *not* dynamic — predictable to model.
- **2027 program rebrand.** The Asia Miles currency name will rebrand to simply "Cathay" by 2027, with a one-year transition starting Jan 2026. Internally we should treat the currency as `asia_miles` with a display alias.
- **Fuel surcharges are real and brutal.** Cathay roughly doubled fuel surcharges in March 2026, raised them again 34% in April 2026, then trimmed 13% in May 2026. Award redemptions inherit the per-sector surcharge — a HKG-JFK round-trip currently carries hundreds of dollars in YQ. **PointSnap must surface cash co-pay alongside miles**; this is a defining UX issue for Cathay redemptions.
- **JL access window.** Cathay opens partner JAL award space at T-360 days, the same window as JAL's own program. This is a genuine sweet spot vs. AAdvantage (which gates JL space later) and OneWorld competitors. **PointSnap needs JL coverage via Cathay to be meaningful.**
- **Stopovers/open-jaws:** Allowed on round-trip multi-carrier oneworld awards but not on simple one-way; complexity is moderate, not pathological like Aeroplan.

### F. OSS scrapers / known prior art

- **flightplan-tool/flightplan** (Node.js + Puppeteer, archived/inactive): explicitly lists CX/AsiaMiles with both search and parse. Stale (the booking-engine UI changed twice since the last commit) but the URL patterns it hits are still instructive.
- **Cathay Award Search Fixer 2022** (Greasyfork): userscript that intercepts the XHR and resolves the Akamai captcha; v3.1 explicitly added captcha intercede logic.
- **Verylvke "Unelevated" CX Plugin** (closed-source userscript, sold/distributed via FlyerTalk and verylvke.com): batch search across 20-day windows and multi-OD pairs. Single best public evidence of the exact API shape.
- **henrylim96 / dev.to** ("Reverse Engineering Cathay Pacific's Seat Selection Page"): not award-search, but documents Cathay's JSON conventions and CORS posture.
- **AwardWiz (lg/awardwiz)** does *not* support Cathay.
- **Commercial services that successfully scrape it:** seats.aero (partial — only via partner programs, not Asia Miles directly), Roame (live Asia Miles search added 2024), point.me, AwardTool (Frequent Miler integration).

### G. ToS / Legal history

**No published Cathay C&D against award scrapers.** The closest public action: Cathay has aggressively sued individuals for the "Million Dollar Mistake" mispriced-fare incidents and similar pricing exploits, but those are different. The Cathay consumer ToS contains the standard prohibition on automated access without consent and on commercial use of the site. Cathay is **not in the Star Alliance bloc** that has been most legally aggressive (Air Canada/seats.aero suit was Air Canada specifically, not a bloc action). Risk posture: medium. The fact that Roame and point.me operate openly suggests Cathay is currently tolerating commercial scraping that respects rate-limits.

### H. Practical difficulty: 4 / 5

The endpoint shape is known and the captcha is bootstrap-amortising rather than per-call (which would be 5/5). However: Akamai TLS sensitivity + checksum rotation + captcha bootstrap + mobile-uniqueness on accounts + fuel-surcharge data normalisation + frequent UI breakage (the "Elevated" engine was broken for nearly two months in 2022) push it firmly into "hard."

### I. Recommended worker stack

- **Primary: Patchright (Chromium-based stealth Playwright) for bootstrap, then curl_cffi for replay within the 20-call checksum window.** This is the cheapest stable architecture given Cathay's amortised captcha model.
- **Camoufox** as fallback if Patchright leaves a JA4 fingerprint Akamai flags (Cathay's edge is one of the more aggressive Akamai deployments in airline-land).
- **Account inventory: 30-50 accounts** rotated on a session-aging schedule. Mobile-number uniqueness is the binding constraint — we will need 30-50 unique numbers via a SIM-pool provider (e.g., Twilio + verified-by-SMS, or a residential-SIM service if Cathay rejects VoIP numbers, which they reportedly do).
- **Proxy geo: IPRoyal residential, mixed Asia-Pacific and North-American egress.** Hong Kong specifically is not required but HKG/SIN/TYO IPs draw fewer challenges than US/EU per community reports.
- **CapSolver** for the Akamai bootstrap captcha (Akamai Web challenge / image-grid). CapSolver advertises an Akamai endpoint at $0.50-$1.00/1k.
- **p95 latency target: 8-15 seconds per search** (one search = bootstrap-amortised XHR + parse). If we have a warm session, p95 closer to 3-5 seconds.
- **Captcha rate expectation: 1 captcha per ~20 queries** (bootstrap model). Cost-per-query stays sub-cent.

### J. Build-week effort: **3 weeks**

One week for endpoint reverse-engineering and the Patchright bootstrap shim, one week for the curl_cffi replay layer and checksum rotation, one week for account-pool plumbing, fuel-surcharge normalisation, JL/CX disambiguation, and the standard hardening + canary tests. The mobile-uniqueness account problem is the wildcard — if SIM procurement is slow it stretches.

### K. Sweet-spot value

This is **a must-have for PointSnap.** Cathay First (J/F/A class) is one of the most-redeemed luxury cabins on the planet, and Asia Miles is one of only two programs (the other being AAdvantage) that gives Americans realistic access. The sweet spots:

- **CX F HKG-JFK** at 110-125k Asia Miles one-way is a top-three luxury redemption globally.
- **JL F NRT-JFK** via Asia Miles at the T-360 booking window is unmatched.
- **QF F LAX-SYD/MEL** via Asia Miles, when QF releases it.
- **Intra-Asia J** redemptions (HKG-TYO, HKG-SIN) at 30-50k miles round-trip are bread-and-butter enthusiast bookings.

Skipping Cathay would be a defensible launch decision (point.me and seats.aero already cover it), but it would brand PointSnap as not-serious-yet to the enthusiast cohort.

---

## 2. Lufthansa Miles & More

### A. Award search endpoints

Award search is served behind the `miles-and-more.com` and `lufthansa.com` consumer sites, both Akamai-edged and both hostile. There is no clean public XHR documentation in OSS, which is itself diagnostic — every prior-art attempt (the `NikolaiT/stealthy-scraping-tools` Lufthansa scraper notably) takes the **full-browser DOM-scrape** approach rather than API replay, because the Akamai bootstrap + Travel-ID session cookie combination has not been cleanly extractable to a headless replay.

Lufthansa Group operates a public **NDC Partner Program** with a documented Direct NDC API at `lhgroupairlines.com/ndc` (and developer docs at `developer.lufthansa.com`). The NDC channel is real and meaningful — Lufthansa is one of the loudest NDC pushers in the industry — but it requires an IATA agency agreement, returns *cash* offers not award space, and the contract explicitly limits usage. NDC is not a scraping route; it's a different product.

No GraphQL on the award path. The award flow is the customer SPA on `miles-and-more.com` calling a JSON service on the same origin.

### B. Authentication

**Login is effectively mandatory for award search**, and worse: M&M enforces a **7,000-mile minimum account balance** before the system will return any award availability data. This is the single most operationally-painful constraint of any program on PointSnap's list. You can't just create 50 throwaway accounts; each one must hold 7,000+ miles. Workarounds:

- Buy miles directly (expensive — at ~3¢/mile that's $210+ per account).
- Earn via M&M dining/shopping partners (slow, friction).
- Use the M&M co-brand credit card sign-up bonus (regional, KYC-bound).
- **The clean workaround: use partner programs (United MileagePlus, Aeroplan, ANA) for Star Alliance availability instead and *compute* the M&M price from the published partner chart.** This is what point.me and Roame appear to do for partner-metal flights. It does *not* work for LH/LX/OS own-metal under the post-June-2025 dynamic-pricing regime.

Travel ID (Lufthansa's federated identity, now the only login method) adds an OTP layer when the booking email differs from the profile email. Account creation requires email verification but no hard KYC. Sessions are short (~20-30 minutes idle).

### C. Anti-bot stack

**Akamai Bot Manager, deployed aggressively.** This is not speculation — Akamai publishes a Lufthansa customer case study on their own marketing site. FlyerTalk has multi-page threads ("Miles & More award search unusable due to Akamai") where Senator-tier elites complain about needing to clear three Akamai interstitials per date change on a single search. Practical consequences:

- **TLS fingerprinting is real and JA4-sensitive.** curl_cffi with Chrome 120+ impersonation is required floor.
- **IP reputation is heavily weighted.** Community reports: VPN exits, Apple Private Relay, and any datacenter IP are near-instant 3-challenge-stack triggers. Residential proxies are mandatory.
- **JavaScript-blocking flags immediately.** Confirms an active `bmak` sensor.
- **Behavioural biometrics:** mouse-curve and timing telemetry are collected via the standard Akamai sensor script.
- **CAPTCHA presence:** Akamai's image-grid challenge, with surprisingly high friction (multiple stacked challenges).
- **Geo-blocking:** No country blocks, but European IPs (DE specifically) reportedly clear faster than US residential.

### D. Mobile API

The M&M and Lufthansa mobile apps are also Akamai-fronted. Certificate pinning is in place. No public Frida bypass writeup exists for the M&M app. The mobile path does **not** present a softer target.

### E. Quirks specific to award search

- **The legendary "T-14 first-class partner rule" has tightened.** Historically, LH withheld F-class availability from partners until 14 days before departure. Through 2024 the window was 30 days. In 2024-2025 LH **narrowed the window to as little as 2-4 days before departure** — the worst posture in the program's history for partner redemptions. This is hugely material for PointSnap: a user searching United/Aeroplan/Avianca for LH F at T-60 will see nothing, but that doesn't mean the seat won't open. We need to **clearly explain the T-2-to-T-4 phantom-availability problem** and ideally offer a "watch this date for LH F" alert.
- **LH F is currently bookable in advance via M&M's own program**, not partners. This is the only way to plan ahead, and it requires the 7,000-mile balance plus M&M-side pricing.
- **Dynamic pricing on LH/LX/OS own-metal as of 3 June 2025.** Award price is calculated off the cash fare. Region-of-sale price differences for partners remain on the fixed chart.
- **Partner award chart changes (Jun 2025):** F NA-Europe RT 182k→215k, J 112k→125k, but economy *dropped* 60k→50k.
- **Stopover/open-jaw rules are generous on multi-region partner awards** (2 stopovers + 2 open-jaws on RT), but **the official miles-and-more.com site exposes no UI for stopovers** — they have to be priced by phone agent. Scraping stopover pricing is therefore *out of scope* for v1; we will only model point-to-point and simple connecting itineraries.
- **Allegris A350 F is not partner-bookable.** Only legacy 747-8, A380, A340-600 F releases to partners. PointSnap should annotate this aircraft-specifically.

### F. OSS scrapers / known prior art

- **`NikolaiT/stealthy-scraping-tools/lufthansa-de.py`** — Selenium-based, human-mimicry approach, no captcha solving, hits `lufthansa.com/de/de/homepage`. Demonstration code, not production.
- **flightplan-tool: no LH/M&M support.**
- **AwardWiz: no LH/M&M support.**
- **Commercial coverage:** seats.aero (Lufthansa First Class Finder is a flagship product), Roame (M&M added 2024), point.me, AwardFares. All four operate openly. No public technical writeups exist of *how* they handle the Akamai bootstrap — this is closely-held competitive IP.
- **No academic or blog teardown of M&M's actual JSON request shape exists publicly.** This means PointSnap will be doing genuine first-pass reverse-engineering, not lifting from prior art.

### G. ToS / Legal history

**No published Lufthansa C&D specifically against award scrapers.** That said:

- LH is the German equivalent of Air Canada in Star Alliance — both are flag-carrier hubs with sophisticated legal teams.
- The Air Canada vs. seats.aero suit (Nov 2023) was framed around ToS-violation and trademark infringement, both of which would apply equally to LH.
- LH Group's NDC Partner Program contract is materially stricter than the consumer ToS — if PointSnap ever pursues NDC partnership for cash-fare data, accepting that contract narrows what we can do with scraped award data.
- The M&M consumer ToS prohibits automated access. German law (BGH ruling on Ryanair v. Aviantis, and the more permissive *Generic.de* line) is on balance scraper-friendly for *publicly accessible* data, but M&M's award search is behind the 7,000-mile auth wall, so the data is *not* publicly accessible in a legal sense. This is the meaningful difference vs. Cathay — **scraping LH award data requires breaching a meaningful auth gate, which strengthens any future contract or computer-misuse claim.**

Risk posture: **the highest of any program on PointSnap's list.** Not because LH has acted, but because the legal facts (Akamai + auth-gate + Star-Alliance precedent + NDC contract overlay) line up cleanly for them to act if they choose.

### H. Practical difficulty: 5 / 5

This is the hardest program of the 14 in PointSnap's scope. Combine the toughest commercial anti-bot stack in airline-land (case-studied Akamai with stacked challenges), with a 7,000-mile per-account warmup cost, with dynamic pricing on own-metal, with the most adversarial legal posture, with the T-2-to-T-4 partner-F window that breaks normal-search-window assumptions, and there is no axis on which this is easy.

### I. Recommended worker stack

- **Primary: Patchright with full browser, undetected and with realistic behavioural priming (mouse curves, dwell time, scroll).** Pure curl_cffi replay is unlikely to survive Akamai's `bmak` sensor on LH specifically — the challenge stacking is too aggressive.
- **Camoufox as the secondary stack** (Firefox-based fingerprint mutation), useful for breaking up Chrome-monoculture detection patterns.
- **CapSolver for Akamai image-grid challenges**, budget for **3x the captcha rate of Cathay** — community reports cite 3 challenges per search routinely.
- **Account inventory: 20-30 warmed accounts**, each pre-loaded with 10,000+ miles. **Account warmup is a one-time capital cost of $6-10k** (mile purchases or partner-transfer-in). This is unique to LH and is a real CFO conversation.
- **Proxy geo: IPRoyal DE/AT/CH residential**, with US residential as a secondary pool for North-American-origin queries.
- **Bright Data fallback** is more important here than elsewhere — Akamai aggressively burns proxy pools.
- **p95 latency target: 20-40 seconds per search** (browser bootstrap + multiple captcha challenges + JSON fetch + parse). This is 3-5x slower than every other program in the matrix. Caching becomes structurally necessary.
- **Captcha rate expectation: 1-3 per search**, sometimes more for date-range scans.

### J. Build-week effort: **3-4 weeks**

Two weeks for the Akamai bootstrap reverse-engineering (this is real first-pass work — no flightplan-tool to lift from). One week for account warmup pipeline and the 7,000-mile minimum logic. One week for dynamic-pricing model (LH own-metal) vs. fixed partner chart, the T-14/T-4 F-class display logic, and Allegris-aircraft annotation. **This is the highest-risk estimate in the program list** — could easily slip to 5 weeks if the Akamai posture changes mid-build (which it has, twice in the last 18 months per FlyerTalk).

### K. Sweet-spot value

LH First on own-metal (747-8, A380, A340-600 from FRA/MUC) is **the** legacy European First product, and M&M is the only program with reliable advance access. Plus:

- **ANA F NRT-JFK** at 110k partner miles one-way (post-June-2025 chart) is one of the great redemptions, and M&M is one of only three programs that can book it cheaply.
- **LX F ZRH-USA** on Swiss is a unique product (the Swiss First throne) and bookable only via M&M and a handful of partners.
- **Generous stopover rules** on round-trip partner awards (where surfaceable) make M&M one of the best programs for circle-Europe itineraries.
- **Star Alliance partner economy and business** at the published partner chart — the post-June-2025 economy *drop* to 50k RT NA-Europe is genuinely competitive.

Like Cathay, LH is **not** literally a launch blocker (seats.aero's Lufthansa First Finder is the dominant solution today and PointSnap can defer with credibility), but the enthusiast cohort will notice if it is missing.

---

## Recommendation: Build sequencing and launch posture

Inserting these two programs into the Week 3-10 build sequence already established for the other 12:

- **Cathay → Week 7-9 (3-week slot).** Slot after the Akamai-protected programs already in scope (this lets us reuse the Akamai/Patchright/CapSolver shim infra). Cathay is realistic, the prior art is decent, and the redemption value justifies the build cost. **Recommend ship for launch.**

- **Lufthansa M&M → Week 10-13, deferred past initial launch.** This is the only program in PointSnap's scope where I would recommend a **phased launch**: ship v1 with LH coverage **via partner programs only** (use United, Aeroplan, ANA, Avianca to surface LH metal at the partner-chart prices already known), and defer the direct M&M scraper to a post-launch v1.1. Rationale: (1) the 7,000-mile account warmup is real capex that should be a deliberate decision, not a build-week scramble; (2) the legal posture is the most adversarial of any program and warrants a conversation with counsel before we go live; (3) point.me/Roame already cover this and the marginal user value of *direct* M&M pricing over partner-program inference is moderate, not huge — own-metal F that *only* M&M can book is the unique value, and that's a v1.1 feature flag rather than a launch blocker. (4) If LH sends a C&D in the first month of operation, having M&M direct-scraping live makes that conversation materially worse than if we are only inferring from partner programs.

Neither program is a **hard** launch blocker. Cathay is a *should-ship-at-launch*; Lufthansa direct is a *defensible-defer*. Both belong on the Week-3-to-Week-13 build sequence with Cathay in the upper-middle and Lufthansa at the tail.

---

### Sources

- [GitHub: flightplan-tool/flightplan](https://github.com/flightplan-tool/flightplan)
- [GitHub: lg/awardwiz](https://github.com/lg/awardwiz)
- [GitHub: NikolaiT/stealthy-scraping-tools — lufthansa-de.py](https://github.com/NikolaiT/stealthy-scraping-tools/blob/main/lufthansa-de.py)
- [Greasyfork: Cathay Award Search Fixer 2022](https://greasyfork.org/en/scripts/449998-cathay-award-search-fixer-2022)
- [Suitesmile: How To Fix Broken Cathay Pacific Asia Miles Award Booking Engine](https://suitesmile.com/blog/2022/10/07/how-to-fix-broken-cathay-pacific-asia-miles-award-booking-engine/)
- [Verylvke: Batch search Cathay Pacific award availability](https://www.verylvke.com/en/2022/11/21/batch-search-cathay-pacifics-award-availability/)
- [Verylvke: Guide on redeeming Lufthansa Miles & More awards](https://www.verylvke.com/en/2025/12/24/guide-on-redeeming-lufthansa-miles-more-awards/)
- [dev.to: Reverse Engineering Cathay Pacific's Seat Selection Page](https://dev.to/henrylim96/reverse-engineering-cathay-pacifics-seat-selection-page-43od)
- [Akamai: Lufthansa Customer Story](https://www.akamai.com/resources/customer-story/lufthansa)
- [FlyerTalk: Miles & More award search unusable due to Akamai](https://www.flyertalk.com/forum/lufthansa-austrian-swiss-brussels-lot-other-partners-miles-more/2209752-miles-more-award-search-unusable-due-akamai.html)
- [FlyerTalk: Huge v3 update for the Unelevated CX Award Search Super Plugin](https://www.flyertalk.com/forum/cathay-pacific-cathay/2104700-huge-v3-update-unelevated-cx-award-search-super-plugin.html)
- [FlyerTalk: 7000 Lufthansa Miles & More points required](https://www.flyertalk.com/forum/lufthansa-austrian-swiss-brussels-lot-other-partners-miles-more/2073599-7-000-lufthansa-miles-more-points-you-account-check-awards.html)
- [Lufthansa Group: NDC Partner Program — Direct API](https://lhgroupairlines.com/ndc/en/ndc-solutions/ndc-direct-api)
- [Cathay Pacific Developer Portal (NDC)](https://developers.cathaypacific.com/)
- [One Mile at a Time: Lufthansa Miles & More Dynamic Award Pricing](https://onemileatatime.com/news/lufthansa-miles-more-dynamic-award-pricing/)
- [One Mile at a Time: Airlines Try To Shut Down Websites Scraping Award Seats](https://onemileatatime.com/news/airlines-shut-down-websites-scraping-awards/)
- [One Mile at a Time: How To Redeem Miles For Lufthansa First Class](https://onemileatatime.com/guides/redeem-miles-lufthansa-first-class/)
- [Upgraded Points: Lufthansa Miles & More Devaluation, Dynamic Pricing](https://upgradedpoints.com/news/lufthansa-miles-more-devaluation-dynamic/)
- [Upgraded Points: Cathay Pacific Award Chart Changes (April 2025)](https://upgradedpoints.com/news/cathay-pacific-award-chart-changes-april-2025/)
- [Award Wallet: Cathay Elite Program Changes 2026/2027](https://awardwallet.com/news/airlines/cathay-elite-program-changes-2026/)
- [Award Wallet: Miles & More Devaluation, Dynamic Pricing, Award Chart Changes](https://awardwallet.com/blog/miles-more-2025-award-chart-changes/)
- [Award Wallet: With Lufthansa Restricting First Class Partner Awards](https://awardwallet.com/blog/lufthansa-restricting-first-class-partner-awards/)
- [Mainly Miles: Cathay Pacific hikes fuel surcharges (March 2026)](https://mainlymiles.com/2026/03/27/cathay-pacific-hikes-fuel-surcharges-again/)
- [Roame: Lufthansa Miles & More award flight tool](https://roame.travel/guides/lufthansa-miles-more)
- [Roame: Cathay Pacific Award Finder](https://roame.travel/guides/cathay-pacific-award-finder)
- [seats.aero: Lufthansa First Class Finder](https://seats.aero/firstclass)
- [Proskauer: Another Web Scraping Dispute Focused on Travel Data (Air Canada v. seats.aero)](https://www.proskauer.com/blog/another-web-scraping-dispute-focused-on-travel-data)
- [Scrapfly: How to Bypass Akamai when Web Scraping (2026)](https://scrapfly.io/blog/posts/how-to-bypass-akamai-anti-scraping)
- [Prince of Travel: 7 Brilliant Redemptions with Cathay Pacific Asia Miles](https://princeoftravel.com/guides/7-brilliant-redemptions-with-cathay-pacific-asia-miles/)
- [Prince of Travel: The Complete Guide to Lufthansa First Class](https://princeoftravel.com/airlines/lufthansa-first-class/)
- [WellTraveledMile: Lufthansa Miles & More Stopover & Open Jaw Rules](https://welltraveledmile.com/lufthansa-miles-more-basics-part-4-stopover-open-jaw-rules/)
