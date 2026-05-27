# Scraper Account Pool — Runbook

How to fill the per-program account pool that the worker rotates
through. The infrastructure (table, rotation logic, ban detection) is
already in place — this doc covers the operational side: where to get
accounts and how to register them.

## What the pool needs (per program)

| Program | Min accounts | Per-account constraint | Acquisition difficulty |
|---|---|---|---|
| VS Flying Club | 0 (anonymous endpoint) | — | Free, n/a |
| UA MileagePlus | 0 (anonymous endpoint) | — | Free, n/a |
| AS Mileage Plan | 0 (anonymous endpoint) | — | Free, n/a |
| AC Aeroplan | 1-3 | None | Free signup |
| AA AAdvantage | 3-5 | None | Free signup |
| DL SkyMiles | 3-5 | None | Free signup |
| BA Avios | 3-5 | None (free tier OK) | Free Executive Club signup |
| AV LifeMiles | 3-5 | Passport verification | Free signup, ~10 min per account |
| AF Flying Blue | 3-5 | None | Free signup |
| TK Miles & Smiles | 3-5 | None | Free signup, account lock risk if abused |
| NH ANA Mileage Club | 3-5 | None | Free signup, JP-friendly IP for register |
| CX Cathay Asia Miles | 5-10 | **Unique mobile per account** | Free, but each account needs a unique phone (SIM-pool or VoIP-friendly numbers) |
| LH Miles & More | 10-30 | **≥7,000 miles balance per account** | ~$210 per account in mile purchases. ~$2,100-$6,300 capex. |

**Total estimated mile-purchase capex for a comfortable pool: ~$6-10k.** All of that is LH-driven; every other program is free-tier-friendly.

## How to add an account

Two-step process: register the row + drop the creds.

### 1. Insert the row into Supabase

Via the Supabase MCP, the dashboard SQL editor, or `psql`:

```sql
INSERT INTO account_pool
  (id, program_id, account_index, env_user_var, env_pass_var, balance_miles, notes)
VALUES
  ('BA_AVIOS_ACCOUNT_1', 'BA_AVIOS', 1, 'BA_ACCOUNT_1_USER', 'BA_ACCOUNT_1_PASS', NULL,
   'Personal Executive Club account; purchased on 2026-05-17.');
```

Notes on each column:
- `id`: convention is `{PROGRAM_ID}_ACCOUNT_{N}`. Used as foreign-key target by audit events later.
- `account_index`: 1-based, unique per program.
- `env_user_var` / `env_pass_var`: the Fly secret names the worker should read at scrape time. Convention: `{PROGRAM_PREFIX}_ACCOUNT_{N}_USER` / `_PASS`.
- `balance_miles`: optional. Set for LH M&M so the worker can skip accounts that fell below 7,000.
- `notes`: free text. Recommend including acquisition date + payment method.

### 2. Add the credentials to Fly secrets

```bash
flyctl secrets set --app pointsnap-workers \
  BA_ACCOUNT_1_USER='100012345' \
  BA_ACCOUNT_1_PASS='hunter2'
```

Or via the Fly dashboard: project → Secrets → Set.

That's it. The worker picks the account up on the next scrape.

## What the worker does with the pool

For each scrape:

1. **Acquire**: `SELECT ... FOR UPDATE SKIP LOCKED` picks the least-recently-used active account, bumps `last_used_at` + `searches_today`. Other concurrent scrapes get the next-LRU account.
2. **Throttle**: if `searches_today` is over the per-program cap (15 for CX, 8 for ANA, 6 for LH, 30 default), the account is skipped — scrape falls back to canonical.
3. **Use**: plugin reads `env_user_var` / `env_pass_var` from Fly env, logs in, scrapes.
4. **Release** (auto): on 401/403 response → account is marked `banned` and never used again. Operator can manually un-ban via SQL (status = 'active') after rotating the password.

## Where to see pool state

`/admin` (the cockpit's operator surface) shows the pool table:

| Program | Active | Banned | Other | Total | Used 1h | Status |
|---|---|---|---|---|---|---|
| Cathay Asia Miles | 5 | 2 | 0 | 7 | 18 | OK |
| Lufthansa M&M | 0 | 0 | 0 | 0 | 0 | no accounts — env-fallback only |
| ... | | | | | | |

Programs with `total = 0` fall back to the single-account env-var (e.g. `BA_EXEC_CLUB_USER`) so your personal account still works in dev. Once you add even one pool row, the worker switches to pool mode for that program.

## Scaling guidance

| You're at... | Pool size per program |
|---|---|
| Personal use, 1 user | 1 account each (or env-var fallback) |
| Demo / share with 1-2 friends | 3 per program, 10 for LH |
| Private beta with ~20 users | 5-10 per program, 30 for LH |
| Public launch | 20-50 per program, 100 for LH |

At "private beta" you'd want to hire a VA to register + warm accounts. At "public launch" you're looking at a dedicated account-ops headcount + ~$15-25k/yr in mile purchases (LH alone) + a few hundred a month in IPRoyal residential traffic.

## Where the creds DON'T live

- **Not in the DB.** `account_pool` table stores only `env_user_var` / `env_pass_var` (the secret NAMES, not values).
- **Not in git.** All secrets are Fly secrets, rotation-friendly via `flyctl secrets set`.
- **Not in plain text in Vercel.** The Next.js cockpit doesn't ever see scraper credentials; only the Fly worker reads them.

If a credential ever leaks, rotate via `flyctl secrets set --app pointsnap-workers <NAME>=<new-value>` and the next scrape uses the new value. No DB change needed.
