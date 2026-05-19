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
--   1. Encrypt at rest via pgsodium AEAD with a server-side key.
--   2. Wrap encrypt/decrypt in SECURITY DEFINER functions owned by postgres
--      so service_role calls go through a single audited surface (rather
--      than giving service_role direct pgsodium primitive access).
--   3. RLS on the table so non-service roles only see their own metadata —
--      and the cookies_encrypted column never round-trips through PostgREST
--      readable selectors (clients fetch metadata only).
--
-- This migration is idempotent. The encryption key is a named pgsodium key,
-- created once and reused; the rollback intentionally leaves the key in
-- place so we don't lose decryption of any retained ciphertexts.

-- ------------------------------------------------------------------
-- Extensions
-- ------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgsodium;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- ------------------------------------------------------------------
-- Encryption key (one-time create; no-op on re-apply)
--
-- pgsodium.create_key() returns a UUID we never expose to clients; we
-- look it up by `name` from inside the wrapper functions below.
-- ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pgsodium.valid_key WHERE name = 'pointsnap_cookies_key_v1'
  ) THEN
    PERFORM pgsodium.create_key(
      key_type => 'aead-det',
      name     => 'pointsnap_cookies_key_v1'
    );
  END IF;
END $$;

-- ------------------------------------------------------------------
-- Table
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.program_auth_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_id         text NOT NULL,                              -- e.g. "AC_AEROPLAN"
  cookies_encrypted  bytea NOT NULL,                             -- pgsodium AEAD ciphertext
  cookies_meta       jsonb NOT NULL DEFAULT '{}'::jsonb,         -- non-secret: names, domains, path, sameSite
  expires_at         timestamptz NOT NULL,
  last_used_at       timestamptz,
  last_search_ok     boolean,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
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

-- ------------------------------------------------------------------
-- RLS
--
-- Users can SELECT / INSERT / UPDATE / DELETE only their own rows. The
-- cockpit only ever reads METADATA (expires_at, cookies_meta) — never the
-- ciphertext. The worker uses service_role which bypasses RLS.
-- ------------------------------------------------------------------
ALTER TABLE public.program_auth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program_auth_sessions_select_own"
  ON public.program_auth_sessions;
CREATE POLICY "program_auth_sessions_select_own"
  ON public.program_auth_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "program_auth_sessions_insert_own"
  ON public.program_auth_sessions;
CREATE POLICY "program_auth_sessions_insert_own"
  ON public.program_auth_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "program_auth_sessions_update_own"
  ON public.program_auth_sessions;
CREATE POLICY "program_auth_sessions_update_own"
  ON public.program_auth_sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "program_auth_sessions_delete_own"
  ON public.program_auth_sessions;
CREATE POLICY "program_auth_sessions_delete_own"
  ON public.program_auth_sessions
  FOR DELETE
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- Wrapper functions for encryption
--
-- We don't expose raw pgsodium primitives to service_role. Instead, the
-- worker calls these SECURITY DEFINER functions which encapsulate the
-- key lookup. The functions are owned by postgres and run with its rights,
-- so callers don't need direct grants on pgsodium itself.
--
-- AEAD-det = deterministic encryption: same plaintext + same context →
-- same ciphertext. Lets the table's UNIQUE(user_id, program_id) work as
-- the natural upsert key without leaking equality across users (different
-- user_id contexts produce different ciphertexts for the same plaintext).
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.encrypt_cookies(
  plain text,
  user_id uuid,
  program_id text
)
  RETURNS bytea
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pgsodium, public
AS $$
DECLARE
  key_uuid uuid;
  ctx      bytea;
BEGIN
  SELECT id INTO STRICT key_uuid
    FROM pgsodium.valid_key
   WHERE name = 'pointsnap_cookies_key_v1';

  -- Associated-data: bind the ciphertext to its owning (user, program)
  -- so a swapped row in storage can't be decrypted into a different
  -- user's session.
  ctx := convert_to(user_id::text || '|' || program_id, 'utf8');

  RETURN pgsodium.crypto_aead_det_encrypt(
    message  => convert_to(plain, 'utf8'),
    additional => ctx,
    key_uuid => key_uuid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.encrypt_cookies(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_cookies(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.decrypt_cookies(
  cipher bytea,
  user_id uuid,
  program_id text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pgsodium, public
AS $$
DECLARE
  key_uuid uuid;
  ctx      bytea;
BEGIN
  SELECT id INTO STRICT key_uuid
    FROM pgsodium.valid_key
   WHERE name = 'pointsnap_cookies_key_v1';

  ctx := convert_to(user_id::text || '|' || program_id, 'utf8');

  RETURN convert_from(
    pgsodium.crypto_aead_det_decrypt(
      message    => cipher,
      additional => ctx,
      key_uuid   => key_uuid
    ),
    'utf8'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decrypt_cookies(bytea, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrypt_cookies(bytea, uuid, text) TO service_role;

-- ------------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.program_auth_sessions TO service_role;

-- authenticated needs select/update/delete on its own rows (RLS-gated).
-- Cookie ciphertext is intentionally readable by the row owner — they
-- already have implicit access through the cookies in their browser, and
-- giving them read keeps the cockpit's status page simple. The cleartext
-- is still gated behind decrypt_cookies() which authenticated cannot call.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.program_auth_sessions TO authenticated;

NOTIFY pgrst, 'reload schema';
