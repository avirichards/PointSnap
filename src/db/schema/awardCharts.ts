import {
  pgTable,
  text,
  varchar,
  integer,
  smallint,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { programs, cabinEnum } from "./programs";
import { airports } from "./reference";

export const chartTypeEnum = pgEnum("chart_type", [
  "zone",
  "region",
  "distance",
  "dynamic",
]);

export const awardCharts = pgTable(
  "award_charts",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    programId: varchar("program_id", { length: 32 })
      .notNull()
      .references(() => programs.id),
    chartType: chartTypeEnum("chart_type").notNull(),
    /** Discriminator: OWN_METAL vs PARTNER vs ANA_STAR_PARTNER, etc. */
    scope: varchar("scope", { length: 32 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    sourceUrl: text("source_url"),
    notes: text("notes"),
  },
  (t) => [
    index("charts_program_idx").on(t.programId, t.effectiveFrom),
    uniqueIndex("charts_program_scope_from_uniq").on(
      t.programId,
      t.scope,
      t.effectiveFrom,
    ),
  ],
);

export const awardChartZones = pgTable(
  "award_chart_zones",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    chartId: integer("chart_id")
      .notNull()
      .references(() => awardCharts.id),
    code: varchar("code", { length: 32 }).notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("chart_zones_uniq").on(t.chartId, t.code)],
);

/** Each row: airport OR country wildcard OR region wildcard. Enforced by XOR check. */
export const zoneMemberships = pgTable(
  "zone_memberships",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    zoneId: integer("zone_id")
      .notNull()
      .references(() => awardChartZones.id),
    airportIata: varchar("airport_iata", { length: 3 }).references(
      () => airports.iata,
    ),
    countryIso2: varchar("country_iso2", { length: 2 }),
    region: varchar("region", { length: 32 }),
  },
  (t) => [
    index("zone_mem_zone_idx").on(t.zoneId),
    index("zone_mem_airport_idx").on(t.airportIata),
    index("zone_mem_country_idx").on(t.countryIso2),
    check(
      "zone_mem_one_of",
      sql`(${t.airportIata} IS NOT NULL)::int + (${t.countryIso2} IS NOT NULL)::int + (${t.region} IS NOT NULL)::int = 1`,
    ),
  ],
);

/** Unified cells: works for zone×zone (ANA), region×region (LH), distance bands (BA), dynamic (DL = chart with no cells). */
export const awardChartCells = pgTable(
  "award_chart_cells",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    chartId: integer("chart_id")
      .notNull()
      .references(() => awardCharts.id),
    originZoneId: integer("origin_zone_id").references(() => awardChartZones.id),
    destZoneId: integer("dest_zone_id").references(() => awardChartZones.id),
    cabin: cabinEnum("cabin").notNull(),
    distanceBandMinMi: integer("distance_band_min_mi"),
    distanceBandMaxMi: integer("distance_band_max_mi"),
    milesOneWay: integer("miles_one_way").notNull(),
    /** Per-cell surcharge override; null = use program-level rule. */
    surchargeFormula: jsonb("surcharge_formula"),
  },
  (t) => [
    index("cells_lookup_idx").on(
      t.chartId,
      t.originZoneId,
      t.destZoneId,
      t.cabin,
    ),
    index("cells_dist_idx").on(
      t.chartId,
      t.distanceBandMinMi,
      t.distanceBandMaxMi,
    ),
    check("miles_positive", sql`${t.milesOneWay} > 0`),
  ],
);

export const awardChartRules = pgTable(
  "award_chart_rules",
  {
    programId: varchar("program_id", { length: 32 })
      .primaryKey()
      .references(() => programs.id),
    /** -1 = unlimited */
    stopoversAllowed: smallint("stopovers_allowed").notNull(),
    stopoverFeeUsd: integer("stopover_fee_usd"),
    openJawAllowed: boolean("open_jaw_allowed").notNull(),
    /** PRORATE_DISTANCE | HIGHEST_CABIN | PER_SEGMENT | DISALLOWED */
    mixedCabinFormula: text("mixed_cabin_formula").notNull(),
    routingRules: jsonb("routing_rules").notNull(),
    surchargeRule: jsonb("surcharge_rule"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "mixed_cabin_valid",
      sql`${t.mixedCabinFormula} IN ('PRORATE_DISTANCE','HIGHEST_CABIN','PER_SEGMENT','DISALLOWED')`,
    ),
  ],
);
