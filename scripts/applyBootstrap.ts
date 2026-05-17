import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

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

  const sql = neon(url);
  let i = 0;
  for (const stmt of statements) {
    i++;
    const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
    process.stdout.write(`  [${i}/${statements.length}] ${preview}…\n`);
    await sql.query(stmt);
  }

  console.log("✓ bootstrap complete");

  const [{ table_count }] = (await sql.query(
    "SELECT COUNT(*)::int AS table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  )) as Array<{ table_count: number }>;
  console.log(`  ${table_count} tables in public schema`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
