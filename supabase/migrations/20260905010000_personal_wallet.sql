-- Isolated from the legacy wallet table whose composite PK contradicts its XOR
-- constraint. That table cannot contain valid rows; leave it intact for history.
CREATE TABLE IF NOT EXISTS public.wallet_entries (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id text NOT NULL CHECK (length(asset_id) BETWEEN 1 AND 64),
  kind text NOT NULL CHECK (kind IN ('program', 'currency')),
  balance integer NOT NULL CHECK (balance >= 0),
  expires_on date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);
CREATE TABLE IF NOT EXISTS public.wallet_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
ALTER TABLE public.wallet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_wallet ON public.wallet_entries;
CREATE POLICY own_wallet ON public.wallet_entries FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS own_cards ON public.wallet_cards;
CREATE POLICY own_cards ON public.wallet_cards FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.wallet_entries, public.wallet_cards FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_entries, public.wallet_cards TO authenticated;
NOTIFY pgrst, 'reload schema';
