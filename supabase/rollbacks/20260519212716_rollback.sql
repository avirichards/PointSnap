-- Rollback for 20260519212716_drop_aircraft_icao_fk.sql.
--
-- Re-add the FK constraint. Note: this will fail if rows have aircraft_icao
-- values that aren't in aircraft_types — you'll need to either seed those
-- codes first or null them out before applying this rollback.

ALTER TABLE public.result_segments
  ADD CONSTRAINT IF NOT EXISTS result_segments_aircraft_icao_aircraft_types_icao_fk
  FOREIGN KEY (aircraft_icao) REFERENCES public.aircraft_types(icao);

NOTIFY pgrst, 'reload schema';
