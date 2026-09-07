import {
  pgTable,
  varchar,
  integer,
  smallint,
  timestamp,
  jsonb,
  uuid,
  bigint,
  primaryKey,
  uniqueIndex,
  index,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { airlines, airports } from "./reference";
import { programs, cabinEnum } from "./programs";
import { users } from "./users";

export const searchTriggerEnum = pgEnum("search_trigger", [
  "USER",
  "WATCHER",
  "SCHEDULED",
  "BACKFILL",
]);

/** One user-initiated or scheduled query; may fan out to N programs. */
export const searches = pgTable(
  "searches",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    originIata: varchar("origin_iata", { length: 3 })
      .notNull()
      .references(() => airports.iata),
    destIata: varchar("dest_iata", { length: 3 })
      .notNull()
      .references(() => airports.iata),
    departDate: timestamp("depart_date", { withTimezone: false }).notNull(),
    returnDate: timestamp("return_date", { withTimezone: false }),
    pax: smallint("pax").notNull().default(1),
    minCabin: cabinEnum("min_cabin").notNull().default("Y"),
    trigger: searchTriggerEnum("trigger").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("searches_route_date_idx").on(t.originIata, t.destIata, t.departDate),
    index("searches_user_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * CURRENT canonical result. One row per (origin, dest, departDate, program, itinerary-hash).
 * Mutated on re-scrape; every observation is also dual-written to search_results_history.
 */
export const searchResults = pgTable(
  "search_results",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    /** Logical upsert key. SHA256 of canonical itinerary serialization. */
    itineraryHash: varchar("itinerary_hash", { length: 64 }).notNull(),
    programId: varchar("program_id", { length: 32 })
      .notNull()
      .references(() => programs.id),
    originIata: varchar("origin_iata", { length: 3 })
      .notNull()
      .references(() => airports.iata),
    destIata: varchar("dest_iata", { length: 3 })
      .notNull()
      .references(() => airports.iata),
    departDate: timestamp("depart_date", { withTimezone: false }).notNull(),
    arriveDate: timestamp("arrive_date", { withTimezone: false }).notNull(),
    pax: smallint("pax").notNull().default(1),
    totalDurationMin: integer("total_duration_min").notNull(),
    numSegments: smallint("num_segments").notNull(),
    cabinsAvailable: cabinEnum("cabins_available").array().notNull(),
    confidenceScore: smallint("confidence_score").notNull().default(50),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    scraperRunId: bigint("scraper_run_id", { mode: "number" }),
  },
  (t) => [
    index("results_hot_idx").on(
      t.originIata,
      t.destIata,
      t.departDate,
      t.programId,
    ),
    uniqueIndex("results_itin_uniq").on(
      t.itineraryHash,
      t.programId,
      t.departDate,
    ),
    index("results_cabins_gin").using("gin", t.cabinsAvailable),
    index("results_freshness_idx").on(t.lastSeenAt),
    check("conf_range", sql`${t.confidenceScore} BETWEEN 0 AND 100`),
  ],
);

export const resultSegments = pgTable(
  "result_segments",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    searchResultId: bigint("search_result_id", { mode: "number" })
      .notNull()
      .references(() => searchResults.id, { onDelete: "cascade" }),
    segmentOrder: smallint("segment_order").notNull(),
    operatingAirlineIata: varchar("operating_airline_iata", { length: 2 })
      .notNull()
      .references(() => airlines.iata),
    marketingAirlineIata: varchar("marketing_airline_iata", { length: 2 })
      .notNull()
      .references(() => airlines.iata),
    flightNumber: varchar("flight_number", { length: 8 }).notNull(),
    originIata: varchar("origin_iata", { length: 3 })
      .notNull()
      .references(() => airports.iata),
    destIata: varchar("dest_iata", { length: 3 })
      .notNull()
      .references(() => airports.iata),
    departAt: timestamp("depart_at", { withTimezone: true }).notNull(),
    arriveAt: timestamp("arrive_at", { withTimezone: true }).notNull(),
    // FK to aircraft_types.icao intentionally dropped in the live DB
    // (migration 20260519212716) — carriers mint new aircraft codes faster
    // than we seed them (e.g. Alaska's 737 MAX 9 = "7M9"), so a NULL display
    // join is preferable to a scraper write failure. Kept as a plain column
    // here so drizzle-kit does not try to re-add the constraint.
    aircraftIcao: varchar("aircraft_icao", { length: 4 }),
    /** Fare class booked on the operating carrier. Required for shadow-confirm matching. */
    fareClass: varchar("fare_class", { length: 2 }),
    segmentCabin: cabinEnum("segment_cabin"),
    /**
     * Deterministic key for the operating flight (operator + flight# + depart_at).
     * Enables "1 flight, N ways to book" multi-program collapse via index lookup
     * instead of a multi-column self-join. Computed at insert time.
     * Format: `${IATA}${flight#}@${YYYYMMDDTHHMM}`
     */
    operatingFlightKey: varchar("operating_flight_key", { length: 40 }).notNull(),
  },
  (t) => [
    index("segments_result_idx").on(t.searchResultId, t.segmentOrder),
    index("segments_operator_idx").on(
      t.operatingAirlineIata,
      t.flightNumber,
      t.departAt,
    ),
    /** The "collapse-by-flight" lookup. */
    index("segments_op_flight_key_idx").on(t.operatingFlightKey),
  ],
);

/**
 * THE table that enables "all cabins per flight in one row-set".
 * One row per (result, cabin). Y+J+F open => 3 rows here.
 * Sortable, joinable, side-by-side in the spreadsheet.
 */
export const resultCabinPrices = pgTable(
  "result_cabin_prices",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    searchResultId: bigint("search_result_id", { mode: "number" })
      .notNull()
      .references(() => searchResults.id, { onDelete: "cascade" }),
    cabin: cabinEnum("cabin").notNull(),
    seatsRemaining: smallint("seats_remaining").notNull(),
    milesPerPax: integer("miles_per_pax").notNull(),
    /** Per-program: BA passes YQ, Aeroplan doesn't. */
    surchargeUsdPerPax: integer("surcharge_usd_per_pax").notNull(),
    taxesUsdPerPax: integer("taxes_usd_per_pax").notNull(),
    perPaxBreakdown: jsonb("per_pax_breakdown").$type<
      Array<{
        paxIndex: number;
        cabin: "Y" | "W" | "J" | "F";
        miles: number;
        surchargeUsd: number;
      }>
    >(),
    /** Denormalized cpp at observation time for "best deal" sort without join. */
    cppMicroAtObs: integer("cpp_micro_at_obs"),
  },
  (t) => [
    uniqueIndex("cabin_prices_uniq").on(t.searchResultId, t.cabin),
    index("cabin_prices_miles_idx").on(t.cabin, t.milesPerPax),
    index("cabin_prices_result_idx").on(t.searchResultId),
    check("seats_nonneg", sql`${t.seatsRemaining} >= 0`),
  ],
);

/**
 * Append-only history. Same shape as search_results but cabin prices flattened
 * into JSONB so each snapshot is one row regardless of cabin count.
 * Partitioned by month on observed_at via a hand-authored follow-up migration
 * (Drizzle can't express declarative partitioning yet).
 */
export const searchResultsHistory = pgTable(
  "search_results_history",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    itineraryHash: varchar("itinerary_hash", { length: 64 }).notNull(),
    programId: varchar("program_id", { length: 32 }).notNull(),
    originIata: varchar("origin_iata", { length: 3 }).notNull(),
    destIata: varchar("dest_iata", { length: 3 }).notNull(),
    departDate: timestamp("depart_date", { withTimezone: false }).notNull(),
    numSegments: smallint("num_segments").notNull(),
    cabinsAvailable: cabinEnum("cabins_available").array().notNull(),
    /** {"J":{"miles":75000,"seats":3,"surchargeUsd":36},...} */
    cabinPrices: jsonb("cabin_prices").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    confidenceScore: smallint("confidence_score").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.observedAt] }),
    index("history_route_prog_idx").on(
      t.originIata,
      t.destIata,
      t.programId,
      t.departDate,
      t.observedAt,
    ),
    index("history_obs_idx").on(t.observedAt),
  ],
);
