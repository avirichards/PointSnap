CREATE TABLE IF NOT EXISTS public.trips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (id,user_id)
);
CREATE TABLE IF NOT EXISTS public.trip_flights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 trip_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 leg text NOT NULL CHECK (leg IN ('outbound','return','alternative')),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 100000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (trip_id,user_id) REFERENCES public.trips(id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS trip_flights_owner_trip ON public.trip_flights(user_id,trip_id);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_flights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_trips ON public.trips;
CREATE POLICY own_trips ON public.trips FOR ALL TO authenticated USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS own_trip_flights ON public.trip_flights;
CREATE POLICY own_trip_flights ON public.trip_flights FOR ALL TO authenticated USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
REVOKE ALL ON public.trips, public.trip_flights FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips, public.trip_flights TO authenticated;
NOTIFY pgrst, 'reload schema';
