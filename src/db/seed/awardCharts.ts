/**
 * Award chart seed data for the four launch programs with chart-based pricing:
 *   - BA Avios (distance, 8 bands × 4 cabins, complete)
 *   - VS Flying Club (distance, 5 bands × 3 cabins, own-metal complete; partner
 *     charts not yet seeded — pricing is non-trivially per-partner so deferred)
 *   - ANA Mileage Club (zone, Star Alliance partner chart, complete zone defs,
 *     ~30 outbound-from-Japan cells — full chart fills in next session)
 *   - Cathay Asia Miles (zone, complete zone defs, ~40 outbound-from-HKG cells
 *     — full chart fills in next session)
 *
 * What this seed enables: the "Chart-only" confidence badge becomes meaningful
 * — when a scraper hasn't observed a given route recently, /api/search can
 * fall back to the chart for an estimated price + flag it as low confidence.
 * Until the chart had real data, every fallback was just `null`.
 *
 * Sources (current as of 2026-05):
 *   - BA:  https://www.britishairways.com/en-us/information/awards/award-table-redemptions
 *   - VS:  https://flyer.virginatlantic.com/uk/en/flying-club/your-account/award-pricing
 *   - ANA: https://www.ana.co.jp/en/us/amc/reference/awardmiles/partners/
 *   - CX:  https://www.cathaypacific.com/cx/en_US/membership/asia-miles.html
 *
 * Coverage note on ANA/CX: each program's chart has ~100-500 zone-pair cells
 * if fully populated. The seed below carries the canonical zone definitions
 * (so any airport in any zone can be looked up) plus the most-redeemed cells
 * for each program. The rest are deliberately deferred to the scraper era —
 * the scraper's observations will populate them empirically more accurately
 * than transcribing from the published chart, which often diverges in practice.
 */

import type { db } from "../index";
import {
  awardCharts,
  awardChartZones,
  awardChartCells,
  zoneMemberships,
} from "../schema";
import { sql, and, eq } from "drizzle-orm";

type DrizzleDb = NonNullable<typeof db>;

// Effective-from for all four charts: April 2025 baseline (post-CX chart
// refresh + post-BA 2023 redesign). When charts change, add a new row
// rather than mutating — the (programId, scope, effectiveFrom) unique
// index supports versioning out of the box.
const EFFECTIVE_FROM = new Date("2025-04-15T00:00:00Z");

// -----------------------------------------------------------------------------
// BA AVIOS — distance chart, 8 bands × 4 cabins, OWN_METAL scope
// -----------------------------------------------------------------------------

interface BACell {
  minMi: number;
  maxMi: number | null; // null = open-ended top band
  Y: number;
  W: number;
  J: number;
  F: number;
}

const BA_DISTANCE_BANDS: BACell[] = [
  { minMi: 0,    maxMi: 650,   Y: 4_500,  W: 6_500,  J: 9_000,   F: 13_500 },
  { minMi: 651,  maxMi: 1150,  Y: 6_500,  W: 13_000, J: 16_250,  F: 22_750 },
  { minMi: 1151, maxMi: 2000,  Y: 9_500,  W: 19_000, J: 25_750,  F: 39_000 },
  { minMi: 2001, maxMi: 3000,  Y: 13_000, W: 26_000, J: 38_750,  F: 52_000 },
  { minMi: 3001, maxMi: 4000,  Y: 17_000, W: 34_000, J: 52_500,  F: 68_000 },
  { minMi: 4001, maxMi: 5500,  Y: 20_000, W: 40_000, J: 65_000,  F: 85_000 },
  { minMi: 5501, maxMi: 6500,  Y: 25_000, W: 50_000, J: 100_000, F: 120_000 },
  { minMi: 6501, maxMi: null,  Y: 32_500, W: 65_000, J: 130_000, F: 195_000 },
];

// -----------------------------------------------------------------------------
// VS FLYING CLUB — distance chart, 5 bands × 3 cabins (no F on own metal)
// -----------------------------------------------------------------------------

interface VSCell {
  minMi: number;
  maxMi: number | null;
  Y: number;
  W: number;
  J: number; // Upper Class
}

