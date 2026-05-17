import {
  pgTable,
  text,
  varchar,
  smallint,
  timestamp,
  jsonb,
  bigint,
  index,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { searchResults } from "./searches";
import { programs } from "./programs";

export const signalKindEnum = pgEnum("signal_kind", [
  "FRESHNESS",
  "MULTI_SOURCE",
  "SHADOW_CONFIRM",
  "PROGRAM_RELIABILITY",
  "USER_REPORT",
  "ANOMALY",
]);

export const confidenceSignals = pgTable(
  "confidence_signals",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    searchResultId: bigint("search_result_id", { mode: "number" })
      .notNull()
      .references(() => searchResults.id, { onDelete: "cascade" }),
    kind: signalKindEnum("kind").notNull(),
    /** -100..+100 contribution. Confidence engine event-sources from these. */
    weight: smallint("weight").notNull(),
    payload: jsonb("payload"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("signals_result_idx").on(t.searchResultId, t.kind),
    check("weight_range", sql`${t.weight} BETWEEN -100 AND 100`),
  ],
);

export const shadowConfirmStatusEnum = pgEnum("shadow_confirm_status", [
  "PENDING",
  "CONFIRMED",
  "NOT_AVAILABLE",
  "ERROR",
]);

export const shadowConfirmations = pgTable(
  "shadow_confirmations",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    searchResultId: bigint("search_result_id", { mode: "number" })
      .notNull()
      .references(() => searchResults.id, { onDelete: "cascade" }),
    /** Program we re-checked through; sometimes a partner. */
    via: varchar("via", { length: 32 })
      .notNull()
      .references(() => programs.id),
    status: shadowConfirmStatusEnum("status").notNull().default("PENDING"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    raw: jsonb("raw"),
    /** Captured actual miles/surcharge at the fare-quote screen (pre-payment). */
    observedMiles: bigint("observed_miles", { mode: "number" }),
    observedSurchargeUsd: bigint("observed_surcharge_usd", { mode: "number" }),
  },
  (t) => [
    index("shadow_result_idx").on(t.searchResultId),
    index("shadow_pending_idx")
      .on(t.status)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);
