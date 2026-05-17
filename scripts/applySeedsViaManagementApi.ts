/**
 * Apply the launch seed data to Supabase via the Management API.
 *
 * Same data as src/db/seed/* — different transport. The Drizzle-based
 * `pnpm db:seed` path needs a TCP 5432 connection to Postgres, which the
 * Claude Code sandbox blocks. This script reads the same TypeScript
 * arrays, builds INSERT … ON CONFLICT DO NOTHING SQL, and POSTs each
 * statement to /v1/projects/{ref}/database/query (HTTPS, port 443).
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   tsx scripts/applySeedsViaManagementApi.ts
 *
 * Reads from .env.local: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF.
 */
import "../src/db/seed/_loadEnv";
import { ALLIANCES } from "../src/db/seed/alliances";
import { AIRLINES } from "../src/db/seed/airlines";
import { AIRPORTS } from "../src/db/seed/airports";
import { AIRCRAFT } from "../src/db/seed/aircraftTypes";
import { PROGRAMS } from "../src/db/seed/programs";
import {
  TRANSFERABLE_CURRENCIES,
  TRANSFER_RATIOS,
  TRANSFER_BONUSES,
  VALUATIONS,
} from "../src/db/seed/transferables";
import { SWEET_SPOTS } from "../src/db/seed/sweetSpots";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;

if (!TOKEN || !REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in .env.local");
  process.exit(1);
}

type Val = string | number | boolean | null | undefined | string[] | Date | object | RawSql | Jsonb;

interface RawSql { __raw: string }
interface Jsonb { __jsonb: unknown }
const raw = (s: string): RawSql => ({ __raw: s });
const jsonb = (v: unknown): Jsonb => ({ __jsonb: v });

