# Airport search just got a lot smarter

**Status:** Draft for KB. Not yet published.
**Surface:** `/search` (the cockpit)
**Shipped:** 2026-05-17

## What's new

The **From** and **To** fields on the search form are now typeahead. Start typing — the field shows matching airports as you go.

- Type **"JFK"** → instantly finds JFK / New York
- Type **"new york"** → city-level match: shows JFK, LGA, EWR, plus secondary fields
- Type **"kennedy"** → name-level match: finds JFK
- Power users: typing a 3-letter IATA still works exactly as before. Press Enter on any 3-letter code, matched or not, and it commits.

## Why this matters

The cockpit's airport coverage went from **132 hubs** to **5,432 airports** — essentially every commercial airport in the world. Before this change, you had to know the IATA code. Now you can search by city or airport name, including smaller airports that travelers know by name ("Long Beach", "Burbank") but not always by code.

## How it works (for the curious)

Backed by the open-source **OpenFlights** dataset, refreshed on demand from the public GitHub repo. We added it as a one-pass sync (`scripts/syncOpenFlights.ts` for the technical reader) so future updates are a single command.

The typeahead ranks results by relevance:

1. Exact IATA match wins (you typed JFK → JFK)
2. IATA prefix next (you typed JF → JFK, JFD, JFR)
3. City prefix (you typed New → New York / Newark / New Orleans)
4. Name contains (you typed Kennedy → JFK; you typed Heathrow → LHR)

Results are debounced at 150ms and cached in your browser, so repeat searches feel instant.

## Mobile

The combobox is sized to Apple HIG tap-target standards (44pt minimum). Same component renders the same way on phone and desktop.

## Limitations

- Search is by airport, not city. Searching "Tokyo" surfaces every Tokyo-area airport (NRT, HND, etc.) — fine if you're flexible on which terminal, less useful if you want "Tokyo: best of NRT or HND, your call" routing. That's a Phase 2 feature.
- The autocomplete reflects **active** airports from OpenFlights, so closed airports (e.g. Hong Kong Kai Tak, Berlin Tempelhof) don't appear. We can mark airports as inactive if we ever want to surface historical ones.

## What to update in the FAQ

When the next FAQ refresh ships, swap any phrasing about "IATA codes" with "airport name, city, or code" wherever the search form is referenced.
