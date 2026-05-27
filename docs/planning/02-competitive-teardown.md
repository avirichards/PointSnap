# PointSnap Competitive Teardown: Award Search Tools Deep Dive

*Prepared 2026-05-17. Sources at bottom. Synthesizes WebSearch result extractions plus published reviews from Frequent Miler, OMAAT, Upgraded Points, AwardWallet, NerdWallet, The Points Guy, FlyerTalk, and Nurse Michael Travels.*

---

## 1. Seats.aero (DEEPEST STUDY)

### Programs covered (~25 airline + 5 hotel + 2 transferable)
Air Canada Aeroplan, Air France/KLM Flying Blue, Alaska Atmos Rewards, American AAdvantage, Azul Fidelidade, Copa ConnectMiles, Delta SkyMiles, Emirates Skywards, Ethiopian ShebaMiles, Etihad Guest, Finnair Plus, GOL Smiles, JetBlue TrueBlue, Lufthansa Miles & More, Qantas Frequent Flyer, Qatar Privilege Club, SAS EuroBonus, Saudia AlFursan, Singapore KrisFlyer, Turkish Miles&Smiles, United MileagePlus, Virgin Atlantic Flying Club, Virgin Australia Velocity. Sister site `rooms.aero` adds Choice, Hilton, Hyatt, IHG, Marriott. AmEx MR and Bilt currencies are integrated. **Notably missing:** British Airways Executive Club (Avios), ANA Mileage Club, Cathay Asia Miles, Avianca LifeMiles, Alaska partners search depth, Korean SKYPASS, Hawaiian, LATAM.

### Data sourcing
Web-scraping of airline websites (not API partnerships). Cached, not live — but refreshed every few seconds for some sources, much slower for others. Air Canada sent a cease-and-desist alleging CFAA violation. Some sources are intermittently degraded (Copa, KrisFlyer outages reported). A Pro API exists for personal/non-commercial use only.

### Accuracy claims vs. reality
- Seats.aero markets itself as "the fastest" — true on speed, but cache-based means staleness.
- Phantom availability is the #1 complaint, particularly bad on Japan Airlines (not a covered program but appears via partner inventory) and Aeroplan. Users report time-stamped screenshots showing flights on Seats.aero that don't exist on the airline site.
- "Last Seen" column is the partial mitigation — shows when the cache last confirmed the space.
- Fees/taxes often wrong; users instructed to confirm on airline site before transferring points.
- The Wednesday/Friday inconsistency complaint: tool finds availability on some dates but misses adjacent ones the airline site shows.

### Pricing
- **Free:** Search 60 days out only, email alerts only, limited filters.
- **Pro:** $9.99/mo or $99.99/yr. Unlocks full year of availability, advanced filters (direct-only, fee max, show dynamic flights, specific airlines, seat count), SMS alerts, fare class viewer, seat map viewer (beta), United PlusPoints upgrade search, Pro API access, rooms.aero Pro features.
- **Black Friday:** 30% off promo recurring.

### Top killer features
1. **Spreadsheet UX with multi-cabin row** (see Section 11 spec).
2. **Explore view** — pick one mileage program, see every available award across every region it serves, on a calendar/map basis. No other tool does this as elegantly.
3. **Speed** — searches feel instant because they're cached server-side; one-year scan in seconds.
4. **Seat Map Viewer + Fare Class Viewer (GDS data)** — borderline ExpertFlyer-replacement features.
5. **United PlusPoints alerting** — niche but beloved by United elites.
6. **Rooms.aero integration** — first usable Hyatt availability calendar; multi-night cpp lump-sort across the year.

### Top weaknesses / complaints
1. **Phantom availability**, especially Aeroplan/JAL partners and Singapore KrisFlyer.
2. **Mobile app is hated** — App Store reviews complain of "nothing found" errors, broken filters, search hangs on international, "feels like an afterthought."
3. **No journey planner** — you search one O&D at a time; no multi-city, no stopover engineering.
4. **No booking handoff** — clicks to airline site, but no point-transfer instructions, no booking guidance.
5. **Missing major programs** — BA Avios, ANA, Cathay, LifeMiles, Korean.
6. **Preference persistence** — won't remember "show maximum results" or favorite filters between sessions.
7. **Taxes/fees inaccurate**.

