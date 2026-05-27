import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  bigint,
  uuid,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { programs } from "./programs";
import { searchResults } from "./searches";
import { users } from "./users";

export const runStatusEnum = pgEnum("run_status", [
  "RUNNING",
  "SUCCESS",
  "PARTIAL",
  "FAILED",
  "CIRCUIT_OPEN",
]);

export const scraperRuns = pgTable(
  "scraper_runs",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    programId: varchar("program_id", { length: 32 })
      .notNull()
      .references(() => programs.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: runStatusEnum("status").notNull().default("RUNNING"),
    routesAttempted: integer("routes_attempted").notNull().default(0),
    routesSucceeded: integer("routes_succeeded").notNull().default(0),
    resultsCount: integer("results_count").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [
    index("runs_program_time_idx").on(t.programId, t.startedAt),
    index("runs_status_idx").on(t.status),
  ],
);

export const scraperErrors = pgTable(
  "scraper_errors",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    runId: bigint("run_id", { mode: "number" })
      .notNull()
      .references(() => scraperRuns.id),
    /** TIMEOUT | BLOCKED | SCHEMA_DRIFT | CAPTCHA_FAIL | ... */
    kind: varchar("kind", { length: 64 }).notNull(),
    message: text("message").notNull(),
    context: jsonb("context"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("errors_run_idx").on(t.runId),
    index("errors_kind_idx").on(t.kind, t.occurredAt),
  ],
);

export const bookingOutcomeEnum = pgEnum("booking_outcome", [
  "TICKETED",
  "HELD",
  "FAILED_AT_BOOKING",
  "FAILED_AT_TICKET",
  "PRICE_CHANGED",
  "NOT_ATTEMPTED",
]);

export const bookingOutcomes = pgTable(
  "booking_outcomes",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    searchResultId: bigint("search_result_id", { mode: "number" })
      .notNull()
      .references(() => searchResults.id),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    outcome: bookingOutcomeEnum("outcome").notNull(),
    actualMiles: integer("actual_miles"),
    actualSurchargeUsd: integer("actual_surcharge_usd"),
    reportedAt: timestamp("reported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    notes: text("notes"),
  },
  (t) => [
    index("outcomes_result_idx").on(t.searchResultId),
    index("outcomes_rollup_idx").on(t.outcome, t.reportedAt),
  ],
);
