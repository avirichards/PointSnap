/**
 * Phase 2.5 — Frontend-only catalogue of the 28 airline programs the
 * Phase 2.5 / Phase 3 scraper rollout will cover.
 *
 * Source: `tasks/scraper-rubric.md` (Phase 0 output) plus the worker's
 * `PLUGINS` dict in `python-workers/serve.py`. Kept here (not the DB
 * `programs` table) because:
 *   1. The page is client-rendered and the DB seed only carries the 13
 *      launch programs — Phase 3 NEWs aren't there yet.
 *   2. We need a stable, type-checked enum for `program_id` shared
 *      between API client + UI without round-tripping through Drizzle.
 *
 * When the worker adds the 15 Phase-3 plugins to PLUGINS, the
 * `authRequired` flags here drive whether the cockpit shows a "Connect"
 * button. See the rubric's "Auth req'd?" column.
 */
export interface ProgramCatalogEntry {
  /** Stable upper-snake-case id matching worker PLUGINS + DB programs.id. */
  id: ProgramId;
  /** Two-letter IATA of the sponsor airline (for short labels / icons). */
  iata: string;
  /** Display name. */
  name: string;
  /** Country code for grouping; same code BD uses for residential routing. */
  country: string;
  /**
   * Does award search on this program require the user to log in?
   *   - "required"  → cookies are mandatory; show Connect button
   *   - "partial"   → anonymous works for some classes (QF Classic Reward
   *                   only); Connect still useful for richer data
   *   - "optional"  → anonymous works for award search; we still offer
   *                   Connect for users who want richer data / no captcha
   */
  authRequired: "required" | "partial" | "optional";
}

/** Lowercase frozen-tuple of every program id we currently know about. */
export const PROGRAM_IDS = [
  // Existing 13 launch programs (worker PLUGINS as of Phase 0).
  "VS_FLYING_CLUB",
  "AS_MILEAGEPLAN",
  "BA_AVIOS",
  "AV_LIFEMILES",
  "AF_FLYINGBLUE",
  "UA_MP",
  "TK_MILES_SMILES",
  "NH_ANA",
  "AA_AADVANTAGE",
  "DL_SKYMILES",
  "CX_CATHAY",
  "AC_AEROPLAN",
  "LH_MILES_MORE",
  // Phase 3 NEW programs (rubric §"Per-airline rubric").
  "AM_CLUB_PREMIER",
  "AD_AZUL_TUDOAZUL",
  "CM_CONNECTMILES",
  "EK_SKYWARDS",
  "ET_SHEBAMILES",
  "EY_GUEST",
  "SK_EUROBONUS",
  "AY_FINNAIR_PLUS",
  "B6_TRUEBLUE",
  "QF_FF",
  "QR_PRIVILEGE",
  "SV_ALFURSAN",
  "SQ_KRISFLYER",
  "G3_GOL_SMILES",
  "VA_VELOCITY",
  "F9_FRONTIER_MILES",
  "WN_RAPID_REWARDS",
] as const;

export type ProgramId = (typeof PROGRAM_IDS)[number];

