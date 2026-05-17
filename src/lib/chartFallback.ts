/**
 * Chart-only fallback row builder for /api/search.
 *
 * When no scraper has observed a (program, origin, dest) recently — and we
 * have a published award chart for that program — synthesize a low-confidence
 * "Chart-only" row from the seeded chart data instead of returning nothing.
 * This makes the chart seed work pay off immediately: the cockpit shows BA
 * Avios + ANA + CX + VS price estimates for any route the chart can answer,
 * even before scrapers come online.
 *
 * Confidence score is fixed at 15 (per src/lib/confidence.ts:22 → "Chart-only"
 * bucket) so the badge clearly signals this is an estimate, not live data.
 *
 * Returns null when the chart can't answer the query (origin/dest not in any
 * seeded zone, distance band out of range, etc.) — caller falls through to
 * `program_done: partial` as today.
 */

import { db } from "@/db";
import {
  awardCharts,
  awardChartCells,
  awardChartRules,
  awardChartZones,
  zoneMemberships,
} from "@/db/schema/awardCharts";
import { airports } from "@/db/schema/reference";
import { programs } from "@/db/schema/programs";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { itineraryHash, operatingFlightKey } from "./itineraryHash";
import type { Cabin, CabinPrice, ResultSegment, SearchResultRow } from "./types";

export interface ChartFallbackInput {
  programId: string;
  origin: string;
  dest: string;
  departDate: string;
  pax: number;
}

interface AirportRow {
  iata: string;
  latMicro: number;
  lonMicro: number;
  countryIso2: string;
}

