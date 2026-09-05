import { createHash } from "node:crypto";
import { z } from "zod";
import { cabin, number, ProviderError, type AwardResult } from "./types";
import { providerJson } from "./http";
import { bookingUrl } from "@/lib/bookingHandoff";
import type { SearchQuery } from "@/lib/types";
// Official source IDs: https://developers.seats.aero/reference/concepts-copy
export const SEATS_SOURCES: Record<string, string> = {
  SK_EUROBONUS: "eurobonus",
  VS_FLYING_CLUB: "virginatlantic",
  AM_CLUB_PREMIER: "aeromexico",
  AA_AADVANTAGE: "american",
  DL_SKYMILES: "delta",
  EY_GUEST: "etihad",
  UA_MP: "united",
  EK_SKYWARDS: "emirates",
  AC_AEROPLAN: "aeroplan",
  AS_MILEAGEPLAN: "alaska",
  VA_VELOCITY: "velocity",
  QF_FF: "qantas",
  CM_CONNECTMILES: "connectmiles",
  AD_AZUL_TUDOAZUL: "azul",
  G3_GOL_SMILES: "smiles",
  AF_FLYINGBLUE: "flyingblue",
  B6_TRUEBLUE: "jetblue",
  QR_PRIVILEGE: "qatar",
  TK_MILES_SMILES: "turkish",
  SQ_KRISFLYER: "singapore",
  ET_SHEBAMILES: "ethiopian",
  SV_ALFURSAN: "saudia",
  AY_FINNAIR_PLUS: "finnair",
  LH_MILES_MORE: "lufthansa",
};
const segmentSchema = z.object({
  FlightNumber: z.string(),
  OriginAirport: z.string(),
  DestinationAirport: z.string(),
  DepartsAt: z.string(),
  ArrivesAt: z.string(),
  AircraftCode: z.string().optional(),
  Cabin: z.string().optional(),
});
const tripSchema = z.object({
  ID: z.string(),
  AvailabilitySegments: z.array(segmentSchema).nullish(),
  TotalDuration: z.number().nullish(),
  RemainingSeats: z.number().nullish(),
  MileageCost: z.union([z.string(), z.number()]),
  TotalTaxes: z.number().nullish(),
  TaxesCurrency: z.string().nullish(),
  Cabin: z.string(),
  Source: z.string().optional(),
  UpdatedAt: z.string().optional(),
  MixedCabinPct: z.number().optional(),
});
const responseSchema = z.object({
  results: z.array(z.unknown()),
  success: z.boolean(),
  cached: z.boolean().optional(),
});
export function parseSeats(
  payload: unknown,
  program: string,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const data = responseSchema.safeParse(payload);
  if (!data.success || !data.data.success)
    throw new ProviderError(
      "The live data provider did not complete this search.",
    );
  const out = new Map<string, AwardResult>();
  for (const raw of data.data.results) {
    const parsed = tripSchema.safeParse(raw);
    if (!parsed.success)
      throw new ProviderError("The data provider changed its result format.");
    const t = parsed.data;
    const c = cabin(t.Cabin);
    const points = number(t.MileageCost);
    if (!c || !points) continue;
    if (t.Source && t.Source !== SEATS_SOURCES[program]) continue;
    const segments = (t.AvailabilitySegments ?? []).map((s) => ({
      origin: s.OriginAirport,
      destination: s.DestinationAirport,
      departure: s.DepartsAt,
      arrival: s.ArrivesAt,
      airline: s.FlightNumber.slice(0, 2),
      flightNumber: s.FlightNumber,
      aircraft: s.AircraftCode || null,
      cabin: cabin(s.Cabin),
    }));
    // Flight-level API only; never infer schedules from a route summary.
    if (
      !segments.length ||
      segments[0].origin !== q.origin ||
      segments.at(-1)?.destination !== q.dest ||
      segments[0].departure.slice(0, 10) !== q.departDate
    )
      continue;
    const seats = number(t.RemainingSeats);
    if (seats && seats < q.pax) continue;
    const noTax = ["qatar", "turkish", "singapore"].includes(
      SEATS_SOURCES[program],
    );
    const tax = noTax ? null : number(t.TotalTaxes);
    const cached = !!data.data.cached;
    const timestamp =
      cached && t.UpdatedAt && !t.UpdatedAt.startsWith("0001")
        ? t.UpdatedAt
        : observedAt;
    const id = `seats_${program}_${createHash("sha256")
      .update(segments.map((s) => `${s.flightNumber}@${s.departure}`).join("|"))
      .digest("hex")
      .slice(0, 24)}`;
    const row: AwardResult = {
      id,
      programId: program,
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration: number(t.TotalDuration),
      prices: {
        [c]: {
          cabin: c,
          points,
          cash: tax === null ? null : tax / 100,
          currency: tax === null ? null : t.TaxesCurrency || null,
          seats: seats || null,
          mixedCabin: (t.MixedCabinPct ?? 0) > 0,
        },
      },
      source: "Seats.aero",
      freshness: cached ? "cached" : "live",
      observedAt: timestamp,
      bookingUrl: bookingUrl(program, q),
    };
    const existing = out.get(id);
    if (existing) {
      const previous = existing.prices[c];
      const next = row.prices[c]!;
      if (
        !previous ||
        next.points < previous.points ||
        (next.points === previous.points &&
          (next.cash ?? Infinity) < (previous.cash ?? Infinity))
      )
        existing.prices[c] = next;
    } else out.set(id, row);
  }
  return [...out.values()];
}
export async function seatsSearch(
  program: string,
  q: SearchQuery,
  signal: AbortSignal,
) {
  const key = process.env.SEATS_AERO_API_KEY;
  if (!key) throw new ProviderError("Live data access is not configured.");
  const data = await providerJson(
    "https://seats.aero/partnerapi/live",
    {
      origin_airport: q.origin,
      destination_airport: q.dest,
      departure_date: q.departDate,
      source: SEATS_SOURCES[program],
      seat_count: q.pax,
      show_dynamic_pricing: true,
      smart_cache: false,
    },
    signal,
    { "Partner-Authorization": key },
  );
  return parseSeats(data, program, q);
}
