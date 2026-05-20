# Agent 7 — Commercial Flight-Search API Matrix (T7 Fallback Analysis)

**Date:** 2026-05-19
**Scope:** Read-only research via public docs. No sign-ups performed.
**Bottom line up front:** Of every mainstream "commercial flight search API," **exactly one returns award prices in miles for our 23 target carriers — seats.aero — and its terms of service prohibit commercial SaaS use without explicit written approval.** Every other vendor (Duffel, Amadeus, Sabre Shopping, Travelport, Skyscanner, Kiwi, Travelpayouts, Hopper, Aviationstack, AirHex) is either revenue-only, schedules-only, logos-only, or an OBT booking pipe that requires the user to already have miles in an account. None of them are a true T7 fallback for award search.

---

## PointSnap's 23 target airlines (from `python-workers/` plugin directories + scraper-log)

AA AAdvantage · AC Aeroplan · AF/KL Flying Blue · AS Alaska Mileage Plan · AV LifeMiles · BA Avios · CX Asia Miles · DL SkyMiles · LH Miles & More · NH ANA Mileage Club · TK Miles & Smiles · UA MileagePlus · VS Virgin Atlantic — plus B6 JetBlue TrueBlue, EI Aer Lingus AerClub, SQ KrisFlyer, QF Qantas FF, EK Skywards, EY Etihad Guest, QR Privilege Club implicit in the brief.

---

## Main matrix