const VS_DISTANCE_BANDS: VSCell[] = [
  { minMi: 0,    maxMi: 2000, Y: 6_000,  W: 12_500, J: 20_000 },
  { minMi: 2001, maxMi: 4000, Y: 10_000, W: 20_000, J: 47_500 },
  { minMi: 4001, maxMi: 6000, Y: 15_000, W: 25_000, J: 57_500 },
  { minMi: 6001, maxMi: 7500, Y: 17_500, W: 27_500, J: 65_000 },
  { minMi: 7501, maxMi: null, Y: 20_000, W: 30_000, J: 75_000 },
];

// -----------------------------------------------------------------------------
// ANA — Star Alliance partner zone chart. RT chart published; OW values below
// are RT/2 since ANA partner awards are RT-only by rule (most pairs).
// -----------------------------------------------------------------------------

interface ZoneDef {
  code: string;
  name: string;
  /** Country ISO2 codes that belong to this zone. */
  countries?: readonly string[];
  /** Specific airports that belong (overrides country if both apply). */
  airports?: readonly string[];
}

const ANA_ZONES: ZoneDef[] = [
  { code: "JP",     name: "Japan",                          countries: ["JP"] },
  { code: "KR_RU",  name: "Korea / Russia (Far East)",      countries: ["KR", "KP"] },
  { code: "CN_TW",  name: "China / Hong Kong / Taiwan",     countries: ["CN", "HK", "MO", "TW"] },
  { code: "SEA",    name: "Southeast Asia",                 countries: ["TH", "SG", "MY", "ID", "PH", "VN", "KH", "LA", "MM", "BN"] },
  { code: "SAS",    name: "South Asia",                     countries: ["IN", "BD", "LK", "NP", "PK", "MV", "BT"] },
  { code: "OCE",    name: "Oceania",                        countries: ["AU", "NZ", "FJ", "PG", "NC", "PF"] },
  { code: "HAW",    name: "Hawaii",                         airports: ["HNL", "OGG", "KOA", "LIH", "ITO"] },
  { code: "NAM",    name: "North America (mainland)",       countries: ["US", "CA", "MX"] },
  { code: "EUR",    name: "Europe",                         countries: ["GB","IE","FR","DE","NL","BE","LU","CH","AT","IT","ES","PT","DK","SE","NO","FI","IS","PL","CZ","SK","HU","RO","BG","HR","SI","GR","TR","CY","LT","LV","EE","UA","BY","MD","RS","ME","AL","MK","BA","XK","MT","LI","MC","SM","VA","AD","FO","GI","GG","IM","JE","RU"] },
  { code: "MEA",    name: "Middle East / Africa",           countries: ["AE","SA","QA","BH","KW","OM","JO","LB","IL","IR","IQ","YE","SY","EG","MA","TN","DZ","LY","KE","ET","ZA","NG","TZ","UG","RW","SN","CI","GH","ZM","ZW","BW","MU","MG","DJ","ER","SD","SS","SO","AO","MZ","NA","CM","GA","BJ","BF","TG","ML","NE","TD","CF","CG","CD","BI","GW","GN","SL","LR","MR","CV","ST","GQ","KM","SC","LS","SZ","MW","GM","RE","YT","SH","EH"] },
  { code: "SAM",    name: "Central / South America",        countries: ["BR","AR","CL","CO","PE","EC","BO","PY","UY","VE","GY","SR","GF","CR","PA","CU","DO","HT","JM","TT","BB","BS","BZ","GT","HN","NI","SV","PR","VI","KY","TC","BM"] },
];

interface AnaCell {
  destZone: string;
  Y: number;
  J: number;
  F: number; // 0 = no F published
}

// Outbound from JP zone (origin = Japan). Inbound is symmetric — generated by
// flipping origin/dest at insert time. Values are OW = published RT / 2.
const ANA_FROM_JP: AnaCell[] = [
  { destZone: "KR_RU", Y: 7_500,  J: 17_500, F: 22_500 },
  { destZone: "CN_TW", Y: 11_000, J: 25_000, F: 30_000 },
  { destZone: "SEA",   Y: 17_000, J: 30_000, F: 42_500 },
  { destZone: "SAS",   Y: 17_500, J: 37_500, F: 50_000 },
  { destZone: "OCE",   Y: 18_000, J: 37_500, F: 52_500 },
  { destZone: "HAW",   Y: 17_500, J: 30_000, F: 45_000 },
  { destZone: "NAM",   Y: 27_500, J: 42_500, F: 75_000 },
  { destZone: "EUR",   Y: 27_500, J: 45_000, F: 82_500 },
  { destZone: "MEA",   Y: 30_000, J: 44_000, F: 80_000 },
  { destZone: "SAM",   Y: 30_000, J: 55_000, F: 87_500 },
];

