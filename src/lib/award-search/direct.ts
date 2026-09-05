import JSON5 from "json5";
import { createHash } from "node:crypto";
import {
  cabin,
  number,
  ProviderError,
  type AwardResult,
  type AwardPrice,
} from "./types";
import type { SearchQuery } from "@/lib/types";
import { bookingUrl } from "@/lib/bookingHandoff";

// These adapters read publicly accessible award-search responses; never execute
// airline JavaScript or turn failed HTTP responses into invented availability.
export const DIRECT_PROGRAMS = [
  "AS_MILEAGEPLAN",
  "B6_TRUEBLUE",
  "VS_FLYING_CLUB",
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
export function parseAlaska(
  html: string,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const pattern =
    /__sveltekit_[a-z0-9_]+\.resolve\(\s*\d+\s*,\s*\(\s*\)\s*=>\s*(.*?)\s*\)\s*<\/script>/gs;
  let found = false;
  const result: AwardResult[] = [];
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
        const segments = row.segments.map((s: Record<string, unknown>) => {
          const pc = s.publishingCarrier as
            { carrierCode?: string; flightNumber?: string } | undefined;
          return {
            origin: String(s.departureStation ?? ""),
            destination: String(s.arrivalStation ?? ""),
            departure:
              typeof s.departureTime === "string" ? s.departureTime : null,
            arrival: typeof s.arrivalTime === "string" ? s.arrivalTime : null,
            airline: pc?.carrierCode ?? "",
            flightNumber: `${pc?.carrierCode ?? ""}${pc?.flightNumber ?? ""}`,
            aircraft: typeof s.aircraft === "string" ? s.aircraft : null,
          };
        });
        if (
          segments[0].departure?.slice(0, 10) !== q.departDate ||
          segments[0].origin !== q.origin ||
          segments.at(-1)?.destination !== q.dest
        )
          continue;
        const prices: AwardResult["prices"] = {};
        for (const raw of Object.values(row.solutions ?? {})) {
          const sol = raw as {
            cabins?: string[];
            atmosPoints?: number;
            milesPoints?: number;
            grandTotal?: number;
            seatsRemaining?: number;
            mixedCabin?: boolean;
          };
          const code = cabin(sol.cabins?.[0]);
          const points = number(sol.atmosPoints ?? sol.milesPoints);
          const seats = number(sol.seatsRemaining);
          if (
            !code ||
            !points ||
            (seats !== null && seats > 0 && seats < q.pax)
          )
            continue;
          const price: AwardPrice = {
            cabin: code,
            points,
            cash: number(sol.grandTotal),
            currency: "USD",
            seats: seats && seats > 0 ? seats : null,
            mixedCabin: !!sol.mixedCabin,
          };
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
          source: "Alaska Airlines",
          freshness: "live",
          observedAt,
          bookingUrl: bookingUrl("AS_MILEAGEPLAN", q),
        });
      }
    }
  }
  if (!found)
    throw new ProviderError(
      "Alaska changed its search response or is temporarily blocking searches.",
    );
  return result;
}
export function parseJetBlue(
  payload: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const p = payload as {
    currencyCode?: string;
    outboundFares?: {
      date: string;
      amount: number;
      tax: number;
      seats: number;
    }[];
  };
  if (!Array.isArray(p?.outboundFares) || p.currencyCode !== "USD")
    throw new ProviderError("JetBlue returned an unexpected award response.");
  const day = p.outboundFares.find((f) => f.date === q.departDate);
  if (!day || !number(day.amount) || !number(day.seats) || day.seats < q.pax)
    return [];
  return [
    {
      id: `B6_${q.origin}_${q.dest}_${q.departDate}`,
      programId: "B6_TRUEBLUE",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "calendar",
      segments: [],
      duration: null,
      prices: {
        Y: {
          cabin: "Y",
          points: day.amount,
          cash: number(day.tax),
          currency: "USD",
          seats: day.seats,
          mixedCabin: false,
        },
      },
      source: "JetBlue",
      freshness: "live",
      observedAt,
      bookingUrl: bookingUrl("B6_TRUEBLUE", q),
    },
  ];
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
          freshness: "live",
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
): Promise<AwardResult[]> {
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
    const res = await fetch(bookingUrl(program, q), {
      ...opts,
      headers: { "User-Agent": ua },
    });
    if (!res.ok)
      throw new ProviderError(
        `Alaska is unavailable (HTTP ${res.status}).`,
        res.status,
      );
    return parseAlaska(await res.text(), q);
  }
  if (program === "B6_TRUEBLUE") {
    const res = await fetch(
      "https://jbrest.jetblue.com/bff/bff-service/bestFares/",
      {
        ...opts,
        method: "POST",
        headers,
        body: JSON.stringify({
          origin: q.origin,
          destination: q.dest,
          month: `${month} ${date.getUTCFullYear()}`,
          fareType: "POINTS",
          tripType: "ONE_WAY",
          adult: q.pax,
          currency: "USD",
        }),
      },
    );
    if (!res.ok)
      throw new ProviderError(
        `JetBlue is unavailable (HTTP ${res.status}).`,
        res.status,
      );
    return parseJetBlue(await res.json(), q);
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