/** Great-circle distance in statute miles. */
function haversineMiles(a: AirportRow, b: AirportRow): number {
  const R = 3958.7613; // mean Earth radius in miles
  const toRad = (microDeg: number) => (microDeg / 1_000_000) * (Math.PI / 180);
  const phi1 = toRad(a.latMicro);
  const phi2 = toRad(b.latMicro);
  const dPhi = phi2 - phi1;
  const dLambda = toRad(b.lonMicro - a.lonMicro);
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

interface ChartRow {
  id: number;
  chartType: "zone" | "region" | "distance" | "dynamic";
}

interface CellRow {
  cabin: Cabin;
  milesOneWay: number;
  surchargeFormula: unknown;
}

interface SurchargeRule {
  passthrough?: boolean;
  base_usd?: number;
  per_segment_usd_typical?: number;
}

function surchargeFromRule(rule: unknown): number {
  if (!rule || typeof rule !== "object") return 0;
  const r = rule as SurchargeRule;
  if (r.passthrough === false) return 0;
  return (r.base_usd ?? 0) + (r.per_segment_usd_typical ?? 0);
}

async function lookupDistanceCells(
  chartId: number,
  miles: number,
): Promise<CellRow[]> {
  return db
    .select({
      cabin: awardChartCells.cabin,
      milesOneWay: awardChartCells.milesOneWay,
      surchargeFormula: awardChartCells.surchargeFormula,
    })
    .from(awardChartCells)
    .where(
      and(
        eq(awardChartCells.chartId, chartId),
        lte(awardChartCells.distanceBandMinMi, miles),
        or(
          isNull(awardChartCells.distanceBandMaxMi),
          gte(awardChartCells.distanceBandMaxMi, miles),
        ),
      ),
    );
}

async function resolveZone(
  chartId: number,
  airport: AirportRow,
): Promise<number | null> {
  // Try airport-specific match first (e.g. Hawaii zone is airport-scoped),
  // then country fallback (most ANA/CX zones).
  const [byAirport] = await db
    .select({ id: awardChartZones.id })
    .from(zoneMemberships)
    .innerJoin(awardChartZones, eq(zoneMemberships.zoneId, awardChartZones.id))
    .where(
      and(
        eq(awardChartZones.chartId, chartId),
        eq(zoneMemberships.airportIata, airport.iata),
      ),
    )
    .limit(1);
  if (byAirport) return byAirport.id;

  const [byCountry] = await db
    .select({ id: awardChartZones.id })
    .from(zoneMemberships)
    .innerJoin(awardChartZones, eq(zoneMemberships.zoneId, awardChartZones.id))
    .where(
      and(
        eq(awardChartZones.chartId, chartId),
        eq(zoneMemberships.countryIso2, airport.countryIso2),
      ),
    )
    .limit(1);
  return byCountry?.id ?? null;
}

async function lookupZoneCells(
  chartId: number,
  originZoneId: number,
  destZoneId: number,
): Promise<CellRow[]> {
  return db
    .select({
      cabin: awardChartCells.cabin,
      milesOneWay: awardChartCells.milesOneWay,
      surchargeFormula: awardChartCells.surchargeFormula,
    })
    .from(awardChartCells)
    .where(
      and(
        eq(awardChartCells.chartId, chartId),
        eq(awardChartCells.originZoneId, originZoneId),
        eq(awardChartCells.destZoneId, destZoneId),
      ),
    );
}

export async function chartFallback(
  input: ChartFallbackInput,
): Promise<SearchResultRow | null> {
  if (!db) return null;

  const { programId, origin, dest, departDate, pax } = input;
  const now = new Date();

  // 1. Find the most-recent chart for this program (any scope; we currently
  //    seed at most one per program). Filter out expired charts.
  const [chart] = await db
    .select({
      id: awardCharts.id,
      chartType: awardCharts.chartType,
    })
    .from(awardCharts)
    .where(
      and(
        eq(awardCharts.programId, programId),
        or(
          isNull(awardCharts.effectiveTo),
          gte(awardCharts.effectiveTo, now),
        ),
      ),
    )
    .orderBy(desc(awardCharts.effectiveFrom))
    .limit(1);
  if (!chart) return null;
  const chartRow: ChartRow = chart;

  // 2. Look up both airports (needed for Haversine + zone resolution).
  const airportRows = await db
    .select({
      iata: airports.iata,
      latMicro: airports.latMicro,
      lonMicro: airports.lonMicro,
      countryIso2: airports.countryIso2,
    })
    .from(airports)
    .where(inArray(airports.iata, [origin, dest]));
  const originRow = airportRows.find((r) => r.iata === origin);
  const destRow = airportRows.find((r) => r.iata === dest);
  if (!originRow || !destRow) return null;

  // 3. Branch on chart type.
  let cells: CellRow[];
  let distanceMi: number | null = null;
  if (chartRow.chartType === "distance") {
    distanceMi = haversineMiles(originRow, destRow);
    cells = await lookupDistanceCells(chartRow.id, distanceMi);
  } else if (chartRow.chartType === "zone") {
    const [originZoneId, destZoneId] = await Promise.all([
      resolveZone(chartRow.id, originRow),
      resolveZone(chartRow.id, destRow),
    ]);
    if (!originZoneId || !destZoneId) return null;
    cells = await lookupZoneCells(chartRow.id, originZoneId, destZoneId);
  } else {
    // "region" + "dynamic" not supported by fallback (dynamic = no chart).
    return null;
  }
  if (cells.length === 0) return null;

  // 4. Program name + per-program surcharge rule.
  const [programInfo, ruleRow] = await Promise.all([
    db
      .select({ name: programs.name })
      .from(programs)
      .where(eq(programs.id, programId))
      .limit(1),
    db
      .select({ surchargeRule: awardChartRules.surchargeRule })
      .from(awardChartRules)
      .where(eq(awardChartRules.programId, programId))
      .limit(1),
  ]);
  const programName = programInfo[0]?.name ?? programId;
  const baseSurchargeUsd = surchargeFromRule(ruleRow[0]?.surchargeRule);

  // 5. Build cabinPrices map.
  const cabinPrices: Partial<Record<Cabin, CabinPrice>> = {};
  for (const cell of cells) {
    const perCellOverride = surchargeFromRule(cell.surchargeFormula);
    const surchargeUsd = perCellOverride || baseSurchargeUsd;
    cabinPrices[cell.cabin] = {
      cabin: cell.cabin,
      seatsRemaining: 0, // chart estimate — no live availability signal
      milesPerPax: cell.milesOneWay,
      surchargeUsdPerPax: surchargeUsd,
      taxesUsdPerPax: 0,
      cppMicroAtObs: null,
    };
  }
  if (Object.keys(cabinPrices).length === 0) return null;

  // 6. Synthetic single segment + composite keys. departAt set to noon UTC of
  //    the requested date so the row appears at a stable position when the
  //    cockpit sorts by departure time.
  const departAt = `${departDate}T12:00:00.000Z`;
  const segment: ResultSegment = {
    segmentOrder: 0,
    operatingAirlineIata: programId.slice(0, 2),
    marketingAirlineIata: programId.slice(0, 2),
    flightNumber: "CHART",
    originIata: origin,
    destIata: dest,
    departAt,
    arriveAt: departAt,
    aircraftIcao: null,
    segmentCabin: null,
    fareClass: null,
  };

  const hash = itineraryHash({
    programId,
    pax,
    departDate,
    segments: [segment],
  });

  const observedAt = now.toISOString();
  return {
    id: `${programId}_CHART_${hash.slice(0, 12)}`,
    itineraryHash: hash,
    programId,
    programName,
    originIata: origin,
    destIata: dest,
    departDate,
    arriveDate: departDate,
    totalDurationMin: distanceMi ? Math.max(60, Math.round(distanceMi / 8)) : 0,
    numSegments: 1,
    segments: [segment],
    cabinPrices,
    confidenceScore: 15,
    observedAt,
    lastSeenAt: observedAt,
    operatingFlightKey: operatingFlightKey(
      segment.operatingAirlineIata,
      "CHART",
      departAt,
    ),
  };
}