### UX to steal
- The simultaneous Y/W/J/F per-row display (huge differentiator vs. point.me).
- Multi-column shift-click sort.
- Per-column filter boxes inline.
- "Last Seen" timestamp transparency.
- The Explore-by-program paradigm.
- Pro features visible but locked in UI (creates upgrade desire).

### UX to avoid
- Cramped data table on mobile; ignored mobile app polish.
- Lack of breadcrumb/state persistence.
- Opaque error states ("nothing found" without context).
- No staleness color coding inline (only buried in a column).

---

## 2. point.me

### Programs covered
30+ loyalty programs covering 100–150+ airlines. Includes coverage gaps Seats.aero lacks (e.g., better Air France/KLM behavior, some unique partners), but reviewers note **point.me throws away Aeroplan results late in searches** and frequently misses Virgin Atlantic and Flying Blue.

### Data sourcing
Real-time live querying of partner program engines (slower as a result). Searches in ~30 seconds today (down from several minutes at launch).

### Accuracy / complaints
- "Painfully slow" historically; improved but still 30s/search.
- Throws away Aeroplan and Virgin Atlantic results inconsistently.
- Shows results from 90+ days ago when user searches "any business class from MIA on points" — staleness in Explore.
- No multi-city. No multi-cabin (must search Y and J separately).
- One specific day, one O&D, one cabin per search — the antithesis of Seats.aero.

### Pricing
- **Basic:** Free (Explore tool + 60-day Search window).
- **Standard:** $12/mo or $129/yr — full real-time search, 1 alert ($12/mo) or 3 alerts ($129/yr).
- **Premium:** $260/yr — adds 1:1 Points Advisor consultation, 10% off concierge.

