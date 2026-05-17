/**
 * Sync the `airports` table from the public OpenFlights dataset.
 *
 * Source: https://github.com/jpatokal/openflights/tree/master/data
 *   - airports.dat — ~7,700 entries; ~3,200 have IATA codes
 *   - countries.dat — canonical country name → ISO2 mapping
 *
 * Modes:
 *   --print-sql   Emit upsert SQL to stdout. Default. Pipes cleanly into a
 *                 .sql file or the Supabase MCP `execute_sql` tool.
 *   --exec        Connect to DATABASE_URL via postgres-js and upsert directly.
 *                 Requires the DATABASE_URL env var (set in .env.local for
 *                 local dev; on Vercel set in the project env).
 *
 * Idempotent: ON CONFLICT (iata) DO UPDATE replaces every column with the
 * OpenFlights row. The first run inserts ~2,800 new airports; re-runs reset
 * any drift to the OpenFlights source of truth.
 *
 * Filter: only entries where `Type == "airport"`, IATA is exactly 3 letters,
 * country is mapped to a known ISO2, lat/lon are present, timezone is present.
 *
 * Region derivation: country ISO2 → region (NA, EU, AS-NE, AS-SE, AS-SC, ME,
 * AF, OC, SA, CA). Mapping matches the curated values in src/db/seed/airports.ts.
 *
 * Run:
 *   pnpm tsx scripts/syncOpenFlights.ts --print-sql > /tmp/airports.sql
 *   pnpm tsx scripts/syncOpenFlights.ts --exec     # if DATABASE_URL set
 */

const OPENFLIGHTS_AIRPORTS =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat";
const OPENFLIGHTS_COUNTRIES =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/countries.dat";

// Country ISO2 → region. Matches the seed file's existing values.
const REGION_BY_ISO2: Record<string, string> = {};

// North America
for (const c of ["US", "CA", "MX", "BM"]) REGION_BY_ISO2[c] = "NA";
// Central America + Caribbean
for (const c of [
  "AG","AI","AW","BB","BL","BQ","BS","BZ","CR","CU","CW","DM","DO","GD","GP",
  "GT","HN","HT","JM","KN","KY","LC","MF","MQ","MS","NI","PA","PR","SV","SX",
  "TC","TT","VC","VG","VI",
]) REGION_BY_ISO2[c] = "CA";
// South America
for (const c of [
  "AR","BO","BR","CL","CO","EC","FK","GF","GY","PE","PY","SR","UY","VE",
]) REGION_BY_ISO2[c] = "SA";
// Europe (incl. Caucasus + Russia)
for (const c of [
  "AD","AL","AM","AT","AZ","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE",
  "ES","FI","FO","FR","GB","GE","GG","GI","GR","HR","HU","IE","IM","IS","IT",
  "JE","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO",
  "RS","RU","SE","SI","SJ","SK","SM","UA","VA","XK","AX",
]) REGION_BY_ISO2[c] = "EU";
// Middle East
for (const c of [
  "AE","BH","IL","IQ","IR","JO","KW","LB","OM","PS","QA","SA","SY","TR","YE",
]) REGION_BY_ISO2[c] = "ME";
// Northeast Asia
for (const c of ["CN","HK","JP","KP","KR","MN","MO","TW"])
  REGION_BY_ISO2[c] = "AS-NE";
// Southeast Asia
for (const c of ["BN","ID","KH","LA","MM","MY","PH","SG","TH","TL","VN"])
  REGION_BY_ISO2[c] = "AS-SE";
// South + Central Asia
for (const c of [
  "AF","BD","BT","IN","KG","KZ","LK","MV","NP","PK","TJ","TM","UZ",
]) REGION_BY_ISO2[c] = "AS-SC";
// Africa
for (const c of [
  "AO","BF","BI","BJ","BW","CD","CF","CG","CI","CM","CV","DJ","DZ","EG","EH",
  "ER","ET","GA","GH","GM","GN","GQ","GW","KE","KM","LR","LS","LY","MA","MG",
  "ML","MR","MU","MW","MZ","NA","NE","NG","RE","RW","SC","SD","SH","SL","SN",
  "SO","SS","ST","SZ","TD","TG","TN","TZ","UG","YT","ZA","ZM","ZW",
]) REGION_BY_ISO2[c] = "AF";
// Oceania
for (const c of [
  "AS","AU","CC","CK","CX","FJ","FM","GU","KI","MH","MP","NC","NF","NR","NU",
  "NZ","PF","PG","PN","PW","SB","TK","TO","TV","VU","WF","WS","TF",
]) REGION_BY_ISO2[c] = "OC";

/** Quirky country-name overrides used by OpenFlights's airports.dat where the
 * label doesn't match countries.dat. Keep small. */
const COUNTRY_NAME_OVERRIDES: Record<string, string> = {
  "Burma": "MM",
  "Cape Verde": "CV",
  "Czech Republic": "CZ",
  "East Timor": "TL",
  "Ivory Coast": "CI",
  "South Korea": "KR",
  "North Korea": "KP",
  "Macau": "MO",
  "Macedonia": "MK",
  "Palestine": "PS",
  "Russia": "RU",
  "Swaziland": "SZ",
  "Syria": "SY",
  "Taiwan": "TW",
  "Vatican City": "VA",
  "Vietnam": "VN",
  "Virgin Islands": "VI",
  "Wake Island": "UM",
  "West Bank": "PS",
  "Wallis and Futuna": "WF",
  // OpenFlights uses "United States Minor Outlying Islands" etc.; ignore.
};

/** Parse a single CSV line that may contain quoted strings with commas. */
function parseCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
      inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

interface AirportRow {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  countryIso2: string;
  region: string;
  latMicro: number;
  lonMicro: number;
  tzOlson: string;
}

