# Agent 8 — Partner-Search Backdoor Coverage Map

**Date:** 2026-05-19
**Scope:** Read-only research on which alliance hubs and bilateral partners can be used as **cross-checks** (not primary sources) against PointSnap's direct scrapes.
**Decision context:** User vetoed partner-airline backdoors as PRIMARY data ("Alaska doesn't show every American flight" — incomplete). Backdoors retained only for **corroboration**: if AA direct returns rows AND BA Avios shows the same flight at the same time, that's signal. Map below identifies who can corroborate whom.

---

## 1. Hub-by-hub coverage notes

### 1.1 United MileagePlus (united.com) — Star Alliance hub
- **Online-searchable Star Alliance partners:** AC, NH, OZ, OS, SN, CA, ZH, NZ, A3, CM, OU, ET, MS, EW, LO, LH, LX, SQ, TP, TG, TK, EVA (BR), SK (SAS — exited Star Alliance Sept 2024, moved to SkyTeam; UA still searches them as a bilateral). UA also lists ~12 non-alliance bilaterals (e.g. AS, HA, EY) but most non-Star partners are NOT searchable on united.com — phone only.
- **Coverage quality:** Excellent for Star Alliance. UA exposes saver-class only to partners (extra space released to UA elites/cardholders is NOT bookable via partner programs). Searching **logged-out** is recommended to filter out UA-only inventory and see what's actually partner-bookable. (TPG, NerdWallet)
- **Latency:** ~3-6 s for typical city-pair. SLA generally healthy.
- **Login required:** No (search is open). Login needed only for booking.
- **Source:** Upgraded Points "Best ways to search Star Alliance availability," NerdWallet "How to find United Saver awards."

### 1.2 British Airways Executive Club (ba.com) — oneworld hub
- **Online-searchable partners:** AA, CX, JL, IB, MH, QF, QR, RJ, AY, LATAM (LA), AT, S7, BA-affiliate Vueling, plus alliance partners SriLankan (UL), Fiji Airways (FJ).
- **NOT online:** **Aer Lingus (EI) and Alaska Airlines (AS)** — non-alliance Avios partners; award space displayed online for NEITHER; phone-only booking. (TPG: "Award inventory on the program's two non-alliance partners — Aer Lingus and Alaska Airlines — is not displayed online.")
- **Coverage quality:** Among the best for oneworld; BA's "Reward Flight Finder" surfaces 355-day calendars. AA inventory shown on ba.com is generally what AA actually releases to oneworld partners (AA's published "MileSAAver" buckets), not AA-only Web Specials.
- **Latency:** Can be flaky; calendar view sometimes times out and needs a refresh.
- **Login required:** Yes — must be logged into BAEC to see Avios prices and "Reward" toggle. Can search availability without login but no pricing.
- **Source:** TPG "Booking partner award flights using BA Avios," AwardWallet "How to search/book BA Avios."

### 1.3 Air Canada Aeroplan (aircanada.com / aeroplan.com) — Star Alliance hub
- **Online-searchable partners:** ~45–52 partners total (25 Star Alliance + ~27 non-Star). Star Alliance fully online. **Non-Star bilaterals online:** Emirates (EK), Etihad (EY), Oman Air (WY), Gulf Air (GF), Air Mauritius (MK), Bahamasair (UP), Azul (AD), Air Inuit, Bearskin, Canadian North, Calm Air, PAL Airlines, Porter (PD), and others.
- **Not online / phone only:** A few small regionals. Etihad availability online is partial — short-haul yes, complex long-haul multi-segment routings sometimes not displayed even though bookable by phone.
- **Coverage quality:** Best non-Star partner search engine in the industry. **As of Mar 25 2025, dynamic pricing was introduced for EK, UA, EY** — points cost varies; chart no longer authoritative for those three.
- **Latency:** Fast (~2-4 s). Calendar view excellent.
- **Login required:** No to search, yes to price (logged-out shows generic prices).
- **Source:** Flytrippers "Aeroplan airline options," AwardWallet "50 Aeroplan partners," One Mile at a Time "Aeroplan dynamic pricing changes."