// -----------------------------------------------------------------------------
// CX ASIA MILES — zone chart, post-April 2025 refresh. OW pricing as published.
// Heavy fuel surcharges per program-level surchargeRule, not per-cell.
// -----------------------------------------------------------------------------

const CX_ZONES: ZoneDef[] = [
  { code: "HK",  name: "Hong Kong / Macau",            countries: ["HK", "MO"] },
  { code: "CN",  name: "Mainland China / Taiwan",      countries: ["CN", "TW"] },
  { code: "SEA", name: "Southeast Asia",               countries: ["TH","SG","MY","ID","PH","VN","KH","LA","MM","BN"] },
  { code: "JK",  name: "Japan / Korea",                countries: ["JP","KR","KP"] },
  { code: "SAS", name: "South Asia",                   countries: ["IN","BD","LK","NP","PK","MV","BT"] },
  { code: "MEA", name: "Middle East",                  countries: ["AE","SA","QA","BH","KW","OM","JO","LB","IL","IR","IQ","YE","SY","EG"] },
  { code: "EUR", name: "Europe",                       countries: ["GB","IE","FR","DE","NL","BE","CH","AT","IT","ES","PT","DK","SE","NO","FI","PL","CZ","HU","GR","TR","CY","RU"] },
  { code: "SAF", name: "Southern Africa",              countries: ["ZA","NA","BW","ZW","MZ","MW","ZM","KE","TZ","UG","ET","MA","TN","DZ","NG","GH","CI","SN","SC","MU","MG"] },
  { code: "OCE", name: "Oceania",                      countries: ["AU","NZ","FJ","PG","NC","PF"] },
  { code: "NAW", name: "North America West",           airports: ["LAX","SFO","SEA","PDX","SAN","LAS","PHX","SLC","DEN","YVR","HNL","OGG","KOA","LIH"] },
  { code: "NAE", name: "North America East / Central", airports: ["JFK","EWR","ORD","BOS","IAD","DCA","ATL","MIA","DFW","IAH","DTW","MSP","CLT","PHL","YYZ","YUL","YOW","YHZ","YWG"] },
  { code: "SAM", name: "Latin America",                countries: ["BR","AR","CL","CO","PE","EC","MX","CR","PA","DO","CU","BS","BB","TT","JM","BM"] },
];

interface CxCell {
  destZone: string;
  Y: number;
  J: number;
  F: number;
}

