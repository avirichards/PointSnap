-- Rollback for 20260520143000_program_auth_password.sql
--
-- Drops the password column + the two Vault wrapper functions, and restores
-- the row-delete trigger function to its cookies-only form.

ALTER TABLE public.program_auth_sessions
  DROP COLUMN IF EXISTS password_secret_id;

DROP FUNCTION IF EXISTS public.encrypt_password(text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.decrypt_password(uuid, uuid, text);

-- Restore the delete-trigger function to dropping only the cookies secret.
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

NOTIFY pgrst, 'reload schema';
