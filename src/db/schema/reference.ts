import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const alliances = pgTable("alliances", {
  id: varchar("id", { length: 16 }).primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const airlines = pgTable(
  "airlines",
  {
    iata: varchar("iata", { length: 2 }).primaryKey(),
    icao: varchar("icao", { length: 3 }).notNull().unique(),
    name: text("name").notNull(),
    allianceId: varchar("alliance_id", { length: 16 }).references(
      () => alliances.id,
    ),
    countryIso2: varchar("country_iso2", { length: 2 }).notNull(),
    active: boolean("active").default(true).notNull(),
  },
  (t) => [index("airlines_alliance_idx").on(t.allianceId)],
);

export const airports = pgTable(
  "airports",
  {
    iata: varchar("iata", { length: 3 }).primaryKey(),
    icao: varchar("icao", { length: 4 }),
    name: text("name").notNull(),
    city: text("city").notNull(),
    countryIso2: varchar("country_iso2", { length: 2 }).notNull(),
    region: varchar("region", { length: 32 }).notNull(),
    /** lat * 1e6, integer to dodge float round-trip */
    latMicro: integer("lat_micro").notNull(),
    lonMicro: integer("lon_micro").notNull(),
    tzOlson: text("tz_olson").notNull(),
    active: boolean("active").default(true).notNull(),
  },
  (t) => [
    index("airports_country_idx").on(t.countryIso2),
    index("airports_region_idx").on(t.region),
  ],
);

export const aircraftTypes = pgTable("aircraft_types", {
  icao: varchar("icao", { length: 4 }).primaryKey(),
  iata: varchar("iata", { length: 3 }),
  name: text("name").notNull(),
  widebody: boolean("widebody").notNull(),
});
