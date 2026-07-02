import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// ⚠️ SOURCE OF TRUTH: the committed SQL files in `supabase/migrations/` are the
// ONLY path that reaches the database. This Drizzle schema is kept in sync for
// type inference and query building, but the live DB has structures Drizzle
// cannot express (partitioned `search_results_history`, Vault-encrypted
// `program_auth_sessions`, RLS policies, service_role grants).
// DO NOT run `drizzle-kit push`/`migrate` against production — it would drop
// those objects. Use it only for local diffing / `db:generate` review.

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
  casing: "snake_case",
});
