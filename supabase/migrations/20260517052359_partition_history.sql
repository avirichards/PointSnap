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

NOTIFY pgrst, 'reload schema';
