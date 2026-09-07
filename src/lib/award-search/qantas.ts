import { createHash } from "node:crypto";
import { Impit } from "impit";
import { z } from "zod";
import { bookingUrl } from "@/lib/bookingHandoff";
import { CABIN_ORDER, type SearchQuery } from "@/lib/types";
import {
  cabin,
  ProviderError,
  type AwardPrice,
  type AwardResult,
} from "./types";

const base = "https://flightrewardfinder.qantas.com";
const airport = z.object({ code: z.string().regex(/^[A-Z]{3}$/) });
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
const cabinName = z.enum(["Economy", "PremiumEconomy", "Business", "First"]);
const fare = z.object({
  isSelfTransfer: z.literal(false),
  cabinClass: cabinName,
  points: z.number().nonnegative(),
  seats: z.number().int().nonnegative(),
  tax: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
  rbd: z.string(),
  isDynamicPricing: z.boolean(),
  classDetailId: z.union([z.number(), z.string()]),
  mixedCabinClasses: z.array(cabinName).nullable(),
});
const flight = z.object({
  id: z.union([z.number(), z.string()]),
  program: z.literal("QF"),
  isSelfTransfer: z.literal(false),
  origin: airport,
  destination: airport,
  departsAt: localTime,
  arrivesAt: localTime,
  duration: z.string(),
  stopovers: z.number().int().nonnegative(),
  cabins: z.object({
    Economy: fare.nullable(),
    PremiumEconomy: fare.nullable(),
    Business: fare.nullable(),
    First: fare.nullable(),
  }),
  legs: z
    .array(
      z.object({
        origin: airport,
        destination: airport,
        departsAt: localTime,
        arrivesAt: localTime,
        flightNumber: z.string().min(1),
        airlineCode: z.string().nullable(),
        operatedBy: z.string().nullable(),
        equipment: z.string().nullable(),
      }),
    )
    .min(1),
  lastSeenAt: z.string(),
  // Deliberately omit the source's transient verificationToken. Refreshing a
  // flight requires their browser verification, not a reusable server session.
});
const pageSchema = z.object({
  flights: z.array(flight),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().nonnegative(),
    maxKnownPage: z.number().int().positive(),
  }),
  routeDecision: z
    .discriminatedUnion("blocked", [
      z.object({ blocked: z.literal(false) }),
      z.object({ blocked: z.literal(true), code: z.string() }),
    ])
    .optional(),
});
type Page = z.infer<typeof pageSchema>;

function readPage(input: unknown): Page {
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success)
    throw new ProviderError(
      "Qantas returned an incomplete or changed reward-finder response.",
    );
  if (parsed.data.routeDecision?.blocked)
    throw new ProviderError(
      parsed.data.routeDecision.code === "DOMESTIC_AU_ONLY"
        ? "Qantas's public reward finder does not cover Australian domestic routes. Check Qantas directly."
        : "This route is outside Qantas's public reward-finder coverage.",
      422,
    );
  return parsed.data;
}

function minutes(value: string): number {
  const match = value.match(/^(?:(\d+)\s*hours?)?(?:\s*(\d+)\s*mins?)?$/);
  const total = match ? Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0) : 0;
  if (!total)
    throw new ProviderError("Qantas did not report a valid journey duration.");
  return total;
}

function observation(value: string): string {
  const normalized = value.replace(" ", "T").replace(/\+00$/, "Z");
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ||
    !Number.isFinite(Date.parse(normalized))
  )
    throw new ProviderError("Qantas did not report a valid observation time.");
  return new Date(normalized).toISOString();
}

const currencies: Record<string, string> = {
  AU$: "AUD",
  A$: "AUD",
  US$: "USD",
  NZ$: "NZD",
  CA$: "CAD",
  SG$: "SGD",
  S$: "SGD",
  HK$: "HKD",
  "JP¥": "JPY",
  "£": "GBP",
  "€": "EUR",
};
function currency(value: string | null): string | null {
  const clean = value?.trim();
  return clean
    ? (currencies[clean] ?? (/^[A-Z]{3}$/.test(clean) ? clean : null))
    : null;
}

