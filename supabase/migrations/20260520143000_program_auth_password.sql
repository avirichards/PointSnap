-- Phase 2.5 revision — store the user's airline password (encrypted) next to
-- the captured session cookies.
--
-- The credential-login rebuild replaces the streamed-browser capture flow
-- (the user typed into a remote browser rendered in a laggy video canvas)
-- with a plain form: the user types their airline email + password into
-- PointSnap's own UI, and the worker fills the airline's login form itself.
--
-- To make re-login silent — so an expired session doesn't force the user
-- through a fresh connect every time — we keep the password, encrypted at
-- rest in Supabase Vault exactly like the cookies already are. The worker
-- decrypts it just-in-time to re-authenticate when a session lapses.
--
-- Additive + idempotent: one nullable column + two Vault wrapper functions
-- mirroring encrypt_cookies / decrypt_cookies, plus an extension of the
-- row-delete trigger so the password secret is cleaned up too. No existing
-- row or column is touched.

-- ------------------------------------------------------------------
-- Column — pointer into vault.secrets for the encrypted password.
-- Nullable: a row may exist (cookies captured) before a password is stored,
-- and "login optional" programs never store one at all.
-- ------------------------------------------------------------------
ALTER TABLE public.program_auth_sessions
  ADD COLUMN IF NOT EXISTS password_secret_id uuid;

-- ------------------------------------------------------------------
-- encrypt_password / decrypt_password — mirror the cookies wrappers, with a
-- distinct 'password_<user>_<program>' secret name so the password secret
-- and the cookies secret never collide in the Vault.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.encrypt_password(
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
  secret_name := 'password_' || p_user_id::text || '_' || p_program_id;
  secret_desc := jsonb_build_object(
    'kind',       'program_auth_session_password',
    'user_id',    p_user_id,
    'program_id', p_program_id
  )::text;

  IF existing_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(existing_secret_id, plain, secret_name, secret_desc);
    RETURN existing_secret_id;
  END IF;

  SELECT id INTO new_id
    FROM vault.secrets
   WHERE name = secret_name
   LIMIT 1;

  IF new_id IS NOT NULL THEN
    PERFORM vault.update_secret(new_id, plain, secret_name, secret_desc);
    RETURN new_id;
  END IF;

  new_id := vault.create_secret(plain, secret_name, secret_desc);
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encrypt_password(text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_password(text, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.decrypt_password(
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
  expected_name := 'password_' || p_user_id::text || '_' || p_program_id;

  SELECT name, decrypted_secret
    INTO actual_name, cleartext
    FROM vault.decrypted_secrets
   WHERE id = secret_id
   LIMIT 1;

  IF actual_name IS NULL OR actual_name <> expected_name THEN
    -- Pointer doesn't match the (user, program). Refuse — same defense
    -- against a swapped pointer as decrypt_cookies.
    RETURN NULL;
  END IF;

  RETURN cleartext;
END;
$$;

REVOKE ALL ON FUNCTION public.decrypt_password(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrypt_password(uuid, uuid, text) TO service_role;

-- ------------------------------------------------------------------
-- Extend the row-delete trigger function so deleting a session row drops
-- BOTH vault secrets (cookies + password), not just the cookies one.
-- CREATE OR REPLACE keeps the existing trigger binding intact.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.program_auth_sessions__delete_vault_secret()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = vault, public
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = OLD.cookies_secret_id;
  IF OLD.password_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = OLD.password_secret_id;
  END IF;
  RETURN OLD;
END;
$$;

NOTIFY pgrst, 'reload schema';
