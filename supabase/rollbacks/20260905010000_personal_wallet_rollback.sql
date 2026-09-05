-- Destructive rollback: export wallet data before applying manually.
DROP TABLE IF EXISTS public.wallet_cards;
DROP TABLE IF EXISTS public.wallet_entries;
NOTIFY pgrst, 'reload schema';