export const PROGRAMS: readonly ProgramCatalogEntry[] = [
  { id: "WN_RAPID_REWARDS", iata: "WN", name: "Southwest Rapid Rewards", country: "us", authRequired: "optional" },
  { id: "F9_FRONTIER_MILES", iata: "F9", name: "Frontier Miles", country: "us", authRequired: "optional" },
  // Existing 13
  {
    id: "AC_AEROPLAN",
    iata: "AC",
    name: "Air Canada Aeroplan",
    country: "ca",
    authRequired: "required",
  },
  {
    id: "AA_AADVANTAGE",
    iata: "AA",
    name: "American AAdvantage",
    country: "us",
    authRequired: "optional",
  },
  {
    id: "AF_FLYINGBLUE",
    iata: "AF",
    name: "Air France/KLM Flying Blue",
    country: "fr",
    authRequired: "required",
  },
  {
    id: "AS_MILEAGEPLAN",
    iata: "AS",
    name: "Alaska Atmos Rewards",
    country: "us",
    authRequired: "optional",
  },
  {
    id: "AV_LIFEMILES",
    iata: "AV",
    name: "Avianca LifeMiles",
    country: "co",
    authRequired: "required",
  },
  {
    id: "BA_AVIOS",
    iata: "BA",
    name: "British Airways Avios",
    country: "gb",
    authRequired: "required",
  },
  {
    id: "CX_CATHAY",
    iata: "CX",
    name: "Cathay Asia Miles",
    country: "hk",
    authRequired: "required",
  },
  {
    id: "DL_SKYMILES",
    iata: "DL",
    name: "Delta SkyMiles",
    country: "us",
    authRequired: "required",
  },
  {
    id: "LH_MILES_MORE",
    iata: "LH",
    name: "Lufthansa Miles & More",
    country: "de",
    authRequired: "required",
  },
  {
    id: "NH_ANA",
    iata: "NH",
    name: "ANA Mileage Club",
    country: "jp",
    authRequired: "required",
  },
  {
    id: "TK_MILES_SMILES",
    iata: "TK",
    name: "Turkish Miles&Smiles",
    country: "tr",
    authRequired: "required",
  },
  {
    id: "UA_MP",
    iata: "UA",
    name: "United MileagePlus",
    country: "us",
    authRequired: "required",
  },
  {
    id: "VS_FLYING_CLUB",
    iata: "VS",
    name: "Virgin Atlantic Flying Club",
    country: "gb",
    authRequired: "required",
  },
  // Phase 3
  {
    id: "AM_CLUB_PREMIER",
    iata: "AM",
    name: "Aeromexico Rewards",
    country: "mx",
    authRequired: "optional",
  },
  {
    id: "AD_AZUL_TUDOAZUL",
    iata: "AD",
    name: "Azul TudoAzul",
    country: "br",
    authRequired: "required",
  },
  {
    id: "CM_CONNECTMILES",
    iata: "CM",
    name: "Copa ConnectMiles",
    country: "pa",
    authRequired: "required",
  },
  {
    id: "EK_SKYWARDS",
    iata: "EK",
    name: "Emirates Skywards",
    country: "ae",
    authRequired: "required",
  },
  {
    id: "ET_SHEBAMILES",
    iata: "ET",
    name: "Ethiopian ShebaMiles",
    country: "et",
    authRequired: "required",
  },
  {
    id: "EY_GUEST",
    iata: "EY",
    name: "Etihad Guest",
    country: "ae",
    authRequired: "optional",
  },
  {
    id: "SK_EUROBONUS",
    iata: "SK",
    name: "SAS EuroBonus",
    country: "se",
    authRequired: "optional",
  },
  {
    id: "AY_FINNAIR_PLUS",
    iata: "AY",
    name: "Finnair Plus",
    country: "fi",
    authRequired: "required",
  },
  {
    id: "B6_TRUEBLUE",
    iata: "B6",
    name: "JetBlue TrueBlue",
    country: "us",
    authRequired: "required",
  },
  {
    id: "QF_FF",
    iata: "QF",
    name: "Qantas Frequent Flyer",
    country: "au",
    authRequired: "partial",
  },
  {
    id: "QR_PRIVILEGE",
    iata: "QR",
    name: "Qatar Privilege Club",
    country: "qa",
    authRequired: "required",
  },
  {
    id: "SV_ALFURSAN",
    iata: "SV",
    name: "Saudia Alfursan",
    country: "sa",
    authRequired: "required",
  },
  {
    id: "SQ_KRISFLYER",
    iata: "SQ",
    name: "Singapore KrisFlyer",
    country: "sg",
    authRequired: "required",
  },
  {
    id: "G3_GOL_SMILES",
    iata: "G3",
    name: "GOL Smiles",
    country: "br",
    authRequired: "required",
  },
  {
    id: "VA_VELOCITY",
    iata: "VA",
    name: "Virgin Australia Velocity",
    country: "au",
    authRequired: "required",
  },
] as const;

export function getProgram(id: ProgramId): ProgramCatalogEntry | undefined {
  return PROGRAMS.find((p) => p.id === id);
}

/**
 * Color hash → consistent per-program circle background. Deterministic
 * so a given IATA code always paints the same color across re-renders.
 * Avoids leaning on the brand colors (Apple HIG §"Branding": defer to
 * content — never replicate carrier livery, that's a trademark issue).
 *
 * Uses oklch in the design-system palette so dark/light modes look
 * harmonious without per-program overrides.
 */
const PALETTE: readonly string[] = [
  "oklch(0.78 0.14 25)", // coral
  "oklch(0.78 0.14 65)", // amber
  "oklch(0.78 0.14 145)", // green
  "oklch(0.78 0.14 195)", // teal
  "oklch(0.78 0.14 250)", // blue
  "oklch(0.78 0.14 285)", // violet
  "oklch(0.78 0.14 325)", // magenta
];

export function iconColorForProgram(id: ProgramId): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? PALETTE[0]!;
}