function rowsFromPage(
  page: Page,
  q: SearchQuery,
  retrievedAt: string,
): AwardResult[] {
  return page.flights.flatMap((f) => {
    if (
      f.origin.code !== q.origin ||
      f.destination.code !== q.dest ||
      f.departsAt.slice(0, 10) !== q.departDate
    )
      throw new ProviderError(
        "Qantas returned results for a different route or date.",
      );
    const segments = f.legs.map((leg) => ({
      origin: leg.origin.code,
      destination: leg.destination.code,
      departure: leg.departsAt,
      arrival: leg.arrivesAt,
      airline: leg.airlineCode ?? leg.flightNumber.slice(0, 2),
      airlineName: leg.operatedBy,
      operatedBy: leg.operatedBy,
      flightNumber: leg.flightNumber.replace(/\s/g, ""),
      aircraft: leg.equipment,
    }));
    if (
      segments[0].origin !== q.origin ||
      segments.at(-1)!.destination !== q.dest ||
      segments[0].departure !== f.departsAt ||
      segments.at(-1)!.arrival !== f.arrivesAt ||
      segments.some((s, i) => i > 0 && segments[i - 1].destination !== s.origin)
    )
      throw new ProviderError(
        "Qantas did not supply a complete connected itinerary.",
      );
    const prices: AwardResult["prices"] = {};
    const fares: AwardPrice[] = [];
    for (const [name, raw] of Object.entries(f.cabins)) {
      if (!raw || raw.points === 0 || raw.seats === 0 || raw.seats < q.pax)
        continue;
      const code = cabin(name)!;
      if (raw.cabinClass !== name)
        throw new ProviderError(
          "Qantas returned conflicting cabin information.",
        );
      if (CABIN_ORDER.indexOf(code) < CABIN_ORDER.indexOf(q.minCabin)) continue;
      const segmentCabins =
        raw.mixedCabinClasses?.map((c) => cabin(c)) ?? segments.map(() => code);
      if (segmentCabins.length !== segments.length)
        throw new ProviderError(
          "Qantas did not identify every mixed-cabin segment.",
        );
      const isoCurrency = currency(raw.currency);
      if (raw.tax !== null && !isoCurrency)
        throw new ProviderError(
          "Qantas returned fees in an unidentified currency.",
        );
      const price: AwardPrice = {
        fareId: String(raw.classDetailId),
        fareName: raw.isDynamicPricing ? "Reward flight" : "Classic Reward",
        cabin: code,
        points: raw.points,
        // Qantas's finder displays per-person amounts for both one and two adults.
        partyPoints: raw.points * q.pax,
        quotedPassengers: q.pax,
        cash: raw.tax,
        currency: isoCurrency,
        seats: raw.seats,
        seatCountLabel: raw.seats > 5 ? "5+ seats reported" : undefined,
        mixedCabin: segmentCabins.some((c) => c !== code),
        segmentCabins,
        bookingClasses: raw.rbd
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        refundable: null,
        bookingNotes: segmentCabins.some(
          (c, i) => c === "F" && segments[i].airline === "EK",
        )
          ? [
              "Qantas lists Emirates First rewards for eligible members with Silver status or higher, with all travelers aged 9 or older. Confirm eligibility with Qantas.",
            ]
          : undefined,
      };
      fares.push(price);
      if (!prices[code] || price.points < prices[code]!.points)
        prices[code] = price;
    }
    if (!fares.length) return [];
    const key = segments
      .map(
        (s) => `${s.flightNumber}:${s.origin}:${s.destination}@${s.departure}`,
      )
      .join("|");
    return [
      {
        id: `qf-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
        programId: "QF_FF",
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        kind: "flight" as const,
        segments,
        duration: minutes(f.duration),
        prices,
        fares,
        // The finder counts connections, not all same-flight stops (e.g. QF1).
        // Preserve the flight but never assert it is nonstop from this response.
        stopDetailsUnconfirmed: true,
        source: "Qantas Classic Reward finder · cached",
        freshness: "cached" as const,
        observedAt: observation(f.lastSeenAt),
        retrievedAt,
        bookingUrl: bookingUrl("QF_FF", q),
      },
    ];
  });
}

export function parseQantas(
  input: unknown,
  q: SearchQuery,
  retrievedAt = new Date().toISOString(),
): AwardResult[] {
  return rowsFromPage(readPage(input), q, retrievedAt);
}

export async function qantasSearch(
  q: SearchQuery,
  outer: AbortSignal,
  onRows?: (rows: AwardResult[]) => void,
): Promise<AwardResult[]> {
  const signal = AbortSignal.any([outer, AbortSignal.timeout(50000)]);
  signal.throwIfAborted();
  // A fresh, account-free HTTP client. No proxies, stored browser cookies,
  // challenge solving or disabled TLS verification.
  const client = new Impit({ browser: "chrome", timeout: 20000 });
  const rows = new Map<string, AwardResult>();
  let pageNumber = 1,
    lastPage = 1;
  const seenPages = new Set<string>();
  do {
    signal.throwIfAborted();
    const params = new URLSearchParams({
      o: q.origin,
      d: q.dest,
      dr: `${q.departDate}I${q.departDate}`,
      p: String(q.pax),
      pr: "QF",
      pg: String(pageNumber),
      ic: "0",
    });
    const response = await client.fetch(`${base}/api/search?${params}`, {
      signal,
      redirect: "error",
      headers: { Accept: "application/json", Referer: `${base}/` },
    });
    if (!response.ok)
      throw new ProviderError(
        `Qantas reward finder is unavailable (HTTP ${response.status}).`,
        response.status,
      );
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError("Qantas did not return award inventory.");
    }
    const page = readPage(data);
    if (
      page.pagination.page !== pageNumber ||
      page.pagination.maxKnownPage < pageNumber
    )
      throw new ProviderError(
        "Qantas returned inconsistent pagination; coverage is incomplete.",
      );
    const fingerprint = page.flights
      .map((f) => String(f.id))
      .sort()
      .join(",");
    if (fingerprint && seenPages.has(fingerprint))
      throw new ProviderError(
        "Qantas repeated a result page; coverage is incomplete.",
      );
    seenPages.add(fingerprint);
    for (const row of rowsFromPage(page, q, new Date().toISOString())) {
      const previous = rows.get(row.id);
      if (previous) {
        const fares = new Map(previous.fares!.map((p) => [p.fareId, p]));
        row.fares!.forEach((p) => fares.set(p.fareId, p));
        row.fares = [...fares.values()];
        row.prices = {};
        for (const p of row.fares)
          if (!row.prices[p.cabin] || p.points < row.prices[p.cabin]!.points)
            row.prices[p.cabin] = p;
      }
      rows.set(row.id, row);
    }
    signal.throwIfAborted();
    onRows?.([...rows.values()]);
    // The last known page can grow as subsequent pages are fetched.
    lastPage = Math.max(lastPage, page.pagination.maxKnownPage);
    pageNumber++;
  } while (pageNumber <= lastPage);
  signal.throwIfAborted();
  return [...rows.values()];
}
