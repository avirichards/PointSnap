-- Phase 2.5 (T5'): user-initiated auth-capture cookie storage.
--
-- Several airline programs (notably AC Aeroplan since March 2025, plus 19
-- others per Phase 0 Agent 5) require login before award space is visible.
-- We can't store usernames/passwords server-side — MFA challenges land in
-- the user's inbox/phone, not ours. Instead, the cockpit streams a Bright
-- Data Browser API session into an iframe, the user logs in with their own
-- keyboard, and the worker harvests the resulting session cookies. Those
-- cookies are encrypted-at-rest and replayed on every subsequent search
-- for that (user, program) pair.
--
-- Threat model: the cookies are bearer tokens for the user's loyalty
-- account. If service_role-decrypted in plaintext is logged or exfiltrated,
-- an attacker can scrape the user's award balance and (in some carriers)
-- initiate bookings. We therefore:
--   1. Encrypt at rest via Supabase Vault (authenticated encryption with
--      libsodium under the hood — Supabase manages the encryption key
--      out-of-band, never co-locating it with the ciphertext).
--   2. Wrap encrypt/decrypt in SECURITY DEFINER functions owned by
--      postgres so service_role calls go through a single audited surface
--      (rather than giving service_role direct access to vault.secrets).
--   3. RLS on the table so non-service roles only see their own rows —
--      and the cookies_secret_id column references vault secrets that
--      non-service roles cannot decrypt.
--
-- We deliberately use Vault (not pgsodium directly) per Supabase's 2024
-- guidance that pgsodium is pending deprecation. Vault's external surface
-- (`vault.create_secret`, `vault.update_secret`, `vault.decrypted_secrets`)
-- is the stable API; its internal implementation will shift away from
-- pgsodium without affecting us.
--
-- This migration is idempotent.

-- ------------------------------------------------------------------
-- Extensions
-- ------------------------------------------------------------------
-- supabase_vault is already installed on every Supabase project (verified
-- via list_extensions on this project). pgcrypto is similarly pre-installed
-- and we use gen_random_uuid() from it.
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- ------------------------------------------------------------------
-- Table
--
-- `cookies_secret_id` is a foreign-key-style pointer into vault.secrets.
-- We don't enforce the FK (the vault schema is managed by Supabase and
-- typically off-limits for FKs from public), but we always populate it
-- via the encrypt_cookies() helper which creates/updates the Vault row.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.program_auth_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id          text NOT NULL,                          -- e.g. "AC_AEROPLAN"
  cookies_secret_id   uuid NOT NULL,                          -- vault.secrets.id
  cookies_meta        jsonb NOT NULL DEFAULT '{}'::jsonb,     -- non-secret hints: names, domains
  expires_at          timestamptz NOT NULL,
  last_used_at        timestamptz,
  last_search_ok     boolean,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT program_auth_sessions_user_program_uniq UNIQUE (user_id, program_id)
);

CREATE INDEX IF NOT EXISTS program_auth_sessions_user_idx
  ON public.program_auth_sessions (user_id);

CREATE INDEX IF NOT EXISTS program_auth_sessions_expires_idx
  ON public.program_auth_sessions (expires_at);

-- Keep updated_at in sync on every UPDATE (cheap & ubiquitous pattern).
CREATE OR REPLACE FUNCTION public.program_auth_sessions__touch_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS program_auth_sessions_touch_updated_at
  ON public.program_auth_sessions;

CREATE TRIGGER program_auth_sessions_touch_updated_at
  BEFORE UPDATE ON public.program_auth_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.program_auth_sessions__touch_updated_at();

-- Vault secrets follow the lifecycle of their owning row: when a session
-- row is deleted, drop the corresponding vault.secrets row too so we
-- don't accumulate orphan ciphertexts.
CREATE OR REPLACE FUNCTION public.program_auth_sessions__delete_vault_secret()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = vault, public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = OLD.cookies_secret_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS program_auth_sessions_delete_vault_secret
  ON public.program_auth_sessions;

CREATE TRIGGER program_auth_sessions_delete_vault_secret
  AFTER DELETE ON public.program_auth_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.program_auth_sessions__delete_vault_secret();

