import {
  pgTable,
  text,
  varchar,
  integer,
  smallint,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { airlines } from "./reference";

/**
 * Cabin enum ordered Y < W < J < F.
 * Deliberate: `cabin >= 'J'` becomes a single BTREE range scan
 * (instead of `cabin IN ('J','F')` with expression rewriting).
 */
export const cabinEnum = pgEnum("cabin", ["Y", "W", "J", "F"]);

export const pricingModelEnum = pgEnum("pricing_model", [
  "chart",
  "dynamic",
  "hybrid",
]);

export const programs = pgTable(
  "programs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    sponsorAirlineIata: varchar("sponsor_airline_iata", { length: 2 }).references(
      () => airlines.iata,
    ),
    name: text("name").notNull(),
    pricingModel: pricingModelEnum("pricing_model").notNull(),
    /** 0 = never passes YQ, 1 = sometimes, 2 = always */
    fuelSurchargePassthrough: smallint("fuel_surcharge_passthrough").notNull(),
    expiryMonths: smallint("expiry_months"),
    active: boolean("active").default(true).notNull(),
    notes: text("notes"),
  },
  (t) => [
    index("programs_pricing_model_idx").on(t.pricingModel),
    index("programs_fuel_idx").on(t.fuelSurchargePassthrough),
  ],
);

/** Which program can ticket which operating airline; per-cabin fare-class map. */
export const programPartnerships = pgTable(
  "program_partnerships",
  {
    programId: varchar("program_id", { length: 32 })
      .notNull()
      .references(() => programs.id),
    operatingAirlineIata: varchar("operating_airline_iata", { length: 2 })
      .notNull()
      .references(() => airlines.iata),
    fareClassMap: jsonb("fare_class_map")
      .$type<Record<"Y" | "W" | "J" | "F", string[]>>()
      .notNull(),
    bookableOnline: boolean("bookable_online").default(true).notNull(),
    notes: text("notes"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
  },
  (t) => [
    primaryKey({
      columns: [t.programId, t.operatingAirlineIata, t.effectiveFrom],
    }),
    index("partnerships_program_idx").on(t.programId),
    index("partnerships_carrier_idx").on(t.operatingAirlineIata),
  ],
);

export const transferableCurrencies = pgTable("transferable_currencies", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: text("name").notNull(),
  issuer: text("issuer").notNull(),
  active: boolean("active").default(true).notNull(),
});

export const transferRatios = pgTable(
  "transfer_ratios",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    currencyId: varchar("currency_id", { length: 32 })
      .notNull()
      .references(() => transferableCurrencies.id),
    programId: varchar("program_id", { length: 32 })
      .notNull()
      .references(() => programs.id),
    /** currency_units -> program_units, scaled by 1000 (1:1 = 1000, 2:1 = 500). */
    ratioMicro: integer("ratio_micro").notNull(),
    minTransfer: integer("min_transfer").notNull().default(1000),
    increment: integer("increment").notNull().default(1000),
    active: boolean("active").default(true).notNull(),
  },
  (t) => [
    uniqueIndex("transfer_ratios_uniq").on(t.currencyId, t.programId),
    check("ratio_positive", sql`${t.ratioMicro} > 0`),
  ],
);

export const transferBonuses = pgTable(
  "transfer_bonuses",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    transferRatioId: integer("transfer_ratio_id")
      .notNull()
      .references(() => transferRatios.id),
    bonusPct: smallint("bonus_pct").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("bonuses_ratio_idx").on(t.transferRatioId),
    index("bonuses_active_idx").on(t.startsAt, t.endsAt),
    check("bonus_range", sql`${t.bonusPct} BETWEEN 1 AND 100`),
  ],
);

/** Versioned cents-per-point. XOR: exactly one of programId/currencyId set. */
export const valuations = pgTable(
  "valuations",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    programId: varchar("program_id", { length: 32 }).references(
      () => programs.id,
    ),
    currencyId: varchar("currency_id", { length: 32 }).references(
      () => transferableCurrencies.id,
    ),
    /** cents per point * 1000 (1.5 cpp -> 1500). */
    cppMicro: integer("cpp_micro").notNull(),
    source: text("source").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
  },
  (t) => [
    index("valuations_program_idx").on(t.programId, t.effectiveFrom),
    index("valuations_currency_idx").on(t.currencyId, t.effectiveFrom),
    check(
      "xor_program_currency",
      sql`(${t.programId} IS NOT NULL)::int + (${t.currencyId} IS NOT NULL)::int = 1`,
    ),
  ],
);
