# Supabase migrations

Per `CLAUDE.md` §Database migrations, every schema change ships as:
1. A Drizzle-generated SQL file under `drizzle/migrations/` (typed source of truth).
2. A copy under `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql` with the 14-digit UTC timestamp prefix that matches Supabase CLI convention.
3. Applied to the live DB via Supabase Management API.
4. Recorded in `supabase_migrations.schema_migrations` in the same session.

## Adding a new migration

```
pnpm db:generate       # Drizzle generates the SQL in drizzle/migrations/
# Claude:
#   - reads the new file
#   - copies to supabase/migrations/<14-digit-utc>_<description>.sql
#   - appends `NOTIFY pgrst, 'reload schema';` if the schema changed
#   - applies via Management API:
#       POST https://api.supabase.com/v1/projects/<ref>/database/query
#   - records the version:
#       INSERT INTO supabase_migrations.schema_migrations (version)
#       VALUES ('<14-digit>') ON CONFLICT DO NOTHING;
#   - verifies, commits, pushes
```

## Why both files

- `drizzle/migrations/*` is the auto-generated source of truth — never edit by hand.
- `supabase/migrations/*` is the apply target with the matching timestamp prefix. This keeps the `supabase_migrations.schema_migrations` tracking table in sync with the filesystem, which prevents the CI drift problem CLAUDE.md describes.

## Rollback safety

For destructive migrations, write a matching file at
`supabase/rollbacks/<same-prefix>_rollback.sql` and a JSON snapshot of any rows
that will be deleted at `scripts/<feature>-pre-migration-snapshot.json` before applying.
