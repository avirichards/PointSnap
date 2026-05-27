import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "";
const configured = url.length > 0 && !url.includes("placeholder");

/**
 * Supabase Postgres. We use postgres-js (not @neondatabase/serverless)
 * because we migrated off Neon → Supabase in session 5. `prepare: false`
 * is required when going through Supabase's transaction-pooler (port 6543);
 * direct connections (port 5432) accept it too, so it's safe everywhere.
 */
const client = configured
  ? postgres(url, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : null;

export const db = client
  ? drizzle(client, { schema, casing: "snake_case" })
  : (null as unknown as ReturnType<typeof drizzle>);

export { schema };
