CREATE TYPE "public"."cabin" AS ENUM('Y', 'W', 'J', 'F');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('chart', 'dynamic', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."chart_type" AS ENUM('zone', 'region', 'distance', 'dynamic');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('free', 'day_pass', 'pro', 'elite');--> statement-breakpoint
CREATE TYPE "public"."watcher_flex" AS ENUM('EXACT', 'PLUSMINUS_3', 'MONTH');--> statement-breakpoint
CREATE TYPE "public"."search_trigger" AS ENUM('USER', 'WATCHER', 'SCHEDULED', 'BACKFILL');--> statement-breakpoint
CREATE TYPE "public"."shadow_confirm_status" AS ENUM('PENDING', 'CONFIRMED', 'NOT_AVAILABLE', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."signal_kind" AS ENUM('FRESHNESS', 'MULTI_SOURCE', 'SHADOW_CONFIRM', 'PROGRAM_RELIABILITY', 'USER_REPORT', 'ANOMALY');--> statement-breakpoint
CREATE TYPE "public"."booking_outcome" AS ENUM('TICKETED', 'HELD', 'FAILED_AT_BOOKING', 'FAILED_AT_TICKET', 'PRICE_CHANGED', 'NOT_ATTEMPTED');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'CIRCUIT_OPEN');--> statement-breakpoint
CREATE TABLE "aircraft_types" (
	"icao" varchar(4) PRIMARY KEY NOT NULL,
	"iata" varchar(3),
	"name" text NOT NULL,
	"widebody" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "airlines" (
	"iata" varchar(2) PRIMARY KEY NOT NULL,
	"icao" varchar(3) NOT NULL,
	"name" text NOT NULL,
	"alliance_id" varchar(16),
	"country_iso2" varchar(2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "airlines_icao_unique" UNIQUE("icao")
);
--> statement-breakpoint
CREATE TABLE "airports" (
	"iata" varchar(3) PRIMARY KEY NOT NULL,
	"icao" varchar(4),
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country_iso2" varchar(2) NOT NULL,
	"region" varchar(32) NOT NULL,
	"lat_micro" integer NOT NULL,
	"lon_micro" integer NOT NULL,
	"tz_olson" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alliances" (
	"id" varchar(16) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_partnerships" (
	"program_id" varchar(32) NOT NULL,
	"operating_airline_iata" varchar(2) NOT NULL,
	"fare_class_map" jsonb NOT NULL,
	"bookable_online" boolean DEFAULT true NOT NULL,
	"notes" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "program_partnerships_program_id_operating_airline_iata_effective_from_pk" PRIMARY KEY("program_id","operating_airline_iata","effective_from")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"sponsor_airline_iata" varchar(2),
	"name" text NOT NULL,
	"pricing_model" "pricing_model" NOT NULL,
	"fuel_surcharge_passthrough" smallint NOT NULL,
	"expiry_months" smallint,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "transfer_bonuses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_bonuses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transfer_ratio_id" integer NOT NULL,
	"bonus_pct" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonus_range" CHECK ("transfer_bonuses"."bonus_pct" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "transfer_ratios" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_ratios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"currency_id" varchar(32) NOT NULL,
	"program_id" varchar(32) NOT NULL,
	"ratio_micro" integer NOT NULL,
	"min_transfer" integer DEFAULT 1000 NOT NULL,
	"increment" integer DEFAULT 1000 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ratio_positive" CHECK ("transfer_ratios"."ratio_micro" > 0)
);
--> statement-breakpoint
CREATE TABLE "transferable_currencies" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "valuations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"program_id" varchar(32),
	"currency_id" varchar(32),
	"cpp_micro" integer NOT NULL,
	"source" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "xor_program_currency" CHECK (("valuations"."program_id" IS NOT NULL)::int + ("valuations"."currency_id" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "award_chart_cells" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "award_chart_cells_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chart_id" integer NOT NULL,
	"origin_zone_id" integer,
	"dest_zone_id" integer,
	"cabin" "cabin" NOT NULL,
	"distance_band_min_mi" integer,
	"distance_band_max_mi" integer,
	"miles_one_way" integer NOT NULL,
	"surcharge_formula" jsonb,
	CONSTRAINT "miles_positive" CHECK ("award_chart_cells"."miles_one_way" > 0)
);
--> statement-breakpoint
CREATE TABLE "award_chart_rules" (
	"program_id" varchar(32) PRIMARY KEY NOT NULL,
	"stopovers_allowed" smallint NOT NULL,
	"stopover_fee_usd" integer,
	"open_jaw_allowed" boolean NOT NULL,
	"mixed_cabin_formula" text NOT NULL,
	"routing_rules" jsonb NOT NULL,
	"surcharge_rule" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mixed_cabin_valid" CHECK ("award_chart_rules"."mixed_cabin_formula" IN ('PRORATE_DISTANCE','HIGHEST_CABIN','PER_SEGMENT','DISALLOWED'))
);
--> statement-breakpoint
CREATE TABLE "award_chart_zones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "award_chart_zones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chart_id" integer NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "award_charts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "award_charts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"program_id" varchar(32) NOT NULL,
	"chart_type" chart_type NOT NULL,
	"scope" varchar(32) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source_url" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "zone_memberships" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zone_memberships_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"zone_id" integer NOT NULL,
	"airport_iata" varchar(3),
	"country_iso2" varchar(2),
	"region" varchar(32),
	CONSTRAINT "zone_mem_one_of" CHECK (("zone_memberships"."airport_iata" IS NOT NULL)::int + ("zone_memberships"."country_iso2" IS NOT NULL)::int + ("zone_memberships"."region" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "user_alerts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"watcher_id" integer NOT NULL,
	"search_result_id" integer NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"channel" varchar(16) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_card_holdings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_card_holdings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"card_key" varchar(64) NOT NULL,
	"opened_on" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_notification_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT false NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" smallint,
	"quiet_hours_end" smallint,
	"timezone" text DEFAULT 'UTC' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_wallet_balances" (
	"user_id" uuid NOT NULL,
	"program_id" varchar(32),
	"currency_id" varchar(32),
	"balance" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_wallet_balances_user_id_program_id_currency_id_pk" PRIMARY KEY("user_id","program_id","currency_id"),
	CONSTRAINT "balance_xor" CHECK (("user_wallet_balances"."program_id" IS NOT NULL)::int + ("user_wallet_balances"."currency_id" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "user_watchers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_watchers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"origin_iata" varchar(3) NOT NULL,
	"dest_iata" varchar(3) NOT NULL,
	"earliest_date" timestamp with time zone NOT NULL,
	"latest_date" timestamp with time zone NOT NULL,
	"flex" "watcher_flex" DEFAULT 'EXACT' NOT NULL,
	"min_cabin" "cabin" DEFAULT 'J' NOT NULL,
	"pax" smallint DEFAULT 1 NOT NULL,
	"max_miles" integer,
	"max_surcharge_usd" integer,
	"wallet_gated" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" varchar(64),
	"email" text NOT NULL,
	"display_name" text,
	"home_airport_iata" varchar(3),
	"tier" "subscription_tier" DEFAULT 'free' NOT NULL,
	"tier_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "result_cabin_prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "result_cabin_prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"search_result_id" bigint NOT NULL,
	"cabin" "cabin" NOT NULL,
	"seats_remaining" smallint NOT NULL,
	"miles_per_pax" integer NOT NULL,
	"surcharge_usd_per_pax" integer NOT NULL,
	"taxes_usd_per_pax" integer NOT NULL,
	"per_pax_breakdown" jsonb,
	"cpp_micro_at_obs" integer,
	CONSTRAINT "seats_nonneg" CHECK ("result_cabin_prices"."seats_remaining" >= 0)
);
--> statement-breakpoint
CREATE TABLE "result_segments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "result_segments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"search_result_id" bigint NOT NULL,
	"segment_order" smallint NOT NULL,
	"operating_airline_iata" varchar(2) NOT NULL,
	"marketing_airline_iata" varchar(2) NOT NULL,
	"flight_number" varchar(8) NOT NULL,
	"origin_iata" varchar(3) NOT NULL,
	"dest_iata" varchar(3) NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"aircraft_icao" varchar(4),
	"fare_class" varchar(2),
	"segment_cabin" "cabin",
	"operating_flight_key" varchar(40) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_results" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "search_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itinerary_hash" varchar(64) NOT NULL,
	"program_id" varchar(32) NOT NULL,
	"origin_iata" varchar(3) NOT NULL,
	"dest_iata" varchar(3) NOT NULL,
	"depart_date" timestamp NOT NULL,
	"arrive_date" timestamp NOT NULL,
	"pax" smallint DEFAULT 1 NOT NULL,
	"total_duration_min" integer NOT NULL,
	"num_segments" smallint NOT NULL,
	"cabins_available" "cabin"[] NOT NULL,
	"confidence_score" smallint DEFAULT 50 NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"scraper_run_id" bigint,
	CONSTRAINT "conf_range" CHECK ("search_results"."confidence_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "search_results_history" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "search_results_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itinerary_hash" varchar(64) NOT NULL,
	"program_id" varchar(32) NOT NULL,
	"origin_iata" varchar(3) NOT NULL,
	"dest_iata" varchar(3) NOT NULL,
	"depart_date" timestamp NOT NULL,
	"num_segments" smallint NOT NULL,
	"cabins_available" "cabin"[] NOT NULL,
	"cabin_prices" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"confidence_score" smallint NOT NULL,
	CONSTRAINT "search_results_history_id_observed_at_pk" PRIMARY KEY("id","observed_at")
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "searches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid,
	"origin_iata" varchar(3) NOT NULL,
	"dest_iata" varchar(3) NOT NULL,
	"depart_date" timestamp NOT NULL,
	"return_date" timestamp,
	"pax" smallint DEFAULT 1 NOT NULL,
	"min_cabin" "cabin" DEFAULT 'Y' NOT NULL,
	"trigger" "search_trigger" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confidence_signals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "confidence_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"search_result_id" bigint NOT NULL,
	"kind" "signal_kind" NOT NULL,
	"weight" smallint NOT NULL,
	"payload" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_range" CHECK ("confidence_signals"."weight" BETWEEN -100 AND 100)
);
--> statement-breakpoint
CREATE TABLE "shadow_confirmations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "shadow_confirmations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"search_result_id" bigint NOT NULL,
	"via" varchar(32) NOT NULL,
	"status" "shadow_confirm_status" DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"raw" jsonb,
	"observed_miles" bigint,
	"observed_surcharge_usd" bigint
);
--> statement-breakpoint
CREATE TABLE "booking_outcomes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "booking_outcomes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"search_result_id" bigint NOT NULL,
	"user_id" uuid,
	"outcome" "booking_outcome" NOT NULL,
	"actual_miles" integer,
	"actual_surcharge_usd" integer,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "scraper_errors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scraper_errors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" bigint NOT NULL,
	"kind" varchar(64) NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraper_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scraper_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"program_id" varchar(32) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "run_status" DEFAULT 'RUNNING' NOT NULL,
	"routes_attempted" integer DEFAULT 0 NOT NULL,
	"routes_succeeded" integer DEFAULT 0 NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sweet_spots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sweet_spots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"program_id" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"origin_pattern" jsonb NOT NULL,
	"dest_pattern" jsonb NOT NULL,
	"cabin" "cabin" NOT NULL,
	"miles_one_way" integer NOT NULL,
	"approx_surcharge_usd" integer,
	"notes" text,
	"source_url" text,
	"live_check_spec" jsonb,
	"curated_by" text,
	"rank" smallint DEFAULT 50 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"actor_email" text NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(128) NOT NULL,
	"action" varchar(32) NOT NULL,
	"diff" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "airlines" ADD CONSTRAINT "airlines_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_partnerships" ADD CONSTRAINT "program_partnerships_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_partnerships" ADD CONSTRAINT "program_partnerships_operating_airline_iata_airlines_iata_fk" FOREIGN KEY ("operating_airline_iata") REFERENCES "public"."airlines"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_sponsor_airline_iata_airlines_iata_fk" FOREIGN KEY ("sponsor_airline_iata") REFERENCES "public"."airlines"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_bonuses" ADD CONSTRAINT "transfer_bonuses_transfer_ratio_id_transfer_ratios_id_fk" FOREIGN KEY ("transfer_ratio_id") REFERENCES "public"."transfer_ratios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_ratios" ADD CONSTRAINT "transfer_ratios_currency_id_transferable_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."transferable_currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_ratios" ADD CONSTRAINT "transfer_ratios_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_currency_id_transferable_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."transferable_currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_chart_cells" ADD CONSTRAINT "award_chart_cells_chart_id_award_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."award_charts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_chart_cells" ADD CONSTRAINT "award_chart_cells_origin_zone_id_award_chart_zones_id_fk" FOREIGN KEY ("origin_zone_id") REFERENCES "public"."award_chart_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_chart_cells" ADD CONSTRAINT "award_chart_cells_dest_zone_id_award_chart_zones_id_fk" FOREIGN KEY ("dest_zone_id") REFERENCES "public"."award_chart_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_chart_rules" ADD CONSTRAINT "award_chart_rules_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_chart_zones" ADD CONSTRAINT "award_chart_zones_chart_id_award_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."award_charts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_charts" ADD CONSTRAINT "award_charts_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_memberships" ADD CONSTRAINT "zone_memberships_zone_id_award_chart_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."award_chart_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone_memberships" ADD CONSTRAINT "zone_memberships_airport_iata_airports_iata_fk" FOREIGN KEY ("airport_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_alerts" ADD CONSTRAINT "user_alerts_watcher_id_user_watchers_id_fk" FOREIGN KEY ("watcher_id") REFERENCES "public"."user_watchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_card_holdings" ADD CONSTRAINT "user_card_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_prefs" ADD CONSTRAINT "user_notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallet_balances" ADD CONSTRAINT "user_wallet_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallet_balances" ADD CONSTRAINT "user_wallet_balances_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallet_balances" ADD CONSTRAINT "user_wallet_balances_currency_id_transferable_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."transferable_currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_watchers" ADD CONSTRAINT "user_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_watchers" ADD CONSTRAINT "user_watchers_origin_iata_airports_iata_fk" FOREIGN KEY ("origin_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_watchers" ADD CONSTRAINT "user_watchers_dest_iata_airports_iata_fk" FOREIGN KEY ("dest_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_airport_iata_airports_iata_fk" FOREIGN KEY ("home_airport_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_cabin_prices" ADD CONSTRAINT "result_cabin_prices_search_result_id_search_results_id_fk" FOREIGN KEY ("search_result_id") REFERENCES "public"."search_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_segments" ADD CONSTRAINT "result_segments_search_result_id_search_results_id_fk" FOREIGN KEY ("search_result_id") REFERENCES "public"."search_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_segments" ADD CONSTRAINT "result_segments_operating_airline_iata_airlines_iata_fk" FOREIGN KEY ("operating_airline_iata") REFERENCES "public"."airlines"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_segments" ADD CONSTRAINT "result_segments_marketing_airline_iata_airlines_iata_fk" FOREIGN KEY ("marketing_airline_iata") REFERENCES "public"."airlines"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_segments" ADD CONSTRAINT "result_segments_origin_iata_airports_iata_fk" FOREIGN KEY ("origin_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_segments" ADD CONSTRAINT "result_segments_dest_iata_airports_iata_fk" FOREIGN KEY ("dest_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_segments" ADD CONSTRAINT "result_segments_aircraft_icao_aircraft_types_icao_fk" FOREIGN KEY ("aircraft_icao") REFERENCES "public"."aircraft_types"("icao") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_origin_iata_airports_iata_fk" FOREIGN KEY ("origin_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_dest_iata_airports_iata_fk" FOREIGN KEY ("dest_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_origin_iata_airports_iata_fk" FOREIGN KEY ("origin_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_dest_iata_airports_iata_fk" FOREIGN KEY ("dest_iata") REFERENCES "public"."airports"("iata") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confidence_signals" ADD CONSTRAINT "confidence_signals_search_result_id_search_results_id_fk" FOREIGN KEY ("search_result_id") REFERENCES "public"."search_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_confirmations" ADD CONSTRAINT "shadow_confirmations_search_result_id_search_results_id_fk" FOREIGN KEY ("search_result_id") REFERENCES "public"."search_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_confirmations" ADD CONSTRAINT "shadow_confirmations_via_programs_id_fk" FOREIGN KEY ("via") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_outcomes" ADD CONSTRAINT "booking_outcomes_search_result_id_search_results_id_fk" FOREIGN KEY ("search_result_id") REFERENCES "public"."search_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_outcomes" ADD CONSTRAINT "booking_outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraper_errors" ADD CONSTRAINT "scraper_errors_run_id_scraper_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scraper_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraper_runs" ADD CONSTRAINT "scraper_runs_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweet_spots" ADD CONSTRAINT "sweet_spots_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "airlines_alliance_idx" ON "airlines" USING btree ("alliance_id");--> statement-breakpoint
CREATE INDEX "airports_country_idx" ON "airports" USING btree ("country_iso2");--> statement-breakpoint
CREATE INDEX "airports_region_idx" ON "airports" USING btree ("region");--> statement-breakpoint
CREATE INDEX "partnerships_program_idx" ON "program_partnerships" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "partnerships_carrier_idx" ON "program_partnerships" USING btree ("operating_airline_iata");--> statement-breakpoint
CREATE INDEX "programs_pricing_model_idx" ON "programs" USING btree ("pricing_model");--> statement-breakpoint
CREATE INDEX "programs_fuel_idx" ON "programs" USING btree ("fuel_surcharge_passthrough");--> statement-breakpoint
CREATE INDEX "bonuses_ratio_idx" ON "transfer_bonuses" USING btree ("transfer_ratio_id");--> statement-breakpoint
CREATE INDEX "bonuses_active_idx" ON "transfer_bonuses" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_ratios_uniq" ON "transfer_ratios" USING btree ("currency_id","program_id");--> statement-breakpoint
CREATE INDEX "valuations_program_idx" ON "valuations" USING btree ("program_id","effective_from");--> statement-breakpoint
CREATE INDEX "valuations_currency_idx" ON "valuations" USING btree ("currency_id","effective_from");--> statement-breakpoint
CREATE INDEX "cells_lookup_idx" ON "award_chart_cells" USING btree ("chart_id","origin_zone_id","dest_zone_id","cabin");--> statement-breakpoint
CREATE INDEX "cells_dist_idx" ON "award_chart_cells" USING btree ("chart_id","distance_band_min_mi","distance_band_max_mi");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_zones_uniq" ON "award_chart_zones" USING btree ("chart_id","code");--> statement-breakpoint
CREATE INDEX "charts_program_idx" ON "award_charts" USING btree ("program_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "charts_program_scope_from_uniq" ON "award_charts" USING btree ("program_id","scope","effective_from");--> statement-breakpoint
CREATE INDEX "zone_mem_zone_idx" ON "zone_memberships" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "zone_mem_airport_idx" ON "zone_memberships" USING btree ("airport_iata");--> statement-breakpoint
CREATE INDEX "zone_mem_country_idx" ON "zone_memberships" USING btree ("country_iso2");--> statement-breakpoint
CREATE INDEX "alerts_watcher_idx" ON "user_alerts" USING btree ("watcher_id","fired_at");--> statement-breakpoint
CREATE INDEX "cards_user_idx" ON "user_card_holdings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_user_idx" ON "user_wallet_balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "watchers_route_date_idx" ON "user_watchers" USING btree ("origin_iata","dest_iata","earliest_date","latest_date") WHERE "user_watchers"."active" = true;--> statement-breakpoint
CREATE INDEX "watchers_user_idx" ON "user_watchers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cabin_prices_uniq" ON "result_cabin_prices" USING btree ("search_result_id","cabin");--> statement-breakpoint
CREATE INDEX "cabin_prices_miles_idx" ON "result_cabin_prices" USING btree ("cabin","miles_per_pax");--> statement-breakpoint
CREATE INDEX "cabin_prices_result_idx" ON "result_cabin_prices" USING btree ("search_result_id");--> statement-breakpoint
CREATE INDEX "segments_result_idx" ON "result_segments" USING btree ("search_result_id","segment_order");--> statement-breakpoint
CREATE INDEX "segments_operator_idx" ON "result_segments" USING btree ("operating_airline_iata","flight_number","depart_at");--> statement-breakpoint
CREATE INDEX "segments_op_flight_key_idx" ON "result_segments" USING btree ("operating_flight_key");--> statement-breakpoint
CREATE INDEX "results_hot_idx" ON "search_results" USING btree ("origin_iata","dest_iata","depart_date","program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "results_itin_uniq" ON "search_results" USING btree ("itinerary_hash","program_id","depart_date");--> statement-breakpoint
CREATE INDEX "results_cabins_gin" ON "search_results" USING gin ("cabins_available");--> statement-breakpoint
CREATE INDEX "results_freshness_idx" ON "search_results" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "history_route_prog_idx" ON "search_results_history" USING btree ("origin_iata","dest_iata","program_id","depart_date","observed_at");--> statement-breakpoint
CREATE INDEX "history_obs_idx" ON "search_results_history" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "searches_route_date_idx" ON "searches" USING btree ("origin_iata","dest_iata","depart_date");--> statement-breakpoint
CREATE INDEX "searches_user_idx" ON "searches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "signals_result_idx" ON "confidence_signals" USING btree ("search_result_id","kind");--> statement-breakpoint
CREATE INDEX "shadow_result_idx" ON "shadow_confirmations" USING btree ("search_result_id");--> statement-breakpoint
CREATE INDEX "shadow_pending_idx" ON "shadow_confirmations" USING btree ("status") WHERE "shadow_confirmations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "outcomes_result_idx" ON "booking_outcomes" USING btree ("search_result_id");--> statement-breakpoint
CREATE INDEX "outcomes_rollup_idx" ON "booking_outcomes" USING btree ("outcome","reported_at");--> statement-breakpoint
CREATE INDEX "errors_run_idx" ON "scraper_errors" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "errors_kind_idx" ON "scraper_errors" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE INDEX "runs_program_time_idx" ON "scraper_runs" USING btree ("program_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "scraper_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sweet_program_cabin_idx" ON "sweet_spots" USING btree ("program_id","cabin") WHERE "sweet_spots"."active" = true;--> statement-breakpoint
CREATE INDEX "sweet_rank_idx" ON "sweet_spots" USING btree ("rank") WHERE "sweet_spots"."active" = true;--> statement-breakpoint
CREATE INDEX "sweet_origin_gin" ON "sweet_spots" USING gin ("origin_pattern");--> statement-breakpoint
CREATE INDEX "sweet_dest_gin" ON "sweet_spots" USING gin ("dest_pattern");--> statement-breakpoint
CREATE INDEX "sweet_tags_gin" ON "sweet_spots" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "admin_audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "admin_audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_time_idx" ON "admin_audit_events" USING btree ("occurred_at");
-- Convert search_results_history to a partitioned parent.
-- Drizzle generated it as a regular table; we drop and recreate as PARTITION BY RANGE (observed_at).
-- See docs/planning/04-data-model.md §4 Partitioning Strategy.

DROP TABLE IF EXISTS "search_results_history" CASCADE;

CREATE TABLE "search_results_history" (
  "id"               BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
  "itinerary_hash"   VARCHAR(64) NOT NULL,
  "program_id"       VARCHAR(32) NOT NULL,
  "origin_iata"      VARCHAR(3)  NOT NULL,
  "dest_iata"        VARCHAR(3)  NOT NULL,
  "depart_date"      TIMESTAMP   NOT NULL,
  "num_segments"     SMALLINT    NOT NULL,
  "cabins_available" "cabin"[]   NOT NULL,
  "cabin_prices"     JSONB       NOT NULL,
  "observed_at"      TIMESTAMPTZ NOT NULL,
  "confidence_score" SMALLINT    NOT NULL,
  CONSTRAINT "search_results_history_pkey" PRIMARY KEY ("id", "observed_at")
) PARTITION BY RANGE ("observed_at");

-- Helper function: create one monthly partition.
CREATE OR REPLACE FUNCTION create_history_partition(start_date DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  partition_name TEXT;
  end_date DATE;
BEGIN
  partition_name := 'search_results_history_' || TO_CHAR(start_date, 'YYYY_MM');
  end_date := start_date + INTERVAL '1 month';

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF search_results_history
       FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I
       (origin_iata, dest_iata, program_id, depart_date, observed_at)',
    partition_name || '_route_prog_idx', partition_name
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (observed_at)',
    partition_name || '_obs_idx', partition_name
  );
END;
$$;

-- Seed 6 months of partitions (3 back, 3 forward from today).
-- Production scheduler should call create_history_partition() monthly on the 25th
-- to maintain a 24-month-forward rolling window and drop partitions >36 months old.
DO $$
DECLARE
  m INT;
  start_date DATE;
BEGIN
  FOR m IN -3..2 LOOP
    start_date := date_trunc('month', CURRENT_DATE + (m || ' month')::INTERVAL)::DATE;
    PERFORM create_history_partition(start_date);
  END LOOP;
END $$;

-- btree_gin extension is needed if we add mixed BTREE+GIN composite indexes later
-- (e.g., for sweet_spots tags + program_id).
CREATE EXTENSION IF NOT EXISTS btree_gin;
