import { z } from "zod";
import type { AwardResult, AwardPrice } from "./award-search/types";
import { pointsForParty } from "./award-search/value";
const text = z.string().max(500);
const code = z.string().regex(/^[A-Z]{3}$/);
const url = z
  .url()
  .max(3000)
  .refine((value) => {
    const u = new URL(value);
    return u.protocol === "https:";
  }, "Booking links must use HTTPS.");
const price = z.object({
  cabin: z.enum(["Y", "W", "J", "F"]),
  points: z.number().int().nonnegative().max(2e9),
  cash: z.number().nonnegative().max(1e8).nullable(),
  currency: code.nullable(),
  fareName: text.nullable(),
  mixedCabin: z.boolean(),
  cabinUnconfirmed: z.boolean(),
  feesIncludedInPoints: z.boolean(),
  refundable: z.boolean().nullable(),
  seats: z.number().int().nonnegative().nullable(),
  eligibility: z
    .object({ label: text, description: z.string().max(2000) })
    .nullable(),
  notes: z.array(z.string().max(2000)).max(30),
});
export const savedFlightSchema = z.object({
  key: z.string().min(1).max(500),
  programId: z.string().min(1).max(64),
  origin: code,
  destination: code,
  date: z.iso.date(),
  pax: z.number().int().min(1).max(9),
  price,
  partyPoints: z.number().int().nonnegative().max(18e9),
  duration: z.number().nonnegative().nullable(),
  observedAt: z.iso.datetime({ offset: true }),
  source: text,
  bookingUrl: url.nullable(),
  segments: z
    .array(
      z.object({
        origin: code,
        destination: code,
        departure: text.nullable(),
        arrival: text.nullable(),
        flightNumber: text,
        airline: text,
        aircraft: text.nullable(),
      }),
    )
    .min(1)
    .max(20),
});
export type SavedFlight = z.infer<typeof savedFlightSchema>;
export type TripLeg = "outbound" | "return" | "alternative";
export interface TripFlight {
  id: string;
  trip_id: string;
  leg: TripLeg;
  snapshot: SavedFlight;
  created_at: string;
}
export interface Trip {
  id: string;
  name: string;
  created_at: string;
}
export interface TripData {
  owner: string | null;
  trips: Trip[];
  flights: TripFlight[];
}
export const tripAction = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      tripId: z.uuid().optional(),
      name: z.string().trim().min(1).max(80).optional(),
      leg: z.enum(["outbound", "return", "alternative"]),
      snapshot: savedFlightSchema,
    })
    .refine((v) => v.tripId || v.name, "Choose or name a trip."),
  z.object({
    action: z.literal("rename"),
    tripId: z.uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  z.object({ action: z.literal("removeFlight"), id: z.uuid() }),
  z.object({ action: z.literal("removeTrip"), id: z.uuid() }),
]);
export function flightSnapshot(
  row: AwardResult,
  p: AwardPrice,
  pax: number,
): SavedFlight {
  return savedFlightSchema.parse({
    key: `${row.programId}:${row.id}:${p.fareId ?? p.cabin + ":" + p.points + ":" + p.cash}`,
    programId: row.programId,
    origin: row.origin,
    destination: row.destination,
    date: row.date,
    pax,
    partyPoints: pointsForParty(p, pax),
    duration: row.duration,
    observedAt: row.observedAt,
    source: row.source,
    price: {
      cabin: p.cabin,
      points: p.points,
      cash: p.cash,
      currency: p.currency,
      fareName: p.fareName ?? null,
      mixedCabin: p.mixedCabin,
      cabinUnconfirmed: !!p.cabinUnconfirmed,
      feesIncludedInPoints: !!p.feesIncludedInPoints,
      refundable: p.refundable ?? null,
      seats: p.seats,
      eligibility: p.eligibility ?? null,
      notes: p.bookingNotes ?? [],
    },
    bookingUrl: /^https:\/\//.test(row.bookingUrl) ? row.bookingUrl : null,
    segments: row.segments.map((s) => ({
      origin: s.origin,
      destination: s.destination,
      departure: s.departure,
      arrival: s.arrival,
      flightNumber: s.flightNumber,
      airline: s.airlineName ?? s.airline,
      aircraft: s.aircraft ?? null,
    })),
  });
}