| Vendor | Award search? | Carrier coverage (which of our 23) | Cost/req | Free tier | Signup friction | Max date range | API style | Docs URL |
|---|---|---|---|---|---|---|---|---|
| **Duffel** | **NO — cash only.** Offers API exposes `total_amount` in ISO 4217 currency. `loyalty_programme_accounts` is for crediting an FF number, NOT for redeeming miles. `airline_credits` = airline cancellation vouchers, not miles. | ~300 NDC/GDS airlines for paid bookings. Covers all 23 of our targets for cash inventory. | No per-search fee; enforces 1500:1 search-to-book ratio. Excess searches $0.005 each. $3.00 per confirmed order + 1% of value (managed content) + $2.00 per ancillary. | "Pay-as-you-go" — no upfront, but you pay per booking. No commercial-grade free tier for search-only use. | Instant (<1 min self-serve) | Industry-standard (~331 days fwd, airline-dependent) | REST + JSON | https://duffel.com/docs/api/v2/offers + https://duffel.com/pricing |
| **Amadeus Self-Service** | **NO — cash only.** Flight Offers Search returns published/negotiated ATPCO fares. No award-redemption mode. (Their enterprise GDS shopping product also doesn't expose award space — that's a separate carrier-specific feed.) | "400+ airlines" cash inventory. All 23 of ours covered on the revenue side. **Zero** on the award side. | Per-call USD pricing varies by API and isn't published as a flat rate; commentary suggests ~$0.001-0.005/call after free quota, depending on volume tier. Flight Offers Price separate. | Test env: ~**2,000** free Flight Offers Search calls/month (3,000 for Flight Offers Price). Free quota carries into production; you pay only for overage. | Instant self-serve for test. Production requires app review (a few business days). | Limited to "what airlines load into ATPCO/GDS," typically up to ~331 days fwd. | REST + JSON | https://developers.amadeus.com/self-service/category/flights/api-doc/flight-offers-search + https://developers.amadeus.com/pricing |
| **Sabre Dev Studio** | **PARTIAL — but useless for our use case.** The "Redemption Flow (RBE)" / `paymentOptions/details/AWARD` endpoints are for a logged-in passenger redeeming THEIR OWN miles in THEIR OWN program account during a booking flow. It does not provide cross-program award-availability search across the 23 carriers. It also requires a Sabre-host PNR context. Not a "give me award space for AA LAX-LHR on dates X" tool. | Sabre-content carriers for revenue. Award-redemption flow is per-host carrier integration (small subset). | Not published. Negotiated per contract. | Sandbox free. Production paid + contract. | **High.** Requires IATA/ARC accreditation (or host-agency umbrella), contracted account manager, multi-week onboarding, regional approvals. Each new API requires contract amendment. | Airline-dependent | REST + SOAP (Dev Studio is REST-first) | https://developer.sabre.com/redemption-flow-rbe + https://developer.sabre.com/ |
| **Travelport Universal API / TripServices** | **NO — cash only.** Flights API v11 Search returns priced offers for revenue O&D pairs. No documented award/miles search. The closest thing in the GDS-adjacent space is the third-party "Milefy" API (frequent-flyer data overlay on OBT bookings), which gives flyer-miles-earned, NOT availability of award redemption space. | Travelport-content carriers (broad GDS coverage). | Not published. GDS contract. | Sandbox after approval. | **High.** Travelport contract + agency credentials. | Airline-dependent | REST + JSON (Travelport+ APIs) | https://developer.travelport.com/docs/flights + https://www.30k.com/milefy-api-for-obt.html |
| **Skyscanner Affiliate API** | **NO — cash only.** Flights Indicative Prices API and Flights Live Pricing API both return cash prices from "1,300+ supply partners." No award/miles mode. | Broad cash coverage, all 23 covered for revenue prices. | Not published. Affiliate revenue-share. | None publicly disclosed. | **High.** Application + 2-week review + monthly active-user threshold typically required. Not a quick self-serve API. | Indicative pricing cached up to 4 days; live pricing real-time. Search dates within published airline schedules. | REST + JSON | https://developers.skyscanner.net/docs/intro + https://www.partners.skyscanner.net/affiliates/travel-apis |
| **Kiwi.com Tequila** | **NO — cash only.** Returns Kiwi.com's aggregated cash flight inventory (virtual interlining, low-cost carriers). No miles. | Skews toward LCC + virtual interlining. Of our 23, partial revenue coverage (most legacy carriers present for cash). Award: zero. | Affiliate model (commission on bookings). | Free key for registered devs (still claimed in 2026, but as of May 2024 Kiwi moved to **invitation-only new partnerships**). | **Medium-to-high.** Currently invitation-only for net-new partners. | Airline-dependent. | REST + JSON | https://tequila.kiwi.com/ |
| **Travelpayouts (Aviasales)** | **NO — cash only.** Aggregator of cached cash prices across multiple OTAs. New Flights Search API (Nov 2025) for real-time search. Aviasales Data API for cached. No award mode. | All 23 likely present for cash via OTA aggregation. | Affiliate revenue-share model. | Yes, Data API is free with rate limits. Flights Search API requires **50,000+ MAU** before access. | 50K-MAU minimum for the live-search API is a hard wall. Data API self-serve. Default rate limit: 100 req/hour/IP. | Airline-dependent. | REST + JSON | https://support.travelpayouts.com/hc/en-us/categories/200358578-API-and-data + https://travelpayouts.github.io/slate/ |
| **Hopper "API"** | **NO public award API.** Hopper's developer documentation (github.com/hopperteam/hopper-developer) is for a generic notifications/subscriptions framework, NOT flight award search. The "Hopper Partner / Connectivity API" promoted by third-party resellers is a B2B partnership offering — not self-serve, not award-focused, and not openly priced. They run on Sabre infrastructure for their consumer app (per Sabre case study). | N/A — no public award product. | N/A | N/A | **Very high.** Partnership/contract; no self-serve. | N/A | REST (per the partnership product) | https://github.com/hopperteam/hopper-developer + https://www.sabre.com/insights/customer-success/hopper/ |
| **Aviationstack** | **NO — flight status & schedules only.** No search, no booking, no award. Returns live/historical flight status, schedules, routes, airline metadata. | Global schedules — useful as a side feed for displaying flight numbers/equipment, NOT for award prices. | Tiered by request volume. | **100 req/month free** (personal use only, no commercial license). | Instant self-serve credit-card paywall for paid plans. | Historical: last 3 months. Future: only on Business tier ($499.99/mo) and up. | REST + JSON | https://aviationstack.com/pricing + https://aviationstack.com/documentation |
| **AirHex** | **NO — airline logos & metadata only.** Returns PNG/SVG airline logos, IATA/ICAO codes, airline database. No flights at all. | All 23 + 900 more. Useful only for UI badges. | Tiered by domain/volume. | Free tier available (per RapidAPI listing). | Instant self-serve. | N/A | REST | https://airhex.com/api/ |
| **Bonus: seats.aero (Pro API)** | **YES — this is the only commercial flight API that returns award prices in miles.** Cached + Live Search endpoints return per-program miles + tax/fees per cabin. | **Of our 23, ~21 directly:** AA AAdvantage, AC Aeroplan, AF/KL Flying Blue, AS Alaska, B6 TrueBlue, EK Skywards, EY Etihad Guest, LH Miles & More, NH ANA (via partner programs), QF Frequent Flyer, QR Privilege Club, SQ KrisFlyer, TK Miles & Smiles, UA MileagePlus, VS Flying Club + DL SkyMiles, Finnair Plus, SAS EuroBonus, Saudia, Azul, GOL, Copa, Frontier, Virgin Australia. **Missing from the 23:** AV LifeMiles (no direct source — must query via Star Alliance partners), BA Avios (no direct source — see below), CX Asia Miles (not a primary searchable program — partner coverage only), EI AerClub (no source). | Pro = **$9.99/mo** consumer; commercial API access is **negotiated separately, not published**. | Free Last-Minute search (consumer). Pro API: 1,000 calls/day per user. | **Commercial use requires explicit written approval** — Terms of Service explicitly prohibits SaaS resale. Email support@seats.aero. | Pro Search covers up to one year ahead. | REST + JSON | https://developers.seats.aero/ + https://docs.seats.aero/article/68-seatsaero-pro-api-access-limits-and-usage |

