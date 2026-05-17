# PointSnap seed data

Run `pnpm db:seed` to load. Idempotent — safe to re-run.

## What's included (Phase 0)

All real data:
- **alliances** — Star, Oneworld, SkyTeam, Unaligned
- **airlines** — ~40 carriers (launch-program sponsors + key partners)
- **airports** — ~150 hubs and major origin airports across all 10 regions
- **aircraft_types** — ~40 ICAO codes (most widebodies + common narrowbodies)
- **programs** — 13 launch programs with `pricing_model` + `fuel_surcharge_passthrough`
- **transferable_currencies** — 7 (Chase UR, Amex MR, Cap1 Venture, Citi TY, Bilt, Marriott Bonvoy, Wells Fargo)
- **transfer_ratios** — every published (currency × program) edge for the launch 13
- **transfer_bonuses** — 3 example active bonuses (May 2026)
- **valuations** — internal cpp for all 13 programs + 7 currencies
- **sweet_spots** — 20 hand-curated launch entries, each tagged for filtering

## What's NOT seeded yet (deferred)

- **award_charts + zones + cells + rules** — full per-program charts are large; BA distance + ANA zones + CX zones + VS chart should be next session
- **program_partnerships** — full N×M matrix with `fare_class_map` JSONB. Stub for AC↔UA, AC↔NH, etc. is straightforward to add when needed for shadow-confirm fare-class matching

## Refresh cadence

- Airports / airlines / aircraft: stable for years
- Programs / pricing models: monthly review by ops
- Transfer ratios: change rarely; audit quarterly
- Transfer bonuses: refresh monthly (current set is May 2026)
- Valuations: refresh quarterly (`source: 'INTERNAL_2026Q2'` tag)
- Sweet spots: refresh when devaluations land (Cathay rebrand 2027 due)

## Adding a new airport

Drop a row into `airports.ts` and re-run `pnpm db:seed`. The `ON CONFLICT DO NOTHING` clause means existing rows aren't touched.

## Sync to OpenFlights (v1.1 target)

The ~150-airport hand-curated set covers the launch search surface. For long-tail routes
we'll add a sync script that pulls OpenFlights' [airports.dat](https://openflights.org/data.php),
maps it to our region taxonomy, and upserts. Should bring us to ~3000 active airports.

## Real availability data

Live award-availability rows (`search_results` + `result_cabin_prices`) are NOT seeded
in Phase 0. They land via the scraper workers (Phase 1 + onward). The spreadsheet UI
is backed by `src/lib/mockSearch.ts` until then.

When you want real data sooner, the planned `pnpm db:import-csv path/to/seats-export.csv`
script (v1.1) will let you drop a Seats.aero CSV export into `search_results` for any
search route, without waiting on scrapers.
