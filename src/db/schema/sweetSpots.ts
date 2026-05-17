import {
  pgTable,
  text,
  varchar,
  integer,
  smallint,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { programs, cabinEnum } from "./programs";

export const sweetSpots = pgTable(
  "sweet_spots",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    programId: varchar("program_id", { length: 32 })
      .notNull()
      .references(() => programs.id),
    title: text("title").notNull(),
    /** {"originAirports":["JFK","BOS","EWR"],"destRegion":"AS-NE"} or similar */
    originPattern: jsonb("origin_pattern").notNull(),
    destPattern: jsonb("dest_pattern").notNull(),
    cabin: cabinEnum("cabin").notNull(),
    milesOneWay: integer("miles_one_way").notNull(),
    approxSurchargeUsd: integer("approx_surcharge_usd"),
    notes: text("notes"),
    sourceUrl: text("source_url"),
    liveCheckSpec: jsonb("live_check_spec"),
    curatedBy: text("curated_by"),
    rank: smallint("rank").notNull().default(50),
    /**
     * Categorization tags for filtering: ["transcon","premium-cabin","intra-asia",
     * "surcharge-free","stopover-friendly","family-friendly"]. GIN-indexed.
     */
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("sweet_program_cabin_idx")
      .on(t.programId, t.cabin)
      .where(sql`${t.active} = true`),
    index("sweet_rank_idx")
      .on(t.rank)
      .where(sql`${t.active} = true`),
    index("sweet_origin_gin").using("gin", t.originPattern),
    index("sweet_dest_gin").using("gin", t.destPattern),
    index("sweet_tags_gin").using("gin", t.tags),
  ],
);
