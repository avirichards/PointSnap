import {
  pgTable,
  text,
  varchar,
  integer,
  smallint,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { programs } from "./programs";

/**
 * Pool of scraper account credentials, one row per airline account.
 *
 * The actual usernames + passwords live in Fly secrets (rotation-friendly,
 * never plain-text in DB). This table stores the metadata: which accounts
 * exist, their env-var names, last-used-at for LRU rotation, ban status,
 * per-account hourly rate-limit counters. See python-workers/common/
 * account_pool.py for the runtime side.
 */
export const accountPool = pgTable(
  "account_pool",
  {
    /** "{PROGRAM_ID}_ACCOUNT_{N}", e.g. "BA_AVIOS_ACCOUNT_1". */
    id: text("id").primaryKey(),
    programId: varchar("program_id", { length: 32 })
      .notNull()
      .references(() => programs.id),
    /** 1-based slot per program. */
    accountIndex: smallint("account_index").notNull(),
    /** Fly secret name holding the username, e.g. "BA_ACCOUNT_1_USER". */
    envUserVar: text("env_user_var").notNull(),
    envPassVar: text("env_pass_var").notNull(),
    /** active | banned | exhausted | disabled */
    status: varchar("status", { length: 16 }).notNull().default("active"),
    /** Last known mile balance (used to gate LH M&M which requires 7K+). */
    balanceMiles: integer("balance_miles"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    searchesToday: integer("searches_today").notNull().default(0),
    hourlyWindowStart: timestamp("hourly_window_start", { withTimezone: true })
      .notNull()
      .defaultNow(),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    banReason: text("ban_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("account_pool_program_idx_uniq").on(t.programId, t.accountIndex),
    index("account_pool_program_status_idx").on(
      t.programId,
      t.status,
      t.lastUsedAt,
    ),
    index("account_pool_status_idx").on(t.status),
    check(
      "account_pool_status_chk",
      sql`${t.status} IN ('active','banned','exhausted','disabled')`,
    ),
  ],
);