-- ------------------------------------------------------------------
-- RLS
--
-- Users can SELECT / DELETE only their own rows. Inserts and updates go
-- through the worker (service_role bypasses RLS), since they need to
-- touch the Vault on the user's behalf. We explicitly do NOT allow
-- authenticated to write — they would be able to write a cookies_secret_id
-- pointing at someone else's Vault row, which would let them rotate
-- the pointer to a different user's secret on read. Safer to gate writes
-- behind service_role only.
-- ------------------------------------------------------------------
ALTER TABLE public.program_auth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program_auth_sessions_select_own"
  ON public.program_auth_sessions;
CREATE POLICY "program_auth_sessions_select_own"
  ON public.program_auth_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "program_auth_sessions_delete_own"
  ON public.program_auth_sessions;
CREATE POLICY "program_auth_sessions_delete_own"
  ON public.program_auth_sessions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- Wrapper functions for encryption
--
-- These run with SECURITY DEFINER so callers don't need direct grants on
-- vault. service_role calls these; authenticated never does (it would
-- have nothing to do with the plaintext).
--
-- encrypt_cookies():
--   - inserts a new vault.secrets row OR updates an existing one if a
--     secret_id is supplied
--   - the name is deterministic (cookies_<user>_<program>) so re-encrypting
--     the same (user, program) overwrites the previous ciphertext rather
--     than orphaning it
--   - returns the vault.secrets.id (uuid)
--
-- decrypt_cookies():
--   - takes the secret id and the expected (user, program) pair
--   - reads vault.decrypted_secrets
--   - returns the cleartext as text
--   - rejects with NULL if the secret name doesn't match the
--     (user, program) — defense-in-depth against a swapped pointer
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.encrypt_cookies(
  plain text,
  p_user_id uuid,
  p_program_id text,
  existing_secret_id uuid DEFAULT NULL
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = vault, public
AS $$
DECLARE
  secret_name text;
  secret_desc text;
  new_id      uuid;
BEGIN
  secret_name := 'cookies_' || p_user_id::text || '_' || p_program_id;
  secret_desc := jsonb_build_object(
    'kind',       'program_auth_session_cookies',
    'user_id',    p_user_id,
    'program_id', p_program_id
  )::text;

  IF existing_secret_id IS NOT NULL THEN
    -- vault.update_secret signature: (id uuid, new_secret text,
    -- new_name text, new_description text). Nulls = no-change.
    PERFORM vault.update_secret(
      existing_secret_id,
      plain,
      secret_name,
      secret_desc
    );
    RETURN existing_secret_id;
  END IF;

  -- Try to find an existing secret with the deterministic name first —
  -- protects against the edge case where the program_auth_sessions row
  -- was deleted (taking the vault row with it via trigger) but the caller
  -- still passed NULL because the table row was gone before this call.
  SELECT id INTO new_id
    FROM vault.secrets
   WHERE name = secret_name
   LIMIT 1;

  IF new_id IS NOT NULL THEN
    PERFORM vault.update_secret(new_id, plain, secret_name, secret_desc);
    RETURN new_id;
  END IF;

  -- Fresh create.
  new_id := vault.create_secret(plain, secret_name, secret_desc);
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encrypt_cookies(text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_cookies(text, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.decrypt_cookies(
  secret_id uuid,
  p_user_id uuid,
  p_program_id text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = vault, public
AS $$
DECLARE
  expected_name text;
  actual_name   text;
  cleartext     text;
BEGIN
  expected_name := 'cookies_' || p_user_id::text || '_' || p_program_id;

  SELECT name, decrypted_secret
    INTO actual_name, cleartext
    FROM vault.decrypted_secrets
   WHERE id = secret_id
   LIMIT 1;

  IF actual_name IS NULL OR actual_name <> expected_name THEN
    -- Pointer doesn't match the (user, program). Could be a swap attack
    -- or a stale row pointing at a deleted secret. Either way, refuse.
    RETURN NULL;
  END IF;

  RETURN cleartext;
END;
$$;

REVOKE ALL ON FUNCTION public.decrypt_cookies(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrypt_cookies(uuid, uuid, text) TO service_role;

-- ------------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.program_auth_sessions TO service_role;

-- authenticated only needs SELECT (to render the My Airlines page) and
-- DELETE (to disconnect a session). All writes flow through the worker.
GRANT SELECT, DELETE
  ON public.program_auth_sessions TO authenticated;

NOTIFY pgrst, 'reload schema';
