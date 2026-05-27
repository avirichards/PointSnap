-- Grant service_role full CRUD on all current and future public tables/sequences.
--
-- Why: Supabase normally auto-grants service_role privileges on tables created
-- via the SQL editor or the Supabase migrate runner. Our schema was applied via
-- the Management API (scripts/applyBootstrap.ts → applyToSupabase.py), which
-- bypasses that auto-grant. Without these grants, any client using supabase-js
-- with the service_role JWT (or any direct REST write via PostgREST) gets
-- "permission denied for table X" (Postgres SQLSTATE 42501).
--
-- This restores the default Supabase behavior. Applied directly on
-- 2026-05-17 via the Supabase MCP execute_sql so the live DB matches; this
-- file is the durable record so re-builds (and any future migration runner)
-- preserve it.
--
-- Discovered when scripts/syncOpenFlights.ts attempted to bulk-upsert ~5400
-- airports via PostgREST and got 403'd on the airports table.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;

NOTIFY pgrst, 'reload schema';