### 1.4 Delta SkyMiles (delta.com) — SkyTeam hub
- **Online-searchable SkyTeam partners:** AF, KL, VS, AM, AR, AZ (ITA), KE (partial — see below), MU, GA, SV, KQ, ME. Plus non-SkyTeam joint-venture partners: WestJet (WS), LATAM (joint venture).
- **NOT online (or partial):** **Korean Air (KE)** award availability **cannot be searched on delta.com** — phone-only (Delta SkyMiles agent). MU and GA show on delta.com but availability is widely reported as incomplete vs. what those carriers expose to other SkyTeam programs. (TPG: "Korean Air award availability can't be searched on Delta's website")
- **Coverage quality:** Generally accurate for AF/KL/VS/AM. Notoriously incomplete for KE (which has historically restricted partner inventory to Korean's own metal). MU partial. Dynamic pricing applies to DL own metal — DL never shows charted pricing for own flights.
- **Latency:** Very fast (~2 s). Excellent calendar view.
- **Login required:** No.
- **Source:** TPG "Best websites for searching SkyTeam availability," FlyerTalk thread on DL→MU bookings.

### 1.5 Air France/KLM Flying Blue (flyingblue.com) — SkyTeam hub
- **Online-searchable SkyTeam partners:** AF, KL, DL, KE, VS, MU, KQ, CI (China Airlines), AZ (ITA), AM, AR, GA, SV, ME, SU (Aeroflot — sanctioned, may be removed).
- **NOT online or partial:** Some smaller regionals phone-only. Flying Blue significantly improved its calendar view in 2024 — now shows monthly grid for AF/KL/DL plus several partners.
- **Coverage quality:** Strong for SkyTeam. **AF/KL/DL** are most reliable. **KE** has historically restricted partner inventory; Flying Blue shows whatever KE releases but it's thin. Flying Blue Promo Rewards (monthly) are own-metal only.
- **Latency:** Moderate (3-5 s).
- **Login required:** Yes — must be logged in to Flying Blue to see partner pricing in miles. Award calendar requires login.
- **Source:** Upgraded Points "Flying Blue partner award calendar improvement," TPG "Ultimate guide to Flying Blue."

### 1.6 Cathay Pacific Asia Miles (cathaypacific.com) — oneworld hub
- **Online-searchable partners (as of Q1 2025):** AA, AS, BA, CX, FJ, AY, IB, JL, LA (LATAM), MH, QF, plus newer additions **Air Canada and Lufthansa** added Q1 2025. Air China (CA) also bookable online.
- **NOT online (phone / "Flight Award Request Form"):** QR (Qatar), RJ, S7, oneworld connect smaller carriers, some non-alliance partners like Vistara (UK), Bangkok Airways.
- **Coverage quality:** Greatly improved 2024-2025. AA flights now online. Coverage shows Asia Miles' allotment, not necessarily ALL inventory AA releases to oneworld. JL is well-covered including the prized T-360 first-class window.
- **Latency:** Moderate. Site occasionally returns "no results" for valid routes — manual retry needed.
- **Login required:** Yes for pricing in miles; can browse without login but no Asia Miles cost.
- **Source:** AwardWallet "New: book American Airlines flights with Asia Miles online," The Points Guy Cathay Pacific Asia Miles guide.

### 1.7 Qantas Frequent Flyer (qantas.com) — oneworld hub
- **Online-searchable partners:** AA, BA, AY, IB, JL, CX, MH, QR, RJ, SriLankan (UL), Fiji Airways (FJ), Alaska Airlines (AS), LATAM (LA — limited), plus non-alliance bilaterals **Emirates (EK)**, **China Eastern (MU)**, **China Airlines (CI)**, **Bangkok Airways (PG)**, **Air New Zealand (NZ — limited tasman trans-tasman)**, Jetstar (3K/JQ).
- **Coverage quality:** Best oneworld engine for South Pacific / Asia routings. EK award space well-displayed (Qantas-EK is a deep JV). Qantas RTW (oneworld RTW Classic Reward) bookable online via multi-city flow. Note: as of Feb 18 2026, only Qantas Silver+ status can book Emirates First-class reward seats.
- **Latency:** Fast (~3 s).
- **Login required:** Yes — Qantas FF login required to see reward inventory.
- **Source:** Qantas help pages, Qantas FF Emirates partner page, Point Hacks.

### 1.8 Virgin Atlantic Flying Club (virginatlantic.com) — alliance-independent
- **Online-searchable partners:** VS, **DL** (short-haul intra-US, plus long-haul to Europe/Asia-Pacific/Africa/South America generally online — TPG: "fairly easy to find and bookable online"), Air France (AF), KLM (KL), Korean Air (KE) — partial; Hawaiian (HA) — partial.
- **NOT online (phone only):** **ANA (NH)** — phone booking required (Virgin's marquee sweet-spot redemption). Also phone-only: Air New Zealand (NZ), South African Airways (SA), Singapore Airlines (SQ — limited; partnership ended for most routes 2023).
- **Coverage quality:** DL inventory is decent but ANA — Virgin's most-loved redemption — is offline. **Workaround used by community: search ANA inventory on UA or NH itself, then call Virgin to book.** This is the canonical "two-hub cross-check" pattern.
- **Latency:** Moderate. Site sometimes returns false negatives — phone agents find space the site doesn't.
- **Login required:** No.
- **Source:** TPG "Which Virgin Atlantic Flying Club partner redemptions can be booked online?", Head For Points "How to use Virgin Points to fly on ANA."

### 1.9 Singapore KrisFlyer (singaporeair.com) — Star Alliance hub
- **Online-searchable partners (since Dec 7 2017 expansion):** All Star Alliance — UA, AC, NH, LH, LX, OS, SN, SK, TK, EVA (BR), TG, A3, CM, NZ, OZ, ZH, CA, ET, MS, ITA, LO, TP, SA. **Air India (AI) is offline-only** for both availability and booking.
- **Cannot book online:** ANA **domestic** flights in Japan (international ANA fine).
- **Coverage quality:** Strong for SQ own-metal (which has the most generous own-program release of any Star carrier). Partner inventory mirrors what each carrier releases to Star. KrisFlyer's "Spontaneous Escapes" monthly promo is own-metal only.
- **Latency:** Fast.
- **Login required:** Yes for mile pricing.
- **Source:** Mainly Miles "Which Star Alliance & partner airlines can you book online using KrisFlyer miles?", TPG.

### 1.10 Avianca LifeMiles (lifemiles.com) — Star Alliance hub
- **Online-searchable partners:** All Star Alliance via the engine's "Star Alliance" filter; **also has individual-airline dropdown** that often surfaces space not shown under the generic Star filter (the canonical "hidden LifeMiles availability" trick). Plus non-Star bilaterals: GOL (G3), Iberia (IB — partial), Clic Air, AeroITALIA.
- **Coverage quality:** Has historically shown MORE Star Alliance space than UA in some cases due to relaxed partner inventory queries; but also notorious for **phantom availability** — shows space that fails at booking. Frequent Miler "Finding hidden LifeMiles award availability" documents the per-airline dropdown trick.
- **Latency:** Slow, often timeouts. Booking flow notoriously fragile.
- **Login required:** No to search; yes to book.
- **Source:** TPG "Use this trick to find hidden LifeMiles award space," Frequent Miler.

### 1.11 Alaska Mileage Plan / Atmos Rewards (alaskaair.com) — alliance-independent post-2024
- **As of Sept 2025: program is now Atmos Rewards** (Alaska + Hawaiian merged loyalty).
- **Online-searchable partners (Atmos Rewards):** ~31 global partners. Includes oneworld members **AA, BA, CX, JL, QR, AY, IB, MH, RJ, FJ, QF, LATAM** (AS rejoined oneworld 2021), plus Singapore Airlines (SQ — added 2024), Icelandair (FI), STARLUX (JX), and the merged Hawaiian (HA) network. **As of Aug 2025, mixed-partner award itineraries supported online.**
- **NOT online:** Some smaller partners phone-only. KE (Korean) historically offline.
- **Critical caveat for cross-checks:** AS has historically displayed only a **subset** of partner inventory. AS shows what AS allocates from its own award buckets; not the full partner-released inventory. User-cited reason for vetoing AS as primary AA cross-check: "Alaska doesn't show every American flight."
- **Coverage quality:** Good for CX, JL, QR. Spotty for AA (incomplete). Good for HA post-merger.
- **Latency:** Fast.
- **Login required:** No to search, yes to book.
- **Source:** AwardWallet "Atmos Rewards mixed partner award bookings," NerdWallet Alaska partners guide.

### 1.12 Lufthansa Miles & More (miles-and-more.com) — Star Alliance hub
- **Online-searchable partners:** Most Star Alliance — UA, AC, NH, TK, LH, LX, OS, SN, A3, TP, EVA (BR), SQ (partial), CA (partial). **Singapore Airlines, Air Canada, and Cathay Pacific (non-Star bilateral) availability is often NOT shown online** — phone hotline required.
- **Coverage quality:** Weak for the three above; otherwise OK for the LH Group (LH/LX/OS/SN) and immediate Star partners. LH's own-metal pricing went fully dynamic June 3 2025 (premium cabin pricing).
- **Latency:** Slow; site is dated.
- **Login required:** Yes.
- **Source:** Travel-Dealz "Finding M&M availability," Upgraded Points.

### 1.13 (Bonus) ANA Mileage Club (ana.co.jp) — Star Alliance hub
- **Online-searchable partners:** All Star Alliance fully online (widely regarded as the best engine for Star Alliance after UA). One-way awards bookable since June 24 2025.
- **NOT online:** Some smaller regionals; complex stopovers fail at booking even when segments are visible.
- **Coverage quality:** Excellent. Often shows space that UA hides.
- **Login required:** Yes (login required to even search).
- **Source:** Upgraded Points "How to redeem ANA miles."

### 1.14 (Bonus) EVA Air Infinity MileageLands — Star Alliance hub
- **Online-searchable:** All Star Alliance. Fixed regional chart.
- **Coverage quality:** Reasonable but less popular than UA/SQ/NH for cross-check purposes; smaller community knowledge base.
- **Login required:** Yes.

### 1.15 (Bonus) Aer Lingus AerClub (aerlingus.com) — oneworld Avios sibling
- **Bookable partners:** Aer Lingus, BA, IB, Vueling. **Very narrow** — does NOT search broader oneworld inventory. Useless for cross-check beyond intra-IAG.
- **Source:** AwardFares Aer Lingus guide.

### 1.16 (Bonus) Iberia Plus (iberia.com) — oneworld Avios sibling
- **Online-searchable partners:** Full oneworld via Avios — AA, BA, CX, JL, QF, QR, AY, MH, RJ, LATAM. Smaller engine than ba.com but accesses similar inventory pool because both are IAG Avios.
- **Coverage quality:** Approximately mirrors BA's inventory for partners (same Avios currency, similar engine). Useful as a fallback when ba.com is down.
- **Login required:** Yes.

---

## 2. Search hub × partner-airline coverage matrix

**Legend:** ✓ = full online search (saver/partner inventory shown reliably) · 🟡 = partial (some routes, phone-required, or known-incomplete inventory) · ✗ = not searchable on this hub · — = not a partner

Columns are the **carrier whose seats you want to cross-check** (operating metal). Rows are the **mileage program / search engine** you're using to look.

| Search hub ↓ \ Operating carrier → | AA | UA | DL | AC | LH | AF | KL | BA | IB | AY | JL | CX | QF | QR | NH | SQ | EK | EY | KE | TK | EVA | AS | VS | AV | LATAM | AM |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| United (united.com) | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | 🟡¹ | ✗ | ✓ | ✗ | ✗ |
| BA Avios (ba.com) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 🟡² | ✗ | ✗ | ✓ | ✗ |
| Aeroplan (aeroplan.com) | ✗ | ✓³ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓³ | 🟡 | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Delta (delta.com) | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 🟡⁴ | ✗ | ✗ | ✗ | ✓ | ✗ | 🟡 | ✓ |
| Flying Blue (af.com / klm.com) | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 🟡⁴ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ |
| Asia Miles (cathaypacific.com) | ✓⁵ | ✗ | ✗ | ✓⁶ | ✓⁶ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 🟡 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Qantas FF (qantas.com) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Virgin Atlantic (virginatlantic.com) | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗⁷ | ✗ | ✗ | ✗ | 🟡 | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| KrisFlyer (singaporeair.com) | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| LifeMiles (lifemiles.com) | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | 🟡⁸ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Alaska/Atmos (alaskaair.com) | 🟡⁹ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓¹⁰ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Lufthansa M&M (miles-and-more.com) | ✗ | ✓ | ✗ | 🟡¹¹ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 🟡¹¹ | ✗ | ✗ | ✓ | 🟡¹¹ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| ANA Mileage Club (ana.co.jp) | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| EVA Air Infinity MileageLands | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Iberia Plus (iberia.com) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 🟡² | ✗ | ✗ | ✓ | ✗ |

**Footnotes:**
1. UA shows AS as a non-alliance bilateral; coverage is partner-listed but historically thin and prone to "phone only" for non-trivial routings.
2. Aer Lingus and Alaska are the two non-alliance Avios partners and award inventory is **NOT** displayed on ba.com / iberia.com — phone only (TPG).
3. As of Mar 25 2025, Aeroplan moved EK, UA, EY to **dynamic pricing**; still searchable online, but cost varies.
4. Korean Air (KE) availability is **NOT searchable** on delta.com (phone only via DL SkyMiles desk). Flying Blue shows whatever KE releases to partners — historically thin.
5. AA now bookable on cathaypacific.com (Q1 2025 change).
6. Air Canada (AC) and Lufthansa (LH) added as online-bookable on cathaypacific.com in Q1 2025 (non-alliance addition for LH).
7. ANA (NH) on Virgin is the famous sweet-spot, but it's **phone-only**. The standard workaround: search ANA inventory on UA/SQ/NH directly, then call Virgin to book.
8. LifeMiles shows IB as a non-Star bilateral, partial.
9. AS historically shows only a SUBSET of AA inventory (user-cited reason for vetoing AS as primary AA cross-check). Mixed-partner itineraries online since Aug 2025.
10. SQ added to AS/Atmos partners in 2024 (online-bookable).
11. LH M&M does **NOT** reliably display SQ, AC, or CX availability online (phone-required) — Travel-Dealz documents this.

---

## 3. Per-airline cross-check assignment

This table assigns each of PointSnap's 23 target carriers a **primary** and **secondary** backdoor that can corroborate a direct scrape. "PointSnap's 23" = the 13 confirmed launch programs (per `src/db/seed/programs.ts` and HANDOFF.md) + 10 most-discussed Phase 2/3 expansion candidates from competitive teardown (KE, JL, QF, EK, IB, AY, EVA, GA, AM, SAS). Cross-check is chosen on three criteria: (a) cell is ✓ in matrix, (b) hub is independently scrapable / hasn't been deprioritized, (c) inventory exposure is known to be reasonably close to what the operating carrier actually releases.

| Target operating airline | Primary cross-check via | Secondary cross-check via | Notes |
|---|---|---|---|
| **AA (American)** | **BA Avios** (ba.com) | **Qantas FF** (qantas.com) | Both expose AA's oneworld saver allocation. Asia Miles also valid (Q1 2025 addition). AS/Atmos shows only a subset — explicitly vetoed by user. |
| **UA (United)** | **Aeroplan** (aeroplan.com) | **ANA Mileage Club** (ana.co.jp) | Both Star Alliance hubs show UA saver. SQ KrisFlyer also strong. LifeMiles often shows more than UA itself but flaky. |
| **DL (Delta)** | **Flying Blue** (af.com) | **Virgin Atlantic** (virginatlantic.com) | DL is dynamic on own metal — partner programs ALL show DL's allocated SkyTeam buckets, not DL's published own-program prices. Use these only to confirm a seat exists, not the price. |
| **AC (Air Canada)** | **United** (united.com) | **ANA Mileage Club** or **SQ KrisFlyer** | Star Alliance hubs. Aeroplan itself is the operating carrier, so doesn't cross-check itself. |
| **LH (Lufthansa, LH Group: LX/OS/SN)** | **United** (united.com) | **Aeroplan** or **ANA** | All major Star Alliance hubs show LH Group. Note LH own-metal premium went dynamic Jun 3 2025. |
| **AF (Air France) / KL (KLM)** | **Delta** (delta.com) | **Virgin Atlantic** (virginatlantic.com) | All three SkyTeam hubs cross-corroborate well for AF/KL. |
| **BA (British Airways)** | **Qantas FF** (qantas.com) | **Asia Miles** (cathaypacific.com) | Both show oneworld partner inventory for BA. Iberia Plus also viable (uses same Avios pool, so largely redundant with ba.com). |
| **AY (Finnair)** | **Qantas FF** | **BA Avios** | Standard oneworld coverage; both reliable. |
| **JL (Japan Airlines)** | **Qantas FF** | **Asia Miles** (cathaypacific.com) | JL's marquee redemption is via CX at T-360 — Asia Miles is the canonical hub for JL F. BA Avios also good. AA AAdvantage no longer best for JL since AA gates JL space. |
| **CX (Cathay Pacific)** | **Qantas FF** | **BA Avios** | Asia Miles is the operating carrier. AS/Atmos historically excellent for CX (the famous F sweet spot) but limited inventory exposure. |
| **QF (Qantas)** | **Asia Miles** (cathaypacific.com) | **BA Avios** | Qantas is operating carrier. CX exposes QF at decent inventory levels especially in J/F. |
| **QR (Qatar Airways)** | **BA Avios** | **Qantas FF** | Both oneworld hubs; QR is notoriously stingy with partner space, both sources will show the same scarce inventory. |
| **NH (ANA)** | **United** (united.com) | **SQ KrisFlyer** (singaporeair.com) | Both robust Star Alliance hubs for NH. **Aeroplan also excellent.** ANA itself is operating carrier. |
| **SQ (Singapore Airlines)** | **United** (united.com) | **Aeroplan** | SQ tightly controls partner inventory, so both will show only what SQ allocates to Star partners — but they DO show it consistently. Note LH M&M does NOT show SQ reliably. |
| **AV (Avianca)** | **United** (united.com) | **Aeroplan** | LifeMiles is operating carrier. Standard Star Alliance hubs. |
| **TK (Turkish)** | **United** (united.com) | **Aeroplan** | TK's own engine is glitchy; UA / Aeroplan often more reliable views of TK inventory. |
| **VS (Virgin Atlantic)** | **Delta** (delta.com) | **Flying Blue** | Virgin is operating carrier. DL is its closest JV partner and shows VS inventory well. Note: Delta is the user's primary VS partner pair. |
| **EVA (BR) (EVA Air)** | **United** (united.com) | **Aeroplan** | Star Alliance hub coverage solid. |
| **EK (Emirates)** | **Aeroplan** (aeroplan.com) | **Qantas FF** | EK is rarely partner-bookable elsewhere. Aeroplan (dynamic since Mar 2025) and QF (deep JV) are the only two viable backdoors. |
| **KE (Korean Air)** | **Flying Blue** | ✗ **none viable** — secondary is phone-only on every hub | KE restricts partner inventory hard; even Flying Blue shows thin allocation. Delta is phone-only for KE. Listed as "none viable" secondary. |
| **IB (Iberia)** | **BA Avios** | **Qantas FF** | Iberia Plus is its own hub (redundant Avios sibling). BA and QF expose IB's partner space. |
| **GA (Garuda)** | **Delta** (delta.com) | **Flying Blue** | Both SkyTeam hubs show GA but coverage is widely reported as incomplete (GA is one of the more obscure SkyTeam partners). |
| **AM (Aeromexico)** | **Delta** (delta.com) | **Flying Blue** | Strong SkyTeam JV, well-displayed on both hubs. |
| **SK (SAS)** | **United** (united.com — legacy bilateral, since SK left Star Alliance Sept 2024) | **Flying Blue** (SK joined SkyTeam Sept 2024) | SK is mid-transition. Both UA (residual relationship) and AF/KL (new SkyTeam home) currently expose SK. Flying Blue is becoming the canonical source. |

---

## 4. Synthesis — the 5 airlines with NO viable cross-check

Per the matrix and assignments above, the following operating carriers have **either no good backdoor cross-check** or **only phone-only / known-thin backdoors**. PointSnap's direct scrapers must stand alone for these — no triangulation is possible without a paid agent or phone-only redemption.

1. **KE (Korean Air)** — *the worst case.* Delta phone-only, Flying Blue shows only what KE releases (historically thin to non-existent), Virgin's KE partnership is limited. KE tightly hoards inventory for its own SKYPASS members. Triangulation: **NOT possible.** Direct KE scrape would be the only signal — and KE isn't on PointSnap's launch list anyway (deferred to Phase 3 per HANDOFF.md). If/when added, plan for "direct-only" verification regime.

2. **DL (Delta) own-metal pricing** — DL is fully dynamic and partner programs (AF/KL/VS) show only DL's allocated SkyTeam buckets at chart prices, NOT DL's actual dynamic prices to its own members. The seat existence can be corroborated; the price cannot. PointSnap's DL direct scrape is the **only** source for DL own-metal pricing accuracy. **Cross-check is "existence only," not price.** Treat as no-viable-price-cross-check.

3. **GA (Garuda Indonesia)** — listed as partner on SkyTeam hubs (DL, AF/KL) but inventory exposure is widely reported as incomplete; the few cross-checks available routinely contradict the operating carrier's own engine. Community consensus is "if GA matters, call." Not on PointSnap's launch list either. Triangulation: **unreliable** — should be marked "direct-only" if added.

4. **AS (Alaska / Atmos Rewards)** — peculiar because AS itself is a hub, but as an *operating* carrier, AS shows up on BA Avios and Qantas with the "phone only" caveat (BA/IB) or partial coverage. AS's own engine returns the most complete picture of AS-operated metal, but cross-checking AS-operated routes against a partner program is largely unhelpful — partners don't reliably show AS inventory. **Direct scrape is canonical;** cross-check at best confirms existence on a small subset of routes. Effectively no useful triangulation.

5. **TK (Turkish)** — TK's own engine is the source of truth, but it's so glitchy that "phantom availability" (shown but unbookable) is a known phenomenon. Star Alliance hubs (UA, Aeroplan, KrisFlyer) expose TK well in terms of *existence*, but cross-checking will routinely surface seats TK shows that the partners do NOT, and vice versa — making the cross-check a source of false alarms rather than reliable corroboration. *Special handling needed:* treat the **direct + multi-hub-cross-check disagreement** as a known-noisy signal for TK, not a fix-it-now error.

**Borderline case (not in the 5):** **EK (Emirates)** — only two hubs can search it (Aeroplan, Qantas), and Aeroplan moved to dynamic in Mar 2025 so price reliability degrades. Existence triangulation is OK; price triangulation will diverge by design. Document as "existence-only cross-check."

---

## 5. Recommendations for PointSnap's confidence engine

(Not requested but high-leverage given the synthesis above.)

1. **Tag each (operating-carrier, hub) cell in the matrix with `existence_only` vs `price_capable`.** AF/KL/DL cross-checks via SkyTeam are existence-only because DL's dynamic prices are not visible to partner programs. EK via Aeroplan is existence-only post-Mar-2025 dynamic switch.
2. **Lower the confidence-bump weight for `existence_only` matches** in the `confidence_signals` table compared to `price_capable` matches. A BA Avios match on AA at the same dollar-equivalent price is stronger signal than a Virgin match on DL where Virgin only knows DL released A seat.
3. **For KE / GA / and TK**, gate cross-check disagreement to a separate `noisy_signal` category rather than reducing primary confidence — the partner mismatch is *expected*, not anomalous.
4. **Document the AS-vs-AA hole prominently** — the user's veto rationale is the principle; the matrix shows the structural reason ("AS displays a subset of AA inventory"). This belongs in `tasks/scraper-log.md` so future Claude sessions don't reach for AS as a quick fix.
5. **The two strongest cross-check hubs** are Aeroplan (Star + non-Star bilaterals — broadest engine) and BA Avios + Asia Miles together (oneworld — overlapping coverage gives triangulation). If PointSnap ever picks 2 backdoors to scrape lightly for cross-check, those two clusters give the best yield per scraper invested.

---

## Sources

- [Booking Partner Award Flights Using British Airways Avios — The Points Guy](https://thepointsguy.com/loyalty-programs/book-partner-award-flights-british-airways-avios/)
- [British Airways Partners You Can Book with Avios — Point.me](https://www.point.me/insights/british-airways-partners-book-with-avios/)
- [Aeroplan airline options (Air Canada AND 50 airline partners) — Flytrippers](https://flytrippers.com/aeroplan-airline-options-partners-list/)
- [50 Aeroplan Airline Partners — AwardWallet](https://awardwallet.com/airlines/air-canada-aeroplan/air-canada-partners/)
- [Aeroplan Award Chart Changes: Dynamic Pricing — One Mile at a Time](https://onemileatatime.com/news/aeroplan-award-chart-changes-dynamic-pricing/)
- [Alaska Airlines Mileage Plan Adds Mixed Partner Award Bookings — AwardWallet](https://awardwallet.com/news/alaska-atmos-rewards/mixed-partner-awards/)
- [Atmos Rewards: The Complete Guide — The Pointy Miles](https://www.thepointymiles.com/posts/alaska-airlines)
- [New: Book American Airlines Flights With Asia Miles Online — AwardWallet](https://awardwallet.com/news/airlines/book-american-flights-with-cathay-pacific/)
- [Cathay Pacific Asia Miles guide — The Points Guy](https://thepointsguy.com/loyalty-programs/cathay-pacific-asia-miles/)
- [Qantas Frequent Flyer Classic Flight Rewards](https://www.qantas.com/us/en/frequent-flyer/use-points/classic-flight-rewards.html)
- [Qantas Frequent Flyer Emirates Partner Page](https://www.qantas.com/us/en/frequent-flyer/partners/emirates.html)
- [Which Virgin Atlantic Flying Club partner redemptions can be booked online? — The Points Guy](https://thepointsguy.com/loyalty-programs/book-virgin-atlantic-partner-awards-online/)
- [How to use Virgin Points to fly on ANA — Head For Points](https://www.headforpoints.com/2025/09/22/how-to-redeem-virgin-points-on-ana-and-other-partner-airlines/)
- [The best websites for searching SkyTeam award availability — The Points Guy](https://thepointsguy.com/loyalty-programs/searching-skyteam-availability/)
- [How to use DL miles to book MU (China Eastern) — FlyerTalk](https://www.flyertalk.com/forum/delta-air-lines-skymiles/2116857-how-use-dl-miles-book-mu-china-eastern-award-flights.html)
- [Flying Blue Makes It Easier To Search, Book Partner Awards Online — Upgraded Points](https://upgradedpoints.com/news/flying-blue-partner-award-calendar-improvement/)
- [Singapore Makes Star Alliance Awards Bookable Online — The Points Guy](https://thepointsguy.com/news/book-star-awards-online-with-krisflyer/)
- [Which Star Alliance and partner airlines can you book online using KrisFlyer miles? — Mainly Miles](https://mainlymiles.com/2020/06/19/which-star-alliance-and-partner-airlines-can-you-book-online-using-krisflyer-miles/)
- [Use this trick to find hidden LifeMiles award space — The Points Guy](https://thepointsguy.com/guide/lifemiles-award-space-trick/)
- [Finding hidden LifeMiles award availability — Frequent Miler](https://frequentmiler.com/finding-hidden-lifemiles-award-availability/)
- [Finding Availabilities for Miles&More Award Flights — Travel-Dealz](https://travel-dealz.com/blog/miles-and-more-finding-availability/)
- [ANA Mileage Club Award Booking Instructions — 10xTravel](https://10xtravel.com/ana-mileage-club-award-booking-instructions/)
- [Aer Lingus AerClub — AwardFares](https://awardfares.com/programs/aer-lingus-aerclub)
- [EVA Air Infinity MileageLands — AwardFares](https://awardfares.com/programs/eva-infinity-mileage-lands)
- [Iberia Plus Avios Program — 10xTravel](https://10xtravel.com/iberia-plus-avios-program/)
- [The Best Ways To Search for Star Alliance Award Availability — Upgraded Points](https://upgradedpoints.com/travel/airlines/searching-star-alliance-award-availability/)