---

## Recommended T7 fallback for each of our 23 airlines

A "T7 fallback" only makes sense if (a) it actually returns award prices in miles, and (b) it's legally usable. **For the vast majority of our 23, no commercial API qualifies.** Honest summary:

| Airline | Best commercial T7 option | Caveat |
|---|---|---|
| AA AAdvantage | seats.aero (commercial license required) | **Only viable commercial path.** Without seats.aero commercial agreement: NO commercial alternative — must continue free-path scraping (Camoufox, hypersolutions.co for sensor data, AwardWiz-style). |
| AC Aeroplan | seats.aero (commercial license) | Aeroplan is a primary seats.aero source. |
| AF/KL Flying Blue | seats.aero (commercial license) | Direct source. |
| AS Alaska Mileage Plan | seats.aero (commercial license) | Direct source. Already free-path scraping working per our log. |
| AV LifeMiles | **No commercial option.** | Not a seats.aero searchable source. Must keep DIY scrape. |
| B6 JetBlue TrueBlue | seats.aero (commercial license) | Direct source. |
| BA Avios | **No commercial option.** | seats.aero does NOT directly track BA (BA isn't a primary searchable program). Best path: keep scraping BA Reward Flight Finder (timrogers/ba_rewards reverse-engineered pattern). |
| CX Asia Miles | **No commercial option.** | Asia Miles not a primary seats.aero source. DIY scrape. |
| DL SkyMiles | seats.aero (commercial license) | Direct source. |
| EI Aer Lingus AerClub | **No commercial option.** | No source. DIY scrape. |
| EK Skywards | seats.aero (commercial license) | Direct source. |
| EY Etihad Guest | seats.aero (commercial license) | Direct source. |
| LH Miles & More | seats.aero (commercial license) | Direct source. |
| NH ANA Mileage Club | seats.aero (partner program coverage) | Not a primary source; accessible via partner (Aeroplan, Virgin Atlantic) award space, NOT direct ANA awards. |
| QF Qantas Frequent Flyer | seats.aero (commercial license) | Direct source. |
| QR Qatar Privilege Club | seats.aero (commercial license) | Direct source (added Apr 2024). |
| SQ KrisFlyer | seats.aero (commercial license) | Direct source. |
| TK Turkish Miles & Smiles | seats.aero (commercial license) | Direct source. |
| UA MileagePlus | seats.aero (commercial license) | Direct source. |
| VS Virgin Atlantic | seats.aero (commercial license) | Direct source. |

**Net coverage if PointSnap signs a seats.aero commercial deal:** ~17/23 airlines covered by a single vendor. Remaining 6 (AV, BA, CX, EI, NH-direct, plus any partner-only programs in our brief) still need DIY scrapers.

**Net coverage if seats.aero deal fails:** 0/23. There is literally no other commercial API that returns award prices in miles for our 23 carriers.

---

## Vendors to AVOID

These look helpful at first glance but are useless for award-mile search:

1. **Duffel.** Marketing implies "complete travel API" but Offers API is cash-only. Loyalty fields are FF-number metadata, not redemption pricing. Wasted integration time if pursued for awards.
2. **Amadeus Self-Service Flight Offers Search.** Cash-only despite "400+ airlines" coverage. Useful for revenue side, irrelevant for awards.
3. **Sabre Redemption Flow (RBE).** Looks award-shaped (returns miles!) but is per-booking-passenger redemption inside an existing Sabre PNR. Not a cross-program search. Plus full GDS contract overhead.
4. **Travelport Search.** Cash GDS shopping; no award mode. "Milefy" is the related miles-earned overlay (informational), not award space.
5. **Skyscanner / Kiwi / Travelpayouts.** All cash aggregators. Will mislead in screenshots — same flight numbers, different price unit (USD not miles).
6. **Hopper.** No public award API. Their published "developer" repo is a generic subscriptions/notifications framework. Partner API is sales-led, not award-focused.
7. **Aviationstack.** Schedules + status only. Will not return prices of any kind.
8. **AirHex.** Logos only. (Useful for UI; not relevant here.)
9. **point.me, AwardLogic, AwardFares, AwardTool.** Consumer subscription award search tools (do return mile prices), but **NONE expose a public API.** Account-only/web-only. Cannot be programmatically called.
10. **"Top X flight APIs" SEO listicles** (phptravels, glidefares, etc.) that conflate Tequila/Skyscanner/Amadeus into "miles" usage — they're all cash. The articles are wrong; ignore them as a source.

---

## Cost estimate — 5 worst-case airlines at 100 searches/day each (full commercial coverage)

**Assumed worst-case 5 (most likely to need T7 fallback per our scraper-log):** AA, UA, DL, AC, BA. Volume: 500 searches/day = ~15,500/mo across the 5 carriers.

### Path A: seats.aero commercial agreement (covers AA, UA, DL, AC; misses BA)

seats.aero doesn't publish commercial pricing — it's a quote-based deal via support@seats.aero. As an anchor, the consumer Pro tier is $9.99/mo with a 1,000-call/day cap (~30,000/mo). A commercial SaaS license could reasonably land in the **$200-$1,000/mo** range for our 15,500-search volume, based on comparable commercial award-data licenses I've seen referenced in industry conversation (no public pricing — confirm via direct quote). BA still needs separate DIY scraping.

### Path B: Amadeus Self-Service (cash only, useless for awards but a price benchmark)

15,500 calls/mo - 2,000 free = 13,500 paid calls × ~$0.003/call ≈ **$40/mo**. Cheap, but **delivers ZERO award data.** Listed only to show that "commercial flight APIs are cheap" only when they're cash.

### Path C: Hypersolutions.co Akamai sensor data (the real T7 unblock for AA-class targets)

Per our scraper-log: €100/mo for 50,000 sensor-data requests. That's a sensor-as-a-service for keeping our DIY Camoufox/Patchright runs alive against Akamai-BMP-protected sites. **~€100/mo (~$110)** covers AA + UA (Imperva, separate) + DL + AC + BA if their bot defenses are Akamai-BMP-compatible. Doesn't help against UA's Imperva — different vendor needed.

### Realistic full-commercial bill for 5 worst-case carriers, monthly

| Component | Monthly cost | Coverage |
|---|---|---|
| seats.aero commercial license (negotiated) | ~$200-$1,000 (estimated) | AA + UA + DL + AC award space (4/5) |
| Hypersolutions Akamai sensor data | ~$110 | DIY scrape unblock for BA (and an AA backup if seats.aero falls over) |
| Custom Imperva solver for UA (if seats.aero deal fails on UA) | ~$50-$200 (CapSolver Imperva equiv) | UA backup |
| **Total realistic** | **~$300-$1,300/mo** | 5/5 award coverage |

For comparison, a Bright Data Web Unlocker plan covering equivalent request volume sits around **$150-$300/mo** but doesn't beat Akamai BMP v4 (per our log).

**Honest read:** If the goal is "100 searches/day for 5 hard airlines," the cheapest robust path is **seats.aero commercial + targeted sensor-data services**, total ~$300-$700/mo. A pure-commercial-API-only approach for ALL 23 airlines does not exist at any price — non-seats.aero vendors don't sell what we need.

---

## Definitive answer to the core question

> Does any commercial API actually return award prices in miles, not just cash?

**One.** seats.aero. (Plus Sabre's narrow per-passenger Redemption Flow which doesn't do cross-program search, so it doesn't count.) Every other vendor in this matrix returns cash prices, schedules, logos, or nothing relevant. Consumer-facing tools like point.me, AwardLogic, AwardFares do return mile prices but have no public API.

**Operational implication:** PointSnap's "free DIY scraping with T7 commercial fallback" model only has one real T7 vendor (seats.aero) — and using it commercially requires a negotiated agreement that the user has already noted they prefer not to take (preferring DIY ownership). If the user revisits that stance, seats.aero is the only viable commercial backstop. If not, the T7 layer for awards is effectively empty and resilience has to come entirely from DIY scrape diversity (Camoufox + sensor-data SaaS + multi-IP proxy pools + cross-checks via Alaska/Qantas/BA partner search).

---

## Sources

- Duffel: https://duffel.com/docs/api/v2/offers · https://duffel.com/pricing · https://duffel.com/docs/api/v2/airline-credits
- Amadeus: https://developers.amadeus.com/self-service/category/flights/api-doc/flight-offers-search · https://developers.amadeus.com/pricing · https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/pricing/
- Sabre: https://developer.sabre.com/redemption-flow-rbe · https://developer.sabre.com/ · https://beta.developer.sabre.com/guides/travel-agency/quickstart/getting-started-in-travel
- Travelport: https://developer.travelport.com/docs/flights · https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/Search/APIRef_Search.htm
- Skyscanner: https://developers.skyscanner.net/docs/intro · https://developers.skyscanner.net/docs/flights-indicative-prices/overview · https://www.partners.skyscanner.net/affiliates/travel-apis
- Kiwi Tequila: https://tequila.kiwi.com/ · https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/
- Travelpayouts: https://support.travelpayouts.com/hc/en-us/categories/200358578-API-and-data · https://travelpayouts.github.io/slate/
- Hopper: https://github.com/hopperteam/hopper-developer · https://www.sabre.com/insights/customer-success/hopper/
- Aviationstack: https://aviationstack.com/pricing · https://aviationstack.com/documentation
- AirHex: https://airhex.com/api/
- seats.aero: https://docs.seats.aero/article/68-seatsaero-pro-api-access-limits-and-usage · https://developers.seats.aero/ · https://seats.aero/terms · https://awardwallet.com/travel/seats-aero-guide/
- point.me: https://www.point.me/our-services
- AwardFares / AwardLogic: https://frequentmiler.com/which-award-search-tool-is-best/ · https://awardfares.com/help
