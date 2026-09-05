import JSON5 from "json5";
import { createHash } from "node:crypto";
import { Impit } from "impit";
import {
  cabin,
  number,
  ProviderError,
  type AwardResult,
  type AwardPrice,
  type AwardSegment,
} from "./types";
import { CABIN_ORDER, type SearchQuery } from "@/lib/types";
import { bookingUrl } from "@/lib/bookingHandoff";
import { skywardsSearch } from "./skywards";
import { frontierSearch } from "./frontier";
import { aeromexicoSearch } from "./aeromexico";
import { jetblueSearch } from "./jetblue";
import { ethiopianSearch } from "./ethiopian";
import { qantasSearch } from "./qantas";

// These adapters read publicly accessible award-search responses; never execute
// airline JavaScript or turn failed HTTP responses into invented availability.
export const DIRECT_PROGRAMS = [
  "AS_MILEAGEPLAN",
  "B6_TRUEBLUE",
  "VS_FLYING_CLUB",
  "EK_SKYWARDS",
  "F9_FRONTIER_MILES",
  "AM_CLUB_PREMIER",
  "ET_SHEBAMILES",
  "QF_FF",
];
const ua = "Mozilla/5.0 (compatible; PointSnap/1.0)";
export function normalizeLiteral(input: string): string {
  // Normalize JavaScript undefined literals only OUTSIDE quoted strings.
  let out = "",
    i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < input.length) {
        const n = input[i++];
        out += n;
        if (n === "\\" && i < input.length) out += input[i++];
        else if (n === quote) break;
      }
    } else {
      const m = input
        .slice(i)
        .match(/^(?:void\s*\(\s*0\s*\)|void\s+0|undefined)(?![\w$])/);
      if (m && (i === 0 || !/[\w$]/.test(input[i - 1]))) {
        out += "null";
        i += m[0].length;
      } else {
        out += c;
        i++;
      }
    }
  }
  return out;
}
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 24);
interface AlaskaSolution {
  cabins?: string[];
  atmosPoints?: number;
  milesPoints?: number;
  grandTotal?: number;
  seatsRemaining?: number;
  mixedCabin?: boolean;
  refundable?: boolean;
}
interface AlaskaRow {
  segments: Record<string, unknown>[];
  solutions?: Record<string, AlaskaSolution>;
  duration?: number;
}
function alaskaRows(html: string, q: SearchQuery): AlaskaRow[] {
  const pattern =
    /__sveltekit_[a-z0-9_]+\.resolve\(\s*\d+\s*,\s*\(\s*\)\s*=>\s*(.*?)\s*\)\s*<\/script>/gs;
  let found = false;
  const result: AlaskaRow[] = [];
  for (const match of html.matchAll(pattern)) {
    if (
      !match[1].includes("departureStation") ||
      !/["']?rows["']?\s*:/.test(match[1])
    )
      continue;
    let decoded;
    try {
      decoded = JSON5.parse(normalizeLiteral(match[1]));
    } catch {
      continue;
    }
    if (!Array.isArray(decoded)) continue;
    for (const top of decoded) {
      if (
        top?.departureStation !== q.origin ||
        top?.arrivalStation !== q.dest ||
        !Array.isArray(top.rows)
      )
        continue;
      found = true;
      for (const row of top.rows) {
        if (!Array.isArray(row.segments) || !row.segments.length) continue;
        result.push(row);
      }
    }
  }
  if (!found)
    throw new ProviderError(
      "Alaska changed its search response or is temporarily blocking searches.",
    );
  return result;
}
function alaskaSegments(row: AlaskaRow): AwardSegment[] {
  return row.segments.map((s: Record<string, unknown>) => {
    const pc = s.publishingCarrier as
      | {
          carrierCode?: string;
          flightNumber?: string;
          carrierFullName?: string;
        }
      | undefined;
    return {
      origin: String(s.departureStation ?? ""),
      destination: String(s.arrivalStation ?? ""),
      departure: typeof s.departureTime === "string" ? s.departureTime : null,
      arrival: typeof s.arrivalTime === "string" ? s.arrivalTime : null,
      airline: pc?.carrierCode ?? "",
      airlineName: pc?.carrierFullName ?? null,
      operatedBy:
        typeof s.operationalDisclosure === "string"
          ? s.operationalDisclosure
          : null,
      flightNumber: `${pc?.carrierCode ?? ""}${pc?.flightNumber ?? ""}`,
      aircraft: typeof s.aircraft === "string" ? s.aircraft : null,
    };
  });
}

function matchesRoute(segments: AwardSegment[], q: SearchQuery) {
  return (
    segments[0]?.departure?.slice(0, 10) === q.departDate &&
    segments[0]?.origin === q.origin &&
    segments.at(-1)?.destination === q.dest
  );
}
function flightKey(segments: AwardSegment[]) {
  return segments
    .map(
      (s) =>
        `${s.flightNumber}:${s.origin}:${s.destination}@${s.departure}/${s.arrival}`,
    )
    .join("|");
}
export function alaskaCashUrl(q: SearchQuery) {
  const url = new URL(bookingUrl("AS_MILEAGEPLAN", q));
  url.searchParams.set("ShoppingMethod", "online");
  url.searchParams.delete("awardType");
  return url.toString();
}
export function attachAlaskaCash(
  awards: AwardResult[],
  html: string,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const fares = new Map<string, NonNullable<AwardPrice["cashFare"]>>();
  for (const row of alaskaRows(html, q)) {
    const segments = alaskaSegments(row);
    if (!matchesRoute(segments, q)) continue;
    for (const [name, sol] of Object.entries(row.solutions ?? {})) {
      const code = cabin(sol.cabins?.[0]);
      const amount = number(sol.grandTotal),
        seats = number(sol.seatsRemaining);
      if (
        !code ||
        amount === null ||
        amount <= 0 ||
        sol.mixedCabin ||
        sol.cabins?.some((c) => cabin(c) !== code) ||
        number(sol.atmosPoints ?? sol.milesPoints) ||
        (seats !== null && seats > 0 && seats < q.pax)
      )
        continue;
      const key = `${flightKey(segments)}:${code}`;
      if (amount >= (fares.get(key)?.amount ?? Infinity)) continue;
      fares.set(key, {
        amount,
        currency: "USD",
        fareName: name.replaceAll("_", " ").toLowerCase(),
        refundable: typeof sol.refundable === "boolean" ? sol.refundable : null,
        observedAt,
        bookingUrl: alaskaCashUrl(q),
      });
    }
  }
  return awards.map((row) => {
    const enrich = (price: AwardPrice) => {
      const cashFare =
        row.kind === "flight" && !price.mixedCabin
          ? fares.get(`${flightKey(row.segments)}:${price.cabin}`)
          : undefined;
      return cashFare ? { ...price, cashFare } : price;
    };
    return {
      ...row,
      prices: Object.fromEntries(
        Object.entries(row.prices).map(([code, price]) => [
          code,
          enrich(price),
        ]),
      ),
      fares: row.fares?.map(enrich),
    };
  });
}
export function parseAlaska(
  html: string,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const result: AwardResult[] = [];
  for (const row of alaskaRows(html, q)) {
    const segments = alaskaSegments(row);
    if (!matchesRoute(segments, q)) continue;
    const prices: AwardResult["prices"] = {};
    const fares: AwardPrice[] = [];
    for (const [fareId, sol] of Object.entries(row.solutions ?? {})) {
      const segmentCabins = (sol.cabins ?? []).map(cabin);
      const code = CABIN_ORDER.findLast((c) => segmentCabins.includes(c));
      const points = number(sol.atmosPoints ?? sol.milesPoints);
      const seats = number(sol.seatsRemaining);
      if (!code || !points || (seats !== null && seats > 0 && seats < q.pax))
        continue;
      const price: AwardPrice = {
        fareId,
        fareName: fareId.replaceAll("_", " ").toLowerCase(),
        refundable: typeof sol.refundable === "boolean" ? sol.refundable : null,
        segmentCabins,
        cabin: code,
        points,
        cash: number(sol.grandTotal),
        currency: "USD",
        seats: seats && seats > 0 ? seats : null,
        mixedCabin: !!sol.mixedCabin || segmentCabins.some((c) => c !== code),
      };
      fares.push(price);
      const previous = prices[code];
      if (
        !previous ||
        points < previous.points ||
        (points === previous.points &&
          (price.cash ?? Infinity) < (previous.cash ?? Infinity))
      )
        prices[code] = price;
    }
    if (!Object.keys(prices).length) continue;
    const key = segments
      .map(
        (s: { flightNumber: string; departure: string | null }) =>
          `${s.flightNumber}@${s.departure}`,
      )
      .join("|");
    result.push({
      id: `AS_${hash(key)}`,
      programId: "AS_MILEAGEPLAN",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration: number(row.duration),
      prices,
      fares,
      source: "Alaska Airlines",
      freshness: "live",
      observedAt,
      bookingUrl: bookingUrl("AS_MILEAGEPLAN", q),
    });
  }
  return result;
}
export function parseVirgin(
  payload: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  if (!Array.isArray(payload))
    throw new ProviderError(
      "Virgin Atlantic returned an unexpected award response.",
    );
  const day = payload
    .flatMap((m) => (Array.isArray(m?.pointsDays) ? m.pointsDays : []))
    .find((d) => d.date === q.departDate);
  if (!day) return [];
  const prices: AwardResult["prices"] = {};
  for (const [key, code] of [
    ["awardEconomy", "Y"],
    ["awardComfortPlusPremiumEconomy", "W"],
    ["awardBusiness", "J"],
  ] as const) {
    const points = number(day.seats?.[key]?.cabinPointsValue);
    const seats = number(day.seats?.[key]?.cabinClassSeatCount);
    if (points && seats && seats >= q.pax)
      prices[code] = {
        cabin: code,
        points,
        cash: null,
        currency: null,
        seats,
        mixedCabin: false,
      };
  }
  return Object.keys(prices).length
    ? [
        {
          id: `VS_${q.origin}_${q.dest}_${q.departDate}`,
          programId: "VS_FLYING_CLUB",
          origin: q.origin,
          destination: q.dest,
          date: q.departDate,
          kind: "calendar",
          segments: [],
          duration: null,
          prices,
          source: "Virgin Atlantic",
          freshness: "cached",
          retrievedAt: observedAt,
          observedAt,
          bookingUrl: bookingUrl("VS_FLYING_CLUB", q),
        },
      ]
    : [];
}
export async function directSearch(
  program: string,
  q: SearchQuery,
  signal: AbortSignal,
  onRows?: (rows: AwardResult[]) => void,
): Promise<AwardResult[]> {
  if (program === "EK_SKYWARDS") return skywardsSearch(q, signal);
  if (program === "F9_FRONTIER_MILES") return frontierSearch(q, signal);
  if (program === "AM_CLUB_PREMIER") return aeromexicoSearch(q, signal);
  if (program === "B6_TRUEBLUE") return jetblueSearch(q, signal, onRows);
  if (program === "ET_SHEBAMILES") return ethiopianSearch(q, signal, onRows);
  if (program === "QF_FF") return qantasSearch(q, signal, onRows);
  const headers = {
    "User-Agent": ua,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const date = new Date(q.departDate + "T12:00:00Z");
  const month = date
    .toLocaleString("en-US", { month: "long", timeZone: "UTC" })
    .toUpperCase();
  const opts = {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    cache: "no-store" as const,
  };
  if (program === "AS_MILEAGEPLAN") {
    // Native fetch returned a non-inventory document from hosted Linux.
    // This fresh compatible client preserves the complete public SSR response.
    const client = new Impit({ browser: "chrome", timeout: 30000 });
    const alaskaHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    };
    // Cash enrichment must never suppress a valid award result or delay its first display.
    const cashTask = client
      .fetch(alaskaCashUrl(q), {
        ...opts,
        signal: AbortSignal.any([signal, AbortSignal.timeout(18000)]),
        headers: alaskaHeaders,
      })
      .then(async (res) =>
        res.ok
          ? { html: await res.text(), at: new Date().toISOString() }
          : null,
      )
      .catch(() => null);
    const res = await client.fetch(bookingUrl(program, q), {
      ...opts,
      headers: alaskaHeaders,
    });
    if (!res.ok)
      throw new ProviderError(
        `Alaska is unavailable (HTTP ${res.status}).`,
        res.status,
      );
    const rows = parseAlaska(await res.text(), q);
    if (signal.aborted) throw signal.reason;
    onRows?.(rows);
    const cash = await cashTask;
    if (signal.aborted) throw signal.reason;
    if (cash) {
      try {
        return attachAlaskaCash(rows, cash.html, q, cash.at);
      } catch {
        /* Airline cash search may be blocked or change independently. */
      }
    }
    return rows;
  }
  const endpoint =
    "https://www.virginatlantic.com/travelplus/reward-seat-checker-api/";
  let res = await fetch(endpoint, {
    ...opts,
    redirect: "manual",
    method: "POST",
    headers: {
      ...headers,
      Origin: "https://www.virginatlantic.com",
      Referer: bookingUrl(program, q),
    },
    body: JSON.stringify({
      slice: {
        origin: q.origin,
        destination: q.dest,
        departure: q.departDate.slice(0, 8) + "01",
      },
      passengers: Array(q.pax).fill("ADULT"),
      permittedCarriers: ["VS"],
      years: [date.getUTCFullYear()],
      months: [month],
    }),
  });
  // The public checker creates a transient session, then redirects to its result.
  // Node fetch has no cookie jar; retain these cookies only for this request.
  if (res.status === 303) {
    const location = res.headers.get("location");
    if (!location)
      throw new ProviderError(
        "Virgin Atlantic did not return a search location.",
      );
    const target = new URL(location, endpoint);
    if (
      target.origin !== new URL(endpoint).origin ||
      !target.pathname.startsWith(new URL(endpoint).pathname)
    ) {
      throw new ProviderError(
        "Virgin Atlantic returned an unexpected search location.",
      );
    }
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    await res.body?.cancel();
    res = await fetch(target, {
      ...opts,
      redirect: "error",
      headers: { ...headers, Cookie: cookie },
    });
  }
  if (res.status === 204)
    throw new ProviderError(
      "Virgin Atlantic did not return award data. Please try again.",
    );
  if (!res.ok)
    throw new ProviderError(
      `Virgin Atlantic is unavailable (HTTP ${res.status}).`,
      res.status,
    );
  return parseVirgin(await res.json(), q);
}