function lit(v: Val): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object" && v !== null && "__raw" in v) return (v as RawSql).__raw;
  if (typeof v === "object" && v !== null && "__jsonb" in v) {
    const json = JSON.stringify((v as Jsonb).__jsonb).replace(/'/g, "''");
    return `'${json}'::jsonb`;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Array.isArray(v)) {
    const inner = v.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(",");
    return `ARRAY[${inner}]`;
  }
  if (typeof v === "object") {
    const json = JSON.stringify(v).replace(/'/g, "''");
    return `'${json}'::jsonb`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function runSql(sql: string, label: string): Promise<unknown> {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "pointsnap-seed/1.0",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`[${label}] HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

function bulkInsertSql(
  table: string,
  columns: string[],
  rows: Array<Record<string, Val>>,
  conflictTarget?: string,
): string {
  if (rows.length === 0) return "";
  const values = rows
    .map((row) => "(" + columns.map((c) => lit(row[c])).join(", ") + ")")
    .join(",\n  ");
  const onConflict = conflictTarget
    ? `ON CONFLICT ${conflictTarget} DO NOTHING`
    : "ON CONFLICT DO NOTHING";
  return `INSERT INTO ${table} (${columns.join(", ")})\nVALUES\n  ${values}\n${onConflict};`;
}

async function seedTable<T extends Record<string, Val>>(
  label: string,
  table: string,
  columns: string[],
  rows: readonly T[],
  conflictTarget?: string,
): Promise<void> {
  if (rows.length === 0) return;
  process.stdout.write(`  ${label} (${rows.length} rows)… `);
  const sql = bulkInsertSql(
    table,
    columns,
    rows as unknown as Array<Record<string, Val>>,
    conflictTarget,
  );
  await runSql(sql, label);
  console.log("✓");
}

async function main(): Promise<void> {
  console.log(`Seeding Supabase project ${REF} via Management API`);

  await seedTable("alliances", "alliances", ["id", "name"], ALLIANCES);

  await seedTable(
    "airlines",
    "airlines",
    ["iata", "icao", "name", "alliance_id", "country_iso2", "active"],
    AIRLINES.map((a) => ({
      iata: a.iata,
      icao: a.icao,
      name: a.name,
      alliance_id: a.allianceId ?? null,
      country_iso2: a.countryIso2,
      active: ("active" in a ? (a as { active?: boolean }).active : undefined) ?? true,
    })),
  );

  await seedTable(
    "airports",
    "airports",
    ["iata", "icao", "name", "city", "country_iso2", "region", "lat_micro", "lon_micro", "tz_olson"],
    AIRPORTS.map((a) => ({
      iata: a.iata,
      icao: a.icao ?? null,
      name: a.name,
      city: a.city,
      country_iso2: a.countryIso2,
      region: a.region,
      lat_micro: a.latMicro,
      lon_micro: a.lonMicro,
      tz_olson: a.tzOlson,
    })),
  );

  await seedTable(
    "aircraft_types",
    "aircraft_types",
    ["icao", "iata", "name", "widebody"],
    AIRCRAFT.map((a) => ({
      icao: a.icao,
      iata: a.iata ?? null,
      name: a.name,
      widebody: a.widebody,
    })),
  );

  await seedTable(
    "programs",
    "programs",
    [
      "id",
      "sponsor_airline_iata",
      "name",
      "pricing_model",
      "fuel_surcharge_passthrough",
      "expiry_months",
      "notes",
    ],
    PROGRAMS.map((p) => ({
      id: p.id,
      sponsor_airline_iata: p.sponsorAirlineIata,
      name: p.name,
      pricing_model: p.pricingModel,
      fuel_surcharge_passthrough: p.fuelSurchargePassthrough,
      expiry_months: p.expiryMonths,
      notes: p.notes,
    })),
  );

  await seedTable(
    "transferable_currencies",
    "transferable_currencies",
    ["id", "name", "issuer"],
    TRANSFERABLE_CURRENCIES,
  );

  await seedTable(
    "transfer_ratios",
    "transfer_ratios",
    ["currency_id", "program_id", "ratio_micro", "min_transfer", "increment"],
    TRANSFER_RATIOS.map((r) => ({
      currency_id: r.currencyId,
      program_id: r.programId,
      ratio_micro: r.ratioMicro,
      min_transfer: r.minTransfer ?? 1000,
      increment: r.increment ?? 1000,
    })),
    "(currency_id, program_id)",
  );

  // Transfer bonuses look up the ratio_id by (currency, program) — need a
  // multi-step insert that resolves the FK. Easiest path: single SQL with
  // a CTE per bonus.
  for (const b of TRANSFER_BONUSES) {
    const sql = `
      WITH r AS (
        SELECT id FROM transfer_ratios
        WHERE currency_id = ${lit(b.currencyId)} AND program_id = ${lit(b.programId)}
        LIMIT 1
      )
      INSERT INTO transfer_bonuses (transfer_ratio_id, bonus_pct, starts_at, ends_at, source_url)
      SELECT id, ${lit(b.bonusPct)}, ${lit(new Date(b.startsAt))}, ${lit(new Date(b.endsAt))}, ${lit(b.sourceUrl ?? null)}
      FROM r
      ON CONFLICT DO NOTHING;
    `;
    process.stdout.write(`  transfer_bonus ${b.currencyId}→${b.programId}… `);
    await runSql(sql, `transfer_bonus_${b.currencyId}_${b.programId}`);
    console.log("✓");
  }

  await seedTable(
    "valuations",
    "valuations",
    ["program_id", "currency_id", "cpp_micro", "source", "effective_from"],
    VALUATIONS.map((v) => ({
      program_id: v.programId ?? null,
      currency_id: v.currencyId ?? null,
      cpp_micro: v.cppMicro,
      source: v.source,
      effective_from: new Date(v.effectiveFrom),
    })),
  );

  await seedTable(
    "sweet_spots",
    "sweet_spots",
    [
      "program_id",
      "title",
      "origin_pattern",
      "dest_pattern",
      "cabin",
      "miles_one_way",
      "approx_surcharge_usd",
      "notes",
      "source_url",
      "curated_by",
      "rank",
      "tags",
    ],
    SWEET_SPOTS.map((s) => ({
      program_id: s.programId,
      title: s.title,
      origin_pattern: s.originPattern,
      dest_pattern: s.destPattern,
      cabin: s.cabin,
      miles_one_way: s.milesOneWay,
      approx_surcharge_usd: s.approxSurchargeUsd,
      notes: s.notes ?? null,
      source_url: s.sourceUrl ?? null,
      curated_by: s.curatedBy ?? null,
      rank: s.rank,
      tags: jsonb(s.tags),
    })),
  );

  // Final counts
  const counts = (await runSql(
    `
    SELECT
      (SELECT COUNT(*)::int FROM alliances) AS alliances,
      (SELECT COUNT(*)::int FROM airlines) AS airlines,
      (SELECT COUNT(*)::int FROM airports) AS airports,
      (SELECT COUNT(*)::int FROM aircraft_types) AS aircraft_types,
      (SELECT COUNT(*)::int FROM programs) AS programs,
      (SELECT COUNT(*)::int FROM transferable_currencies) AS transferable_currencies,
      (SELECT COUNT(*)::int FROM transfer_ratios) AS transfer_ratios,
      (SELECT COUNT(*)::int FROM transfer_bonuses) AS transfer_bonuses,
      (SELECT COUNT(*)::int FROM valuations) AS valuations,
      (SELECT COUNT(*)::int FROM sweet_spots) AS sweet_spots
    `,
    "counts",
  )) as Array<Record<string, number>>;
  console.log("✓ seed complete:", counts[0]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
