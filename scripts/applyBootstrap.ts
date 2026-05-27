/**
 * Bootstrap the schema by applying scripts/bootstrap.sql to the configured
 * Postgres. Uses postgres-js, so it works against any Postgres reachable
 * on TCP 5432/6543. The Claude Code sandbox blocks both — for that path
 * use `python3 scripts/applyToSupabase.py`, which goes through the
 * Supabase Management API over HTTPS instead.
 */
import "../src/db/seed/_loadEnv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("placeholder")) {
    throw new Error("DATABASE_URL not configured.");
  }

  const sqlPath = resolve(process.cwd(), "scripts/bootstrap.sql");
  const raw = readFileSync(sqlPath, "utf8");

  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--.*\n?)+$/.test(s));

  console.log(
    `Applying ${statements.length} statements to ${url.split("@")[1]?.split("/")[0] ?? "(unknown host)"}`,
  );

  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    let i = 0;
    for (const stmt of statements) {
      i++;
      const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
      process.stdout.write(`  [${i}/${statements.length}] ${preview}…\n`);
      await sql.unsafe(stmt);
    }

    console.log("✓ bootstrap complete");

    const [{ table_count }] = await sql<
      { table_count: number }[]
    >`SELECT COUNT(*)::int AS table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    console.log(`  ${table_count} tables in public schema`);
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