### Killer features
1. **Step-by-step transfer/booking instructions with screenshots** — best in class for beginners.
2. **Transfer-bonus aware pricing** — incorporates current AmEx/Chase/Bilt/Cap1/Citi transfer bonuses in displayed cost.
3. **Mixed-cabin % indicator** — shows % of journey in premium cabin (Seats.aero doesn't surface this prominently).
4. **Premium concierge** — actual humans book for you.
5. **Brand trust** — onboarded via Bilt, Chase referrals; mainstream credibility.

### Weaknesses
1. Slow.
2. No multi-cabin search.
3. No multi-city.
4. Aeroplan/Virgin Atlantic flakiness.
5. Expensive vs. Seats.aero / PointsYeah for what you get.
6. Day-by-day grind — no calendar.

### UX to steal
- Step-by-step booking instruction overlay.
- Transfer-bonus math baked into cost display.
- Premium-cabin % indicator on mixed routings.

### UX to avoid
- Single-cabin search paradigm (the central sin).
- Day-by-day-only date selection.

---

## 3. PointsYeah

### Programs covered
22 airlines + 6 hotel + 6 bank programs.

### Data sourcing
Mix of live + cached (Daydream Explorer is cached discovery; standard search is closer to live).

### Accuracy
NerdWallet named PointsYeah **2026 best award travel search tool**, beating Seats.aero, Roame, point.me head-to-head. Fewer phantom-availability complaints in reviews than Seats.aero. Searches under 20 seconds.

### Pricing
- **Free:** 22 airlines + 6 hotels + 6 banks, 4-day window, 4 flight + 4 hotel alerts.
- **Premium:** $89.99–$99.99/yr — 8-day window, multi-airport (up to 2 origins, 2 destinations), 32 flight + 15 hotel alerts.

### Killer features
1. **Daydream Explorer** — pick up to 3 airports/continents/regions/countries, or "anywhere," or an activity (scuba/ski/golf). Closest competitor to Seats.aero's Explore.
2. **Hotel + flight unified**.
3. **Multi-origin/multi-destination search** (Pro).
4. **Calendar overlay cash vs. points** for hotels (a brilliant value-check UI).
5. **Rich sort options:** Points Low→High, Quickest Flights, Taxes Low→High, Dep Time, Arr Time, Cash Low→High.
6. **Filters:** cabin, airlines, stops, premium cabin %, aircraft type.

### Weaknesses
- Smaller program coverage than point.me.
- Free tier is narrow (4-day window forces upgrades for serious flexible search).
- Smaller community/brand vs. Seats.aero.
- 8-day window even on Pro feels restrictive vs. Seats.aero's year.

### UX to steal
- Cash-vs-points side-by-side calendar.
- "Anywhere" + activity-tag destination picker.
- Premium-cabin % filter.
- Multi-origin / multi-destination input.

### UX to avoid
- Window-size limits that force re-searching to span a month.

---

## 4. Roame

### Programs covered
21+ airline loyalty programs; ~200 operating airlines surfaced; 8 credit card programs. Includes AA, AeroMexico, Aer Lingus, Air Canada, AF/KLM, Alaska, ANA, Avianca, BA, Cathay, Delta, Emirates, Etihad, Finnair, GOL, Iberia, JetBlue, Lufthansa, Qantas, Qatar, SAS, Singapore, Spirit, TAP, Turkish, United, Virgin Atlantic, Virgin Australia. **Includes BA, ANA, Cathay, LifeMiles-adjacent programs Seats.aero lacks.**

### Data sourcing
Cached with daily refresh ("scans routes daily showing cached results from the past few days"). SkyView surfaces this in calendar form.

### Pricing
- **Roame Community (free):** basic search, no alerts.
- **Friends of Roame:** $109.99/yr — 10 alerts, year-out cached availability.
- **Monthly:** $12.99/mo — 5 alerts.

### Killer features
1. **SkyView** — 60-day calendar visualization between any two destinations, up to 365 days out.
2. **"Which cards do I have?" filter** — input your wallet, see only redemptions you can actually book.
3. **Aircraft-type filter** ("A380") — perfect for AvGeeks chasing specific cabins.
4. **160K+ Facebook community** — Discord-like brand stickiness.
5. **Native mobile app + PWA install.**
6. **Premium cabin % filter** (parity with PointsYeah).

### Weaknesses
1. SkyView is hard to scroll across a full year — 60-day chunks force return-to-calendar.
2. Less program depth than point.me.
3. Fewer "unicorn" partners than Seats.aero in some niches.
4. Cached-daily means staler than Seats.aero's seconds-refresh.

### UX to steal
- **Wallet-input filter** ("only show me bookable redemptions").
- 60-day calendar between O&D.
- Aircraft-type filter.
- Native mobile app discipline.

### UX to avoid
- Calendar paging friction (forced returns to date picker).

---

## 5. AwardLogic

### Programs covered
20+ programs, 60+ carriers.

### Data sourcing
"Real-time" live querying.

### Pricing
- **Day pass:** $4.99 — unusual and useful.
- **Monthly:** $19.99 — most expensive in category.
- **Annual:** $200 effectively (~$16.67/mo).

### Killer features
1. **Day-pass model** — pay-as-you-go for one-off bookings is great.
2. **Side-by-side multi-program price comparison** for the same flight.
3. Step-by-step transfer/booking instructions (point.me parity).
4. **3-day date flex** on Premium.
5. Flight alerts on specific routings.

### Weaknesses
1. Expensive monthly.
2. Limited brand awareness vs. Seats.aero / point.me.
3. Smaller free tier value.

### UX to steal
- **$4.99 day pass** — PointSnap should have this. One-off awards travelers exist.
- Multi-program price comparison ROW for the same operating flight.

---

## 6. AwardHacker (defunct/obsolete)

Was a static-chart calculator (route → theoretical miles needed). Dynamic pricing (Delta SkyMiles, increasingly United/AA) has made static charts wrong most of the time. The tool is essentially dead. Successor `awardhack.com` provides similar static-chart pricing as a reference layer.

**Lesson for PointSnap:** Static charts are still useful as a *reference* / "what should this cost in theory" layer alongside live search — but cannot be the primary product.

---

## 7. ExpertFlyer

### Programs covered
Award + upgrade inventory across most major carriers including BA, Cathay, ANA partner space — many that consumer award tools miss.

### Data sourcing
GDS (Global Distribution System) feeds — the actual fare-class inventory airlines publish to travel agents. **This is the most "accurate" feed possible** because it's the same data that airline reservation systems run on.

### Pricing (2025–26)
- **Basic:** $4.99/mo or $49.99/yr — award/upgrade search, fare buckets, 4 seat alerts, 250 queries/mo cap.
- **Premium:** $9.99/mo or $99.99/yr — flexible search, unlimited queries, 200 seat alerts, 200 flight availability alerts, aircraft-change alerts.
- **Elite (new):** Higher tier — better systemwide upgrade visibility, 330-day search, one-click upgrade verification.

### Killer features
1. **GDS fare-class transparency** — see exactly how many seats are for sale in each fare bucket.
2. **Seat alerts** for any specific seat opening on a flight (window/aisle/exit row).
3. **Aircraft-change alerts** — invaluable for premium-cabin chasers.
4. **AeroLOPA seat-map partnership** — best-in-class cabin maps.
5. **Schedule-change alerts**.
6. Elite tier's **330-day search** with results in seconds.

### Weaknesses
1. Ancient/clunky UI; 2000s aesthetic.
2. Requires fare-class literacy (most users don't know what "I class" means).
3. Doesn't translate fare classes to "is this bookable with X miles?" — leaves interpretation to user.
4. Recent price hikes annoyed loyal users.

### UX to steal
- **Per-fare-class inventory counts visible in UI** (Z3 = 3 Z-class seats for sale).
- Aircraft-change alerts.
- Specific-seat alerts.

### UX to avoid
- The whole 2000s interface — but the *data depth* is what to replicate.

---

## 8. AwardWallet

### Programs covered
**630 loyalty programs worldwide** — by far the deepest balance/expiration coverage of any tool.

### Pricing
- **Free** — basic tracking, ads.
- **Plus:** $30–$50/yr — parallel updates (5x faster), expiration warnings, historical transactions, ad-free, real-time Balance Watch, unlimited updates.

### Killer features
1. **Balance + expiration tracking** for 630 programs.
2. **Itinerary inbox parser** — auto-imports flight/hotel/car reservations from email.
3. **Multi-person tracking** (household).
4. **Certificate tracking** — free nights, companion tickets, dining credits.
5. **"Use it by" expiration reminders** with push notifications.
6. **Merchant card optimizer** (which card earns the most where).

### Weaknesses
- Not a search tool — read-only.
- Plus tier value debated (some find free sufficient).
- UI is functional but dated.

### UX to steal
- **Auto-import itineraries from email** — PointSnap should consider this.
- Expiration push reminders.
- Multi-account family dashboard.

---

## 9. AwardFares / AwardTool / Points Path / Pointhound

### AwardFares
- Coverage of United, SAS EuroBonus, SkyMiles, AAdvantage, JetBlue, Flying Blue, Turkish, GOL Smiles. Lost Aeroplan March 2025.
- **Diamond plan: $19.99/mo** — unlimited seat alerts, unlimited custom searches, max 30 concurrent searches, cabin annotations, seat maps, award release dates, flight schedules tool.
- **Killer features:** Timeline View (availability change over time), Intelligent Alerts (Live + AI-driven Flex Alerts launched Aug 2025), modern UI praised by reviewers.

### AwardTool
- ~20 programs.
- **Multi-airport, multi-date simultaneous search up to 32 concurrent queries** — best-in-class for power users.
- Desktop-only — no mobile/PWA.
- $94.99/yr (or $74.99 with code).
- Strong for discovery; weak mobile story.

### Points Path
- Free **browser extension** layered on Google Flights — shows cash + award prices side-by-side.
- Best at surfacing foreign-program redemptions you'd otherwise miss.
- Not a discovery tool; assumes you already have a flight in mind.

### Pointhound
- Free, fast, simplified — best for true beginners.
- Step-by-step booking guidance, no signup required.
- Less powerful than the above.

---

## 10. Gaps Matrix

Columns: SA=Seats.aero | PM=point.me | PY=PointsYeah | RO=Roame | AL=AwardLogic | AH=AwardHacker | EF=ExpertFlyer | AW=AwardWallet | AF=AwardFares | AT=AwardTool | PP=Points Path

| Feature | SA | PM | PY | RO | AL | AH | EF | AW | AF | AT | PP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| All cabins (Y/W/J/F) shown per flight | YES | NO | partial | partial | partial | n/a | YES (fare class) | n/a | YES | partial | NO |
| Spreadsheet/sortable table | YES | NO | partial | partial | partial | n/a | YES | n/a | partial | YES | NO |
| Multi-column sort (shift) | YES | NO | NO | NO | NO | n/a | NO | n/a | NO | partial | NO |
| Calendar view (full month/year) | YES | NO | partial | YES (60d) | NO | n/a | NO | n/a | YES | partial | NO |
| Live (vs. cached) | NO | YES | partial | NO | YES | n/a | YES | n/a | partial | YES | n/a |
| 1-year search horizon | YES (Pro) | partial | NO | YES (Pro) | YES | n/a | YES (Elite) | n/a | YES | YES | n/a |
| Multi-cabin in one search | YES | NO | YES | YES | YES | n/a | YES | n/a | YES | YES | YES |
| Multi-city/stopover engineering | NO | NO | NO | NO | NO | n/a | partial | n/a | partial | NO | NO |
| Multi-origin/multi-destination | NO | NO | YES (Pro) | partial | NO | n/a | NO | n/a | partial | YES | NO |
| "What's in my wallet" filter | NO | partial | NO | YES | NO | n/a | NO | n/a | NO | NO | partial |
| Transfer-bonus aware pricing | NO | YES | partial | partial | partial | n/a | NO | partial | NO | NO | partial |
| Step-by-step booking instructions | NO | YES | partial | YES | YES | n/a | NO | n/a | partial | partial | NO |
| Seat maps | YES (Pro) | NO | YES | NO | NO | n/a | YES | n/a | YES | NO | NO |
| Fare class inventory | YES (Pro) | NO | NO | NO | NO | n/a | YES | n/a | partial | NO | NO |
| Phantom-availability mitigation | partial | partial | partial | partial | partial | n/a | YES (GDS) | n/a | partial | partial | n/a |
| Aircraft-type filter | NO | NO | YES | YES | NO | n/a | YES | n/a | partial | partial | NO |
| Premium-cabin % | NO | YES | YES | YES | NO | n/a | NO | n/a | NO | NO | NO |
| Cash-vs-points overlay | NO | partial | YES | partial | NO | n/a | NO | n/a | NO | NO | YES |
| Static-chart "should cost" reference | NO | NO | NO | NO | NO | YES | NO | n/a | NO | NO | NO |
| Balance/expiration tracking | NO | NO | NO | NO | NO | n/a | NO | YES | NO | NO | NO |
| Hotel award search | YES (rooms.aero) | NO | YES | NO | NO | n/a | NO | n/a | NO | NO | NO |
| Native mobile app (good) | NO (bad app) | partial | partial | YES | NO | n/a | partial | YES | partial | NO | n/a (extension) |
| Alerts (SMS/push) | YES (Pro) | partial | YES | YES | YES | n/a | YES | YES | YES | YES | n/a |
| Day-pass / pay-per-use | NO | NO | NO | NO | YES | n/a | NO | NO | NO | NO | n/a |
| Public API | partial (Pro) | NO | NO | NO | NO | n/a | NO | n/a | NO | NO | n/a |
| BA Avios | NO | YES | partial | YES | partial | static | YES (inventory) | track | NO | partial | partial |
| ANA Mileage Club | NO | YES | partial | YES | partial | static | YES (inventory) | track | NO | partial | partial |
| Cathay Asia Miles | NO | YES | partial | YES | partial | static | YES (inventory) | track | NO | YES | partial |
| Avianca LifeMiles | NO | YES | partial | YES | partial | static | partial | track | NO | partial | partial |
| Korean SKYPASS | NO | partial | NO | NO | NO | static | partial | track | NO | NO | NO |

---

## 11. The Seats.aero Spreadsheet UX — Engineering-Grade Spec

This is the paradigm to replicate and improve.

### Layout
- **Density:** Compact data-table, ~36–40px row height. Striped or single-tone rows. No card padding — purely tabular.
- **Width:** Full-bleed desktop. Horizontal scroll allowed but disliked; columns chosen to fit ~1280px.
- **Header row:** Sticky on scroll. Column titles double as sort triggers (click=primary sort; shift-click=secondary).

### Columns (Search view, multi-program, single O&D)
1. **Date** (Mon, Apr 15) — sortable, primary default sort.
2. **Program** (e.g., "Aeroplan", "AA AAdvantage") — text + small program logo. The program whose currency books the award.
3. **Operating airline** — IATA code + small logo (UA, LH, NH).
4. **Origin → Destination** with stops indicator ("YYZ→FRA 1 stop").
5. **Y** (economy) — points cost if Y is available, else "—". Cell tinted.
6. **W** (premium economy) — same.
7. **J** (business) — same; usually the hero column for enthusiasts.
8. **F** (first) — same; rarest, often the unicorn.
9. **Seats** — integer count of seats at that price.
10. **Taxes/fees** — USD-converted.
11. **Duration** — flight time.
12. **Last Seen** — relative time ("3m ago", "2h ago") — staleness signal.
13. **Direct?** — Yes/No badge (filterable).

### Cabin-class display paradigm (THE KEY INNOVATION)
- **One row = one flight (or one O&D-date-program-airline combo).** All four cabin classes are visible simultaneously as columns.
- A cabin is either **filled with the points cost** (and tinted by availability tier) or shown as **"—" / dash / blank** when unavailable.
- This eliminates the point.me sin of forcing separate searches per cabin.
- Color coding (Seats.aero is subtle here — opportunity for PointSnap): Y=neutral, W=light tint, J=stronger tint, F=accent/gold. PointSnap should make this more vivid.

### Multiple programs ticketing same flight
When LH 401 JFK→FRA is bookable via Aeroplan (60K) AND United (66K) AND Avianca (63K), Seats.aero shows **multiple rows** — one per ticketing program. This is verbose but transparent.
- **Improvement for PointSnap:** Collapse-by-default into "1 flight, 3 ways to book"; expand to see all programs side-by-side. Or render the cheapest program in main row with a "+2 more programs" chip.

### Sort/filter UI
- **Inline column filters:** small text boxes under headers — e.g., type "YYZ" under Origin to filter live.
- **Sidebar/top filter bar:** Departure airports (multi-select), Arrival airports, Airlines (multi-select), Max points, Days of week, Max stops, Cabin checkboxes (Y/W/J/F — filter rows where at least that cabin is available), Direct only, Fee max (Pro).
- **Multi-column sort:** Click primary; shift-click secondary, tertiary. Direction indicator chevron.

### Calendar view (Explore)
- Select one program → see colored heatmap calendar per region pair.
- Each cell = one date; color = best cabin available + count.
- Click cell → drops into spreadsheet view filtered to that date.

### Mobile vs. desktop
- **Desktop:** Full table.
- **Mobile (web):** Collapses to card view — each card stacks cabin chips horizontally (Y/W/J/F). Reviewers say this works but feels cramped.
- **Mobile app:** Reportedly broken/abandoned — App Store reviews savage it. **This is PointSnap's biggest opportunity.**

### Alerting
- Pro: SMS + email; free: email only.
- Alert criteria: O&D, date or date range (±days), cabin(s), airlines, max points.
- United-specific: PlusPoints upgrade alerts.

---

## 12. Top 10 Product Gaps PointSnap Can Exploit

1. **Best mobile award-search app, period.** Native iOS/Android, table-first not card-first. Every competitor's mobile is bad. Seats.aero's app is hated; Roame's exists but is shallow; AwardTool has no mobile.
2. **Phantom-availability scoring.** Show a confidence score per row: "Last verified 4m ago, 12/12 bookable in last hour" vs. "Last seen 3h ago, 40% bookable rate" — based on user feedback + recency. No competitor does this.
3. **Multi-ticketing-program collapse + expand.** Display a single flight once with all programs that can ticket it as expandable sub-rows, with cheapest highlighted and transfer-bonus-aware true cost calculated per program. Steals from point.me's transfer-bonus math + Seats.aero's UX.
4. **"What's in my wallet" engine** with transfer-bonus awareness. Roame has the wallet filter; point.me has the transfer math; nobody has both fused into the spreadsheet. Plus: live transfer bonus banner per program.
5. **Coverage of the missing programs:** BA Avios, ANA, Cathay Asia Miles, LifeMiles, Korean SKYPASS, Alaska partner depth. Seats.aero's coverage gaps here are gaping; this is a checklist users will compare on.
6. **Stopover + open-jaw engineering.** No major tool builds Aeroplan stopovers, Alaska stopovers, BA Avios open-jaws, or Turkish stopover routings. Power-user catnip.
7. **Member-only availability awareness.** Surface known patterns: "Singapore J releases only to KrisFlyer members" or "United Chase cardholder gets X% discount" — context that today's tools omit.
8. **Day-pass pricing tier.** AwardLogic's $4.99 day pass is genius. Casual users with one trip to book hate $10/mo subscriptions. Offer Free / $4.99 day / $9.99 mo / $89 yr.
9. **Static-chart reference layer fused with live search.** AwardHacker is dead; ANA's old chart, Aeroplan's chart, Alaska's chart still have signal. Render "should cost ~75K per ANA chart" next to actual live pricing — instant value detection.
10. **Email/inbox itinerary import + balance + expiration tracking.** Steal AwardWallet's core. Tracking + searching belong in one app. Users currently juggle 3–4 tabs.

---

## 13. Top 10 Best-in-Class UX Details to Replicate

1. **Seats.aero's per-row Y/W/J/F columns** with availability counts — the foundational paradigm.
2. **Seats.aero's "Last Seen" timestamp** — minimal but essential staleness signal; make it more prominent with color (green/yellow/red).
3. **Multi-column shift-sort.** Seats.aero. Engineers love this.
4. **PointsYeah's Daydream Explorer** — "anywhere" + activity tags (scuba/ski/golf) as destination categories.
5. **PointsYeah's cash-vs-points overlay on calendar** — instant value judgment.
6. **Roame's wallet-input filter** — show only what the user can book.
7. **Roame's aircraft-type filter** — A380/777-300ER chasers.
8. **point.me's step-by-step transfer + booking instructions with screenshots.** Reduces the "I found it, now what?" anxiety.
9. **point.me's transfer-bonus-aware effective cost.** Render points cost AFTER applicable bonus (e.g., "60K Aeroplan = 48K AmEx MR after 25% bonus").
10. **ExpertFlyer's fare-class inventory counts** (e.g., "J7" = 7 J seats for sale). Surface this for power users as a Pro feature; differentiates against consumer tools.

### Honorable mentions
- **AwardLogic's $4.99 day pass** pricing.
- **AwardFares' Timeline View** (availability change over time) — like price-history graphs in airfare tools.
- **AwardWallet's email-itinerary auto-import.**
- **PointsYeah's premium-cabin % display** for mixed routings.
- **Seats.aero's Explore view** but redesigned to span all programs at once, not one program at a time.

---

## 14. Strategic Synthesis for PointSnap

**The market position to claim:** The accuracy-first, enthusiast-grade tool that owns Seats.aero's spreadsheet paradigm and improves it with (a) confidence scoring against phantom availability, (b) the programs Seats.aero refuses to cover, (c) transfer-bonus-aware pricing fused with the spreadsheet, and (d) a mobile app that doesn't suck.

**The wedge:** Seats.aero has the best UX but accuracy issues, coverage gaps, and an abandoned mobile app. Point.me has accuracy and coverage but a terrible UX. PointSnap wins by combining Seats.aero's table paradigm with point.me-level coverage and accuracy validation, plus mobile-first execution.

**Pricing recommendation:** Free (60 days, basic filters), $4.99 Day Pass, $9.99/mo Pro, $89/yr Pro Annual, $19.99/mo Elite (fare-class data, multi-origin, API). Match the market floor; create a day-pass moat AwardLogic alone occupies; reserve Elite for ExpertFlyer-replacement power users.

**Top 3 launch features to nail first:**
1. The spreadsheet with all four cabins per row, multi-column sort, Last Seen timestamp with color staleness.
2. Wallet-input + transfer-bonus-aware effective cost.
3. Mobile app that is a first-class citizen (not a port) — table view that actually works on phones via horizontal scroll with frozen first two columns.

---

## Sources

- [Seats.aero Now Tracks 24 Airline Programs (AwardWallet)](https://awardwallet.com/travel/seats-aero-guide/)
- [How to use Seats.aero (The Points Guy)](https://thepointsguy.com/travel/seats-aero/)
- [Seats.aero: a wonderfully nerdy tool (Frequent Miler)](https://frequentmiler.com/seats-aero/)
- [Seats.aero: How This Fun, Geeky, Useful, Award Search Tool Works (OMAAT)](https://onemileatatime.com/guides/seats-aero/)
- [Seats.aero Award Search Tool review (NerdWallet)](https://www.nerdwallet.com/travel/learn/seats-aero-review)
- [Free vs. Pro: Is Seats.Aero Worth $10/mo (Upgraded Points)](https://upgradedpoints.com/news/seats-aero-free-vs-pro/)
- [Airlines Try To Shut Down Award-Scraping Sites (OMAAT)](https://onemileatatime.com/news/airlines-shut-down-websites-scraping-awards/)
- [The Truth About Award Search Tools (Nurse Michael Travels)](https://nursemichaeltravels.com/award-search-tools-problems/)
- [Point.me Review: Limited Features, But OK for Beginners (NerdWallet)](https://www.nerdwallet.com/travel/learn/point-me-award-search-review)
- [point.me pricing plans (point.me Help Center)](https://connect.point.me/help/pricing-plans)
- [Point.me Review: How It Works (AwardWallet)](https://awardwallet.com/travel/point-me-review/)
- [PointsYeah Comprehensive Review (AwardWallet)](https://awardwallet.com/travel/pointsyeah-review/)
- [PointsYeah: Free award searches and alerts (Frequent Miler)](https://frequentmiler.com/pointsyeah/)
- [PointsYeah review (NerdWallet)](https://www.nerdwallet.com/travel/learn/points-yeah-award-search-review-easily-find-your-next-points-redemption)
- [PointsYeah vs Seats.aero (The Miles Market)](https://www.themilesmarket.com/post/pointsyeah-vs-seats-aero-the-ultimate-award-search-tool-review)
- [Roame Award Tool Complete Guide (Frequent Miler)](https://frequentmiler.com/roame/)
- [Roame Award Search Review (Travel Freely)](https://travelfreely.com/roame-award-search-review-2025-find-cheap-flights-with-points-miles/)
- [Roame review (NerdWallet)](https://www.nerdwallet.com/travel/learn/roame-review)
- [AwardLogic test drive (Frequent Miler)](https://frequentmiler.com/taking-award-logic-for-a-test-drive/)
- [AwardLogic Flight Search Review (Miles to Memories)](https://milestomemories.com/awardlogic-flight-search-review/)
- [AwardHacker: Once Great, Now Outdated (The Ways to Wealth)](https://www.thewaystowealth.com/awardhacker-review/)
- [ExpertFlyer Review 2025 (The Points Party)](https://thepointsparty.com/articles/expertflyer-review)
- [ExpertFlyer Adds New Features And Elite Tier (Live and Let's Fly)](https://liveandletsfly.com/expertflyer-new-features-elite-tier-pricing/)
- [AwardWallet Pricing](https://awardwallet.com/pricing)
- [AwardFares Pricing](https://awardfares.com/pricing)
- [AwardTool review (Frequent Miler)](https://frequentmiler.com/awardtool/)
- [Points Path review (NerdWallet)](https://www.nerdwallet.com/travel/learn/points-path-review)
- [How To Use Award Search Tools And Know What They Miss (Maria Points the Way)](https://mariapointstheway.com/how-to-use-award-search-tools-and-what-missing/)
- [Pointsme vs Seats.aero vs Roame vs PointsYeah (FlyerTalk)](https://www.flyertalk.com/forum/travel-tools/2151694-pointsme-vs-seats-aero-vs-roame-vs-pointsyeah-vs-anything-else-best.html)
- [The hunt for the best flight award finder (Frequent Miler)](https://frequentmiler.com/the-hunt-for-the-best-flight-award-finder/)
- [Flight Award Search Tools Compared (Frugal Flyer)](https://frugalflyer.ca/blog/award-flight-search-tool-comparison/)