async function fetchCountries(): Promise<Map<string, string>> {
  const res = await fetch(OPENFLIGHTS_COUNTRIES);
  if (!res.ok)
    throw new Error(`fetch countries.dat ${res.status}: ${res.statusText}`);
  const text = await res.text();
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [name, iso, _dst] = parseCsv(line);
    if (!name || !iso) continue;
    map.set(name.replace(/^"|"$/g, ""), iso.replace(/^"|"$/g, ""));
  }
  // Apply known overrides for airports.dat-specific names.
  for (const [k, v] of Object.entries(COUNTRY_NAME_OVERRIDES)) map.set(k, v);
  return map;
}

async function fetchAirports(
  countryToIso: Map<string, string>,
): Promise<{ rows: AirportRow[]; skipped: Record<string, number> }> {
  const res = await fetch(OPENFLIGHTS_AIRPORTS);
  if (!res.ok)
    throw new Error(`fetch airports.dat ${res.status}: ${res.statusText}`);
  const text = await res.text();
  const rows: AirportRow[] = [];
  const seenIata = new Set<string>();
  const skipped = {
    noIata: 0,
    badIata: 0,
    notAirport: 0,
    noCountry: 0,
    noTz: 0,
    badCoords: 0,
    duplicate: 0,
    noRegion: 0,
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const cols = parseCsv(line).map((s) => s.replace(/^"|"$/g, ""));
    if (cols.length < 14) continue;
    const [
      _id,
      name,
      city,
      country,
      iata,
      icao,
      lat,
      lon,
      _alt,
      _tzOff,
      _dst,
      tz,
      type,
      _source,
    ] = cols;

    if (!iata || iata === "\\N") {
      skipped.noIata++;
      continue;
    }
    if (!/^[A-Z]{3}$/.test(iata)) {
      skipped.badIata++;
      continue;
    }
    if (type && type !== "airport") {
      skipped.notAirport++;
      continue;
    }
    const iso = countryToIso.get(country);
    if (!iso) {
      skipped.noCountry++;
      continue;
    }
    if (!tz || tz === "\\N") {
      skipped.noTz++;
      continue;
    }
    const latN = Number(lat),
      lonN = Number(lon);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) {
      skipped.badCoords++;
      continue;
    }
    const region = REGION_BY_ISO2[iso];
    if (!region) {
      skipped.noRegion++;
      continue;
    }
    if (seenIata.has(iata)) {
      skipped.duplicate++;
      continue;
    }
    seenIata.add(iata);

    rows.push({
      iata,
      icao: icao && icao !== "\\N" && /^[A-Z0-9]{1,4}$/.test(icao) ? icao : null,
      name,
      city: city || name,
      countryIso2: iso,
      region,
      latMicro: Math.round(latN * 1_000_000),
      lonMicro: Math.round(lonN * 1_000_000),
      tzOlson: tz,
    });
  }
  return { rows, skipped };
}

function emitUpsertSql(rows: AirportRow[], batchSize = 500): string[] {
  const batches: string[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk
      .map(
        (r) =>
          `('${r.iata}', ${r.icao ? `'${r.icao}'` : "NULL"}, '${sqlEscape(r.name)}', '${sqlEscape(r.city)}', '${r.countryIso2}', '${r.region}', ${r.latMicro}, ${r.lonMicro}, '${sqlEscape(r.tzOlson)}', TRUE)`,
      )
      .join(",\n  ");
    const sql = `INSERT INTO airports (iata, icao, name, city, country_iso2, region, lat_micro, lon_micro, tz_olson, active) VALUES\n  ${values}\nON CONFLICT (iata) DO UPDATE SET\n  icao = EXCLUDED.icao,\n  name = EXCLUDED.name,\n  city = EXCLUDED.city,\n  country_iso2 = EXCLUDED.country_iso2,\n  region = EXCLUDED.region,\n  lat_micro = EXCLUDED.lat_micro,\n  lon_micro = EXCLUDED.lon_micro,\n  tz_olson = EXCLUDED.tz_olson;`;
    batches.push(sql);
  }
  return batches;
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--exec") ? "exec" : "print-sql";

  process.stderr.write("Fetching OpenFlights countries.dat…\n");
  const countryToIso = await fetchCountries();
  process.stderr.write(`  ${countryToIso.size} countries mapped.\n`);

  process.stderr.write("Fetching OpenFlights airports.dat…\n");
  const { rows, skipped } = await fetchAirports(countryToIso);
  process.stderr.write(`  ${rows.length} airports retained after filtering.\n`);
  process.stderr.write(`  Skipped: ${JSON.stringify(skipped)}\n`);

  const batches = emitUpsertSql(rows, 500);
  process.stderr.write(`  ${batches.length} batch(es) of ≤500 rows each.\n`);

  if (mode === "exec") {
    const url = process.env.DATABASE_URL;
    if (!url) {
      process.stderr.write("DATABASE_URL not set; --exec requires it.\n");
      process.exit(1);
    }
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { prepare: false, max: 4 });
    try {
      for (let i = 0; i < batches.length; i++) {
        process.stderr.write(`  Batch ${i + 1}/${batches.length}…\n`);
        await sql.unsafe(batches[i]);
      }
      const [{ count }] = await sql<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM airports
      `;
      process.stderr.write(`Done. airports row count: ${count}\n`);
    } finally {
      await sql.end();
    }
  } else {
    // Print one batch per "--BATCH N--" separator so the consumer can split.
    for (let i = 0; i < batches.length; i++) {
      process.stdout.write(`-- BATCH ${i + 1}/${batches.length}\n${batches[i]}\n\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`syncOpenFlights failed: ${err.stack || err}\n`);
  process.exit(1);
});
