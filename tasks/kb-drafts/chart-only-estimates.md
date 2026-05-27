# "Chart-only" estimates — what the badge means and when it fires

**Status:** Draft for KB. Not yet published.
**Surface:** `/search` (the cockpit), the **Confidence** column
**Shipped:** 2026-05-17

## What is a "Chart-only" row?

When you search a route, the cockpit shows one row per program × itinerary that can ticket the flight. Each row carries a **Confidence** badge:

| Badge | What it means |
|---|---|
| **Verified** (green ✓) | We've seen this exact flight from multiple sources, recently. Booking confidence is highest. |
| **High** (blue ↗) | Recently scraped from the airline directly. Should still be live. |
| **Medium** (gray −) | Scraped within the last few hours; may have moved. |
| **Low** (yellow ⚠) | Scrape is older or the source had availability noise. Sanity-check by clicking through. |
| **Chart-only** (red 📄) | **New.** No live data for this exact flight — the price shown is the airline's *published award chart* price for this distance / zone pair. Useful for "what should this cost?" but availability is not confirmed. |

## When does Chart-only fire?

Today, the live data layer for 12 of the 13 launch programs is still simulated. So "Chart-only" mostly fills in routes where no mocked result exists. As scrapers come online (starting with Virgin Atlantic in the next phase), Chart-only will increasingly only show up for routes where the *real scraper* hasn't observed availability.

Concrete current behavior on a JFK→LHR search:

- **Virgin Atlantic**: Real hard-coded VS3 row — confidence "Medium" (72/100).
- **British Airways**: Chart-only — the cockpit looks at the JFK-LHR distance (~3,460 mi), finds it in BA's published 2,751–5,000 mi band, returns 13,000 Y / 26,000 W / 38,750 J / 52,000 F. Real BA scraper replaces this in a later session.
- **ANA partner chart**: Chart-only for Star Alliance partner routes where the zone chart applies (e.g. Tokyo→New York returns ANA's partner zone pricing).
- **Cathay**: Chart-only for HK-anchored routes covered by the seeded zones.

## When can I trust a Chart-only number?

- **Trust the miles cost.** Chart-only prices come from the airline's *published* chart, which is what an agent or the airline's own search engine would quote you for an award seat in that cabin at that distance.
- **Don't trust the availability.** A Chart-only row just says "if a seat opens at this price, the airline charges this much." It doesn't promise a seat is open today.
- **Watch for fuel surcharges.** Some programs (British Airways, Lufthansa Miles & More, Cathay Asia Miles, Virgin Atlantic) charge significant fuel surcharges on top of the miles. The cockpit surfaces the typical surcharge from the program's chart rules — actual surcharge varies by routing.

## Why we built this

Before Chart-only existed, programs without a recent scrape just *didn't appear* in the spreadsheet — even when their published chart could give you a reasonable estimate. This made the comparison sparse. Chart-only fills in the picture: you see every program that could ticket the route, with a clear "this is an estimate, not a live quote" signal.

## What's coming next

- Real scrapers replacing more and more Chart-only rows starting with Virgin Atlantic (Session 5).
- Cathay's chart shifts to a proper distance model (it's actually distance-based, not zonal — we approximated for the initial seed and noted this in the chart's metadata for the next refresh).
- "View chart" expander per program — click the program name to see the full chart that produced this estimate.
