import { qatarBookingUrl } from "../bookingHandoff";
export { qatarBookingUrl } from "../bookingHandoff";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CABIN_ORDER, type Cabin, type SearchQuery } from "@/lib/types";
import { ProviderError, type AwardPrice, type AwardResult } from "./types";

const code = z.string().regex(/^[A-Z]{3}$/);
const integer = z.number().int().nonnegative();
const localTime = z.iso.datetime({ local: true });
export const qatarRequestSchema = z.object({
  channel: z.literal("WEB_DESKTOP"),
  itineraries: z
    .array(
      z.object({
        origin: code,
        destination: code,
        departureDate: z.iso.date(),
        isRequested: z.literal(true),
      }),
    )
    .length(1),
  cabinClass: z.enum(["ECONOMY", "PREMIUM"]),
  passengers: z
    .array(
      z.object({ type: z.literal("ADT"), count: integer.positive().max(9) }),
    )
    .length(1),
  includeMixedCabin: z.literal("Yes"),
  multiSegmentOffers: z.literal(true),
});
const segmentSchema = z.object({
  flightId: z.string().min(1),
  flightNumber: z.string().regex(/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/),
  vehicle: z.object({
    code: z.string(),
    name: z.string(),
    type: z.literal("AIRCRAFT"),
  }),
  departure: z.object({
    origin: z.object({ iataCode: code }),
    dateTime: localTime,
  }),
  arrival: z.object({
    destination: z.object({ iataCode: code }),
    dateTime: localTime,
  }),
  duration: integer.positive(),
  // Fail explicitly until a real same-flight-stop shape is qualified.
  stops: z.array(z.never()),
  operatingAirlineName: z.string().min(1),
  qSuiteEquipped: z.boolean(),
});
const fareSchema = z.object({
  boundId: z.string().min(1),
  availableSeats: integer,
  price: z.object({
    base: integer.positive(),
    currencyCode: z.literal("AVIOS"),
  }),
  cabinType: z.enum(["ECONOMY", "BUSINESS", "FIRST"]),
  cabinOfferType: z.string().min(1),
  fareInformation: z
    .array(z.object({ flightId: z.string().min(1), isFlexiFare: z.boolean() }))
    .min(1),
  isFlexiFare: z.boolean(),
  privilegePickIndicator: z.boolean(),
  offPeakIndicator: z.boolean(),
});
export const qatarResponseSchema = z.object({
  flightOffers: z.array(
    z.object({
      id: z.string().min(1),
      origin: z.object({ iataCode: code }),
      destination: z.object({ iataCode: code }),
      duration: integer.positive(),
      numberOfStops: integer,
      segments: z.array(segmentSchema).min(1),
      fareOffers: z.array(fareSchema),
      airportChanges: z.array(z.never()),
    }),
  ),
});
export const qatarPayloadSchema = z.object({
  type: z.literal("qatar-native-cabin-searches"),
  searches: z
    .array(
      z.object({ request: qatarRequestSchema, response: qatarResponseSchema }),
    )
    .length(2),
});
export type QatarPayload = z.infer<typeof qatarPayloadSchema>;
/** Keep inventory joins without returning the airline's opaque selection IDs. */
export function compactQatarPayload(input: unknown): QatarPayload {
  const p = qatarPayloadSchema.parse(input);
  for (const search of p.searches)
    for (const f of search.response.flightOffers) {
      f.id = hash(f.id);
      for (const s of f.segments) s.flightId = hash(s.flightId);
      for (const a of f.fareOffers) {
        a.boundId = hash(a.boundId);
        for (const info of a.fareInformation)
          info.flightId = hash(info.flightId);
      }
    }
  return p;
}
export type QatarFlight = z.infer<
  typeof qatarResponseSchema
>["flightOffers"][number];
const cabins: Record<string, Cabin> = {
  ECONOMY: "Y",
  BUSINESS: "J",
  FIRST: "F",
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24);
const fail = (reason: string): never => {
  throw new ProviderError(
    `Qatar ${reason}; complete award results could not be confirmed.`,
    503,
  );
};
export const qatarFlightKey = (f: QatarFlight) =>
  f.segments
    .map((s) =>
      [
        s.flightNumber,
        s.departure.origin.iataCode,
        s.arrival.destination.iataCode,
        s.departure.dateTime,
        s.arrival.dateTime,
      ].join("|"),
    )
    .join(";");

export function validateQatarRequest(
  input: unknown,
  q: SearchQuery,
  scope: "ECONOMY" | "PREMIUM",
) {
  const parsed = qatarRequestSchema.safeParse(input);
  if (!parsed.success) fail("changed its award-search request format");
  const r = parsed.data!,
    i = r.itineraries[0];
  if (
    q.returnDate ||
    i.origin !== q.origin ||
    i.destination !== q.dest ||
    i.departureDate !== q.departDate ||
    r.passengers[0].count !== q.pax ||
    r.cabinClass !== scope
  )
    fail("requested a different route, date, party or cabin scope");
  return r;
}

