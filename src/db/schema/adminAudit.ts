import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  bigint,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Append-only log of admin actions (chart edits, sweet spot edits, transfer
 * bonus updates, etc). Cheap insurance against a bad chart edit nuking pricing.
 * Surfaced in /admin as a history feed and used for forensic rollback.
 */
export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorEmail: text("actor_email").notNull(),
    /** "award_charts" | "sweet_spots" | "programs" | "transfer_bonuses" | ... */
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 128 }).notNull(),
    /** "create" | "update" | "delete" | "publish" | "revert" */
    action: varchar("action", { length: 32 }).notNull(),
    /** Before/after snapshot: { before: {...}, after: {...} } */
    diff: jsonb("diff").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId, t.occurredAt),
    index("audit_actor_idx").on(t.actorUserId, t.occurredAt),
    index("audit_time_idx").on(t.occurredAt),
  ],
);
