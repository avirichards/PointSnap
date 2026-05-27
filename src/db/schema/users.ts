import {
  pgTable,
  text,
  varchar,
  integer,
  smallint,
  boolean,
  timestamp,
  uuid,
  primaryKey,
  index,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { programs, transferableCurrencies, cabinEnum } from "./programs";
import { airports } from "./reference";

/**
 * Subscription tier — paywall infrastructure baked in for v1.0 even though
 * everything is free at launch. Flipping paid tiers on becomes a config change,
 * not a migration. Gating logic lives in lib/features.ts.
 */
export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "day_pass",
  "pro",
  "elite",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Clerk user id; null only for legacy / test rows. */
  clerkUserId: varchar("clerk_user_id", { length: 64 }).unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  homeAirportIata: varchar("home_airport_iata", { length: 3 }).references(
    () => airports.iata,
  ),
  tier: subscriptionTierEnum("tier").notNull().default("free"),
  /** ISO timestamp current tier expires; null = perpetual (free, or active paid sub). */
  tierExpiresAt: timestamp("tier_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userWalletBalances = pgTable(
  "user_wallet_balances",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    programId: varchar("program_id", { length: 32 }).references(
      () => programs.id,
    ),
    currencyId: varchar("currency_id", { length: 32 }).references(
      () => transferableCurrencies.id,
    ),
    balance: integer("balance").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.programId, t.currencyId] }),
    check(
      "balance_xor",
      sql`(${t.programId} IS NOT NULL)::int + (${t.currencyId} IS NOT NULL)::int = 1`,
    ),
    index("wallet_user_idx").on(t.userId),
  ],
);

export const userCardHoldings = pgTable(
  "user_card_holdings",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardKey: varchar("card_key", { length: 64 }).notNull(),
    openedOn: timestamp("opened_on", { withTimezone: true }),
  },
  (t) => [index("cards_user_idx").on(t.userId)],
);

export const watcherFlexEnum = pgEnum("watcher_flex", [
  "EXACT",
  "PLUSMINUS_3",
  "MONTH",
]);

export const userWatchers = pgTable(
  "user_watchers",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    originIata: varchar("origin_iata", { length: 3 })
      .notNull()
      .references(() => airports.iata),
    destIata: varchar("dest_iata", { length: 3 })
      .notNull()
      .references(() => airports.iata),
    earliestDate: timestamp("earliest_date", { withTimezone: true }).notNull(),
    latestDate: timestamp("latest_date", { withTimezone: true }).notNull(),
    flex: watcherFlexEnum("flex").notNull().default("EXACT"),
    minCabin: cabinEnum("min_cabin").notNull().default("J"),
    pax: smallint("pax").notNull().default(1),
    maxMiles: integer("max_miles"),
    maxSurchargeUsd: integer("max_surcharge_usd"),
    /** Only fire if a program the user holds points for can ticket it. */
    walletGated: boolean("wallet_gated").default(true).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("watchers_route_date_idx")
      .on(t.originIata, t.destIata, t.earliestDate, t.latestDate)
      .where(sql`${t.active} = true`),
    index("watchers_user_idx").on(t.userId),
  ],
);

export const userAlerts = pgTable(
  "user_alerts",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    watcherId: integer("watcher_id")
      .notNull()
      .references(() => userWatchers.id, { onDelete: "cascade" }),
    /** Not FK'd — we hard-delete stale results during compaction. */
    searchResultId: integer("search_result_id").notNull(),
    firedAt: timestamp("fired_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    channel: varchar("channel", { length: 16 }).notNull(),
  },
  (t) => [index("alerts_watcher_idx").on(t.watcherId, t.firedAt)],
);

export const userNotificationPrefs = pgTable("user_notification_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  email: boolean("email").default(true).notNull(),
  push: boolean("push").default(false).notNull(),
  sms: boolean("sms").default(false).notNull(),
  quietHoursStart: smallint("quiet_hours_start"),
  quietHoursEnd: smallint("quiet_hours_end"),
  timezone: text("timezone").notNull().default("UTC"),
});