export function validateQatarFlights(input: unknown, q: SearchQuery) {
  const parsed = qatarResponseSchema.safeParse(input);
  if (!parsed.success) fail("changed its flight, fare or stop format");
  const flights = parsed.data!.flightOffers,
    seen = new Set<string>();
  for (const f of flights) {
    const first = f.segments[0],
      last = f.segments.at(-1)!,
      key = qatarFlightKey(f);
    if (seen.has(key)) fail("returned duplicate flight combinations");
    seen.add(key);
    if (
      f.origin.iataCode !== q.origin ||
      f.destination.iataCode !== q.dest ||
      first.departure.origin.iataCode !== q.origin ||
      last.arrival.destination.iataCode !== q.dest ||
      first.departure.dateTime.slice(0, 10) !== q.departDate ||
      f.numberOfStops !== f.segments.length - 1
    )
      fail("returned an inconsistent itinerary");
    const ids = f.segments.map((s) => s.flightId);
    if (new Set(ids).size !== ids.length) fail("repeated a flight segment");
    if (f.duration < f.segments.reduce((n, s) => n + s.duration, 0))
      fail("returned an inconsistent journey duration");
    for (let i = 1; i < f.segments.length; i++) {
      const a = f.segments[i - 1],
        b = f.segments[i];
      if (
        a.arrival.destination.iataCode !== b.departure.origin.iataCode ||
        a.arrival.dateTime >= b.departure.dateTime
      )
        fail("returned an inconsistent connection");
    }
    const fareIds = new Set<string>();
    for (const fare of f.fareOffers) {
      if (
        fareIds.has(fare.boundId) ||
        fare.availableSeats < q.pax ||
        fare.fareInformation.length !== ids.length ||
        fare.fareInformation.some((x) => !ids.includes(x.flightId)) ||
        new Set(fare.fareInformation.map((x) => x.flightId)).size !== ids.length
      )
        fail("returned incomplete or contradictory fare availability");
      fareIds.add(fare.boundId);
    }
  }
  return parsed.data!;
}

export function parseQatarNative(
  input: unknown,
  q: SearchQuery,
  observedAt: string,
): AwardResult[] {
  const decoded = qatarPayloadSchema.safeParse(input);
  if (!decoded.success) fail("returned an incomplete cabin-search payload");
  const payload = decoded.data!,
    rows = new Map<string, AwardResult>();
  for (const [index, search] of payload.searches.entries()) {
    validateQatarRequest(
      search.request,
      q,
      index === 0 ? "ECONOMY" : "PREMIUM",
    );
    const data = validateQatarFlights(search.response, q);
    for (const f of data.flightOffers) {
      const key = qatarFlightKey(f);
      const row: AwardResult = rows.get(key) ?? {
        id: `qatar-${hash(key)}`,
        programId: "QR_PRIVILEGE",
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        kind: "flight",
        duration: f.duration / 60,
        segments: f.segments.map((s) => ({
          origin: s.departure.origin.iataCode,
          destination: s.arrival.destination.iataCode,
          departure: s.departure.dateTime,
          arrival: s.arrival.dateTime,
          airline: s.flightNumber.slice(0, 2),
          flightNumber: s.flightNumber,
          operatedBy: s.operatingAirlineName,
          aircraft: s.vehicle.name,
        })),
        prices: {},
        fares: [],
        source: "Qatar Airways Privilege Club · native member search",
        freshness: "live",
        observedAt,
        bookingUrl: qatarBookingUrl(q),
      };
      for (const a of f.fareOffers) {
        // The source includes cross-cabin data. Use each cabin's own latest
        // search so a withdrawn premium fare in the earlier view cannot linger.
        if ((index === 0) !== (a.cabinType === "ECONOMY")) continue;
        const cabin = cabins[a.cabinType];
        if (CABIN_ORDER.indexOf(cabin) < CABIN_ORDER.indexOf(q.minCabin))
          continue;
        const fare: AwardPrice = {
          fareId: hash([
            key,
            a.cabinType,
            a.cabinOfferType,
            a.isFlexiFare,
            a.fareInformation.map((x) => x.isFlexiFare),
            a.privilegePickIndicator,
            a.price.base,
          ]),
          fareName: `${a.cabinType === "ECONOMY" ? "Economy" : a.cabinType === "BUSINESS" ? "Business" : "First"}${a.isFlexiFare ? " · Flexi" : ""}${a.privilegePickIndicator ? " · Privilege Pick" : ""}`,
          cabin,
          points: a.price.base / q.pax,
          partyPoints: a.price.base,
          quotedPassengers: q.pax,
          cash: null,
          currency: null,
          seats: a.availableSeats,
          seatCountLabel:
            a.availableSeats === 9 ? "9 seats reported" : undefined,
          mixedCabin: a.cabinOfferType === "MIXED",
          cabinUnconfirmed: f.segments.length > 1,
          segmentCabins: f.segments.map(() =>
            f.segments.length === 1 ? cabin : null,
          ),
          eligibility: {
            type: "account",
            label: "Member-account quote",
            description:
              "Observed through PointSnap’s authorized Privilege Club member session. Confirm pricing and eligibility with Qatar before transferring points.",
          },
          bookingNotes: [
            "Taxes, fees and surcharges are not supplied in this flight quote; confirm them with Qatar before booking.",
            ...(f.segments.length > 1
              ? ["Individual segment cabins have not been confirmed."]
              : []),
            ...(cabin === "J" && f.segments.some((s) => s.qSuiteEquipped)
              ? [
                  "Qsuite is indicated by Qatar; aircraft substitutions can change the seat product.",
                ]
              : []),
          ],
        };
        const existing = row.fares!.findIndex((x) => x.fareId === fare.fareId);
        if (existing >= 0) row.fares![existing] = fare;
        else row.fares!.push(fare);
      }
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .filter((r) => r.fares!.length)
    .map((r) => {
      for (const f of r.fares!)
        if (!r.prices[f.cabin] || f.points < r.prices[f.cabin]!.points)
          r.prices[f.cabin] = f;
      return r;
    });
}
