import { AIRPORTS } from "@/db/seed/airports";
/**
 * Airport autocomplete. Searches the ~5,400-row airports table by IATA / city /
 * name and returns up to `limit` matches ranked by relevance.
 *
 * Ranking (most-to-least exact):
 *   1. Exact IATA match
 *   2. IATA starts with `q`
 *   3. City starts with `q`
 *   4. Name contains `q`
 *
 * Used by src/components/search/airport-combobox.tsx for the search-form
 * From/To fields. Cached aggressively at the edge so repeat queries are free.
 */

import type { NextRequest } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

interface AirportRow {
  iata: string;
  city: string;
  name: string;
  country_iso2: string;
  region: string;
}

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control":
    "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
} as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qRaw = (searchParams.get("q") ?? "").trim().slice(0, 32);
  const limit = Math.min(
    25,
    Math.max(1, Math.floor(Number(searchParams.get("limit")) || 10)),
  );

  if (qRaw.length < 2) {
    return new Response(JSON.stringify([]), { headers: HEADERS });
  }

  const fallback = () =>
    AIRPORTS.filter((a) =>
      `${a.iata} ${a.city} ${a.name}`
        .toLowerCase()
        .includes(qRaw.toLowerCase()),
    )
      .sort(
        (a, b) =>
          Number(b.iata === qRaw.toUpperCase()) -
            Number(a.iata === qRaw.toUpperCase()) ||
          a.iata.localeCompare(b.iata),
      )
      .slice(0, limit)
      .map(({ iata, city, name, countryIso2, region }) => ({
        iata,
        city,
        name,
        countryIso2,
        region,
      }));
  if (!db) return Response.json(fallback(), { headers: HEADERS });
  try {
    const iq = qRaw.toUpperCase();
    const lq = qRaw.toLowerCase();

    const rows = (await db.execute(sql`
    SELECT iata, city, name, country_iso2, region FROM (
      SELECT iata, city, name, country_iso2, region, 1 AS rank
        FROM airports
       WHERE active AND iata = ${iq}
      UNION ALL
      SELECT iata, city, name, country_iso2, region, 2
        FROM airports
       WHERE active AND iata LIKE ${iq + "%"} AND iata <> ${iq}
      UNION ALL
      SELECT iata, city, name, country_iso2, region, 3
        FROM airports
       WHERE active AND LOWER(city) LIKE ${lq + "%"}
                    AND iata <> ${iq}
                    AND iata NOT LIKE ${iq + "%"}
      UNION ALL
      SELECT iata, city, name, country_iso2, region, 4
        FROM airports
       WHERE active AND LOWER(name) LIKE ${"%" + lq + "%"}
                    AND iata <> ${iq}
                    AND iata NOT LIKE ${iq + "%"}
                    AND LOWER(city) NOT LIKE ${lq + "%"}
    ) ranked
    ORDER BY rank, iata
    LIMIT ${limit};
  `)) as unknown as AirportRow[];

    const out = rows.map((r) => ({
      iata: r.iata,
      city: r.city,
      name: r.name,
      countryIso2: r.country_iso2,
      region: r.region,
    }));

    return new Response(JSON.stringify(out), { headers: HEADERS });
  } catch {
    return Response.json(fallback(), { headers: HEADERS });
  }
}
