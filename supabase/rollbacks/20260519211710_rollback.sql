-- Rollback for 20260519211710_program_auth_sessions.sql
--
-- Drops the table + policies + wrapper functions. INTENTIONALLY LEAVES the
-- pgsodium encryption key in place — once a key is rotated/dropped, any
-- ciphertexts encrypted under it become unrecoverable. If we ever truly
-- want to wipe the key, do it as a SEPARATE migration after confirming no
-- production rows exist that depend on it.
--
-- Also intentionally leaves the pgsodium and pgcrypto extensions installed,
-- since other features (and the key itself) reference them.

DROP TRIGGER IF EXISTS program_auth_sessions_touch_updated_at
  ON public.program_auth_sessions;

DROP FUNCTION IF EXISTS public.program_auth_sessions__touch_updated_at();

DROP POLICY IF EXISTS "program_auth_sessions_select_own"
  ON public.program_auth_sessions;
DROP POLICY IF EXISTS "program_auth_sessions_insert_own"
  ON public.program_auth_sessions;
DROP POLICY IF EXISTS "program_auth_sessions_update_own"
  ON public.program_auth_sessions;
DROP POLICY IF EXISTS "program_auth_sessions_delete_own"
  ON public.program_auth_sessions;

DROP TABLE IF EXISTS public.program_auth_sessions;

DROP FUNCTION IF EXISTS public.encrypt_cookies(text, uuid, text);
DROP FUNCTION IF EXISTS public.decrypt_cookies(bytea, uuid, text);

NOTIFY pgrst, 'reload schema';
