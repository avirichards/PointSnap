-- Drop the FK constraint from result_segments.aircraft_icao to aircraft_types.icao.
--
-- Why: Carriers introduce new aircraft codes faster than we can seed
-- aircraft_types. Alaska's 737 MAX 9 reports as `7M9`, which broke AS
-- scraper writes on 2026-05-19 with:
--   ForeignKeyViolation: insert or update on table "result_segments"
--   violates foreign key constraint "result_segments_aircraft_icao_aircraft_types_icao_fk"
--   DETAIL: Key (aircraft_icao)=(7M9) is not present in table "aircraft_types".
--
-- We still keep aircraft_types as a lookup table for display purposes
-- (joins to enrich a code into a friendly name). Removing the FK lets
-- scraped data flow even when the lookup is incomplete; the worst case
-- is a display join that returns NULL, which the UI already handles.
--
-- Idempotent: only drops the constraint if it exists.

ALTER TABLE public.result_segments
  DROP CONSTRAINT IF EXISTS result_segments_aircraft_icao_aircraft_types_icao_fk;

NOTIFY pgrst, 'reload schema';