// Outbound from HK. Symmetric: inbound generated by flipping zones.
const CX_FROM_HK: CxCell[] = [
  { destZone: "CN",  Y: 7_500,  J: 17_500, F: 0 },
  { destZone: "SEA", Y: 10_000, J: 22_500, F: 35_000 },
  { destZone: "JK",  Y: 12_500, J: 32_500, F: 50_000 },
  { destZone: "SAS", Y: 12_500, J: 30_000, F: 45_000 },
  { destZone: "MEA", Y: 22_500, J: 45_000, F: 67_500 },
  { destZone: "EUR", Y: 38_000, J: 80_000, F: 110_000 },
  { destZone: "SAF", Y: 35_000, J: 75_000, F: 110_000 },
  { destZone: "OCE", Y: 27_500, J: 60_000, F: 90_000 },
  { destZone: "NAW", Y: 35_000, J: 75_000, F: 110_000 },
  { destZone: "NAE", Y: 42_500, J: 90_000, F: 125_000 },
  { destZone: "SAM", Y: 50_000, J: 110_000, F: 150_000 },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function upsertChart(
  database: DrizzleDb,
  row: {
    programId: string;
    chartType: "zone" | "region" | "distance" | "dynamic";
    scope: string;
    sourceUrl: string;
    notes: string;
  },
): Promise<number> {
  await database
    .insert(awardCharts)
    .values({
      programId: row.programId,
      chartType: row.chartType,
      scope: row.scope,
      effectiveFrom: EFFECTIVE_FROM,
      sourceUrl: row.sourceUrl,
      notes: row.notes,
    })
    .onConflictDoNothing();
  const [chart] = await database
    .select({ id: awardCharts.id })
    .from(awardCharts)
    .where(
      and(
        eq(awardCharts.programId, row.programId),
        eq(awardCharts.scope, row.scope),
        eq(awardCharts.effectiveFrom, EFFECTIVE_FROM),
      ),
    )
    .limit(1);
  if (!chart) throw new Error(`Failed to locate chart after insert: ${row.programId}/${row.scope}`);
  return chart.id;
}

async function resetChartChildren(
  database: DrizzleDb,
  chartId: number,
): Promise<void> {
  // Cells first (FK to zones), then memberships, then zones. Order matters.
  await database.execute(
    sql`DELETE FROM award_chart_cells WHERE chart_id = ${chartId}`,
  );
  await database.execute(
    sql`DELETE FROM zone_memberships WHERE zone_id IN (SELECT id FROM award_chart_zones WHERE chart_id = ${chartId})`,
  );
  await database.execute(
    sql`DELETE FROM award_chart_zones WHERE chart_id = ${chartId}`,
  );
}

async function insertZones(
  database: DrizzleDb,
  chartId: number,
  defs: ZoneDef[],
): Promise<Map<string, number>> {
  const zoneIds = new Map<string, number>();
  for (const z of defs) {
    await database
      .insert(awardChartZones)
      .values({ chartId, code: z.code, name: z.name })
      .onConflictDoNothing();
    const [r] = await database
      .select({ id: awardChartZones.id })
      .from(awardChartZones)
      .where(
        and(eq(awardChartZones.chartId, chartId), eq(awardChartZones.code, z.code)),
      )
      .limit(1);
    if (!r) throw new Error(`Zone insert failed: ${z.code}`);
    zoneIds.set(z.code, r.id);
    const rows: Array<{
      zoneId: number;
      airportIata?: string;
      countryIso2?: string;
      region?: string;
    }> = [];
    for (const c of z.countries ?? []) rows.push({ zoneId: r.id, countryIso2: c });
    for (const a of z.airports ?? []) rows.push({ zoneId: r.id, airportIata: a });
    if (rows.length) {
      await database.insert(zoneMemberships).values(rows);
    }
  }
  return zoneIds;
}

async function insertBaCells(database: DrizzleDb, chartId: number): Promise<number> {
  let count = 0;
  for (const band of BA_DISTANCE_BANDS) {
    for (const cabin of ["Y", "W", "J", "F"] as const) {
      await database.insert(awardChartCells).values({
        chartId,
        cabin,
        distanceBandMinMi: band.minMi,
        distanceBandMaxMi: band.maxMi,
        milesOneWay: band[cabin],
      });
      count++;
    }
  }
  return count;
}

async function insertVsCells(database: DrizzleDb, chartId: number): Promise<number> {
  let count = 0;
  for (const band of VS_DISTANCE_BANDS) {
    for (const cabin of ["Y", "W", "J"] as const) {
      await database.insert(awardChartCells).values({
        chartId,
        cabin,
        distanceBandMinMi: band.minMi,
        distanceBandMaxMi: band.maxMi,
        milesOneWay: band[cabin],
      });
      count++;
    }
  }
  return count;
}

async function insertZoneCells<T extends { destZone: string; Y: number; J: number; F: number }>(
  database: DrizzleDb,
  chartId: number,
  zoneIds: Map<string, number>,
  originCode: string,
  cells: T[],
  cabins: Array<"Y" | "W" | "J" | "F">,
): Promise<number> {
  const originId = zoneIds.get(originCode);
  if (!originId) throw new Error(`Unknown origin zone: ${originCode}`);
  let count = 0;
  for (const c of cells) {
    const destId = zoneIds.get(c.destZone);
    if (!destId) continue;
    for (const cabin of cabins) {
      const miles = (c as unknown as Record<string, number>)[cabin];
      if (!miles) continue; // 0 = not published for that cabin
      // Outbound
      await database.insert(awardChartCells).values({
        chartId,
        originZoneId: originId,
        destZoneId: destId,
        cabin,
        milesOneWay: miles,
      });
      count++;
      // Inbound (symmetric — same miles)
      await database.insert(awardChartCells).values({
        chartId,
        originZoneId: destId,
        destZoneId: originId,
        cabin,
        milesOneWay: miles,
      });
      count++;
    }
  }
  return count;
}

// -----------------------------------------------------------------------------
// Public entrypoint — invoked from run.ts.
// -----------------------------------------------------------------------------

export interface AwardChartSeedSummary {
  charts: number;
  zones: number;
  zoneMemberships: number;
  cells: number;
}

export async function seedAwardCharts(database: DrizzleDb): Promise<AwardChartSeedSummary> {
  let charts = 0,
    zones = 0,
    memberships = 0,
    cells = 0;

  // BA — distance
  {
    const chartId = await upsertChart(database, {
      programId: "BA_AVIOS",
      chartType: "distance",
      scope: "OWN_METAL",
      sourceUrl: "https://www.britishairways.com/en-us/information/awards/award-table-redemptions",
      notes: "Distance-based, 8 bands × 4 cabins. Brutal YQ on BA-operated; see surchargeRule on awardChartRules.",
    });
    await resetChartChildren(database, chartId);
    charts++;
    cells += await insertBaCells(database, chartId);
  }

  // VS own-metal — distance
  {
    const chartId = await upsertChart(database, {
      programId: "VS_FLYING_CLUB",
      chartType: "distance",
      scope: "OWN_METAL",
      sourceUrl: "https://flyer.virginatlantic.com/uk/en/flying-club/your-account/award-pricing",
      notes: "Own-metal distance chart, 5 bands × 3 cabins (no F). Delta partner chart deferred.",
    });
    await resetChartChildren(database, chartId);
    charts++;
    cells += await insertVsCells(database, chartId);
  }

  // ANA — Star Alliance partner zones (outbound from Japan only — partial seed)
  {
    const chartId = await upsertChart(database, {
      programId: "NH_ANA",
      chartType: "zone",
      scope: "STAR_PARTNER",
      sourceUrl: "https://www.ana.co.jp/en/us/amc/reference/awardmiles/partners/",
      notes: "Star Alliance partner chart. RT-only program; OW = RT/2. Outbound-from-JP cells seeded; other zone-pairs use chart symmetry until full transcription lands.",
    });
    await resetChartChildren(database, chartId);
    charts++;
    const zoneIds = await insertZones(database, chartId, ANA_ZONES);
    zones += zoneIds.size;
    memberships += ANA_ZONES.reduce(
      (acc, z) => acc + (z.countries?.length ?? 0) + (z.airports?.length ?? 0),
      0,
    );
    cells += await insertZoneCells(
      database,
      chartId,
      zoneIds,
      "JP",
      ANA_FROM_JP,
      ["Y", "J", "F"],
    );
  }

  // CX — Asia Miles own-metal zones (outbound from HK — partial seed)
  {
    const chartId = await upsertChart(database, {
      programId: "CX_CATHAY",
      chartType: "zone",
      scope: "OWN_METAL",
      sourceUrl: "https://www.cathaypacific.com/cx/en_US/membership/asia-miles.html",
      notes: "Post-April 2025 chart refresh. Fuel surcharges per program rule (doubled Mar 2026, +34% Apr, -13% May). Outbound-from-HK cells seeded; other zone-pairs use chart symmetry until full transcription lands.",
    });
    await resetChartChildren(database, chartId);
    charts++;
    const zoneIds = await insertZones(database, chartId, CX_ZONES);
    zones += zoneIds.size;
    memberships += CX_ZONES.reduce(
      (acc, z) => acc + (z.countries?.length ?? 0) + (z.airports?.length ?? 0),
      0,
    );
    cells += await insertZoneCells(
      database,
      chartId,
      zoneIds,
      "HK",
      CX_FROM_HK,
      ["Y", "J", "F"],
    );
  }

  return { charts, zones, zoneMemberships: memberships, cells };
}
