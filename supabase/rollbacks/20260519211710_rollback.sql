-- Rollback for 20260519211710_program_auth_sessions.sql
--
-- Drops the table + policies + wrapper functions. Vault secrets are
-- cleaned up automatically by the AFTER DELETE trigger on the table —
-- by the time we DROP TABLE the trigger has already fired for every row.
-- BUT: DROP TABLE bypasses row-level triggers, so we explicitly delete
-- vault entries by name pattern first as belt-and-suspenders.
--
-- Intentionally leaves the supabase_vault and pgcrypto extensions
-- installed, since both are Supabase-default and other features may
-- depend on them.

-- Belt-and-suspenders cleanup of any orphan vault secrets created by
-- our migration. The deterministic name pattern lets us target exactly
-- the rows that belonged to this feature.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'supabase_vault'
  ) THEN
    DELETE FROM vault.secrets WHERE name LIKE 'cookies\_%' ESCAPE '\';
  END IF;
END $$;

DROP TRIGGER IF EXISTS program_auth_sessions_touch_updated_at
  ON public.program_auth_sessions;
DROP TRIGGER IF EXISTS program_auth_sessions_delete_vault_secret
  ON public.program_auth_sessions;

DROP FUNCTION IF EXISTS public.program_auth_sessions__touch_updated_at();
DROP FUNCTION IF EXISTS public.program_auth_sessions__delete_vault_secret();

DROP POLICY IF EXISTS "program_auth_sessions_select_own"
  ON public.program_auth_sessions;
DROP POLICY IF EXISTS "program_auth_sessions_delete_own"
  ON public.program_auth_sessions;

DROP TABLE IF EXISTS public.program_auth_sessions;

DROP FUNCTION IF EXISTS public.encrypt_cookies(text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.decrypt_cookies(uuid, uuid, text);

NOTIFY pgrst, 'reload schema';
