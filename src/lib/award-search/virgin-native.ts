import { createHash } from "node:crypto";
import { z } from "zod";
import { CABIN_ORDER, type Cabin, type SearchQuery } from "@/lib/types";
import { ProviderError, type AwardPrice, type AwardResult } from "./types";

const airport = z.string().regex(/^[A-Z]{3}$/);
const place = z.object({ code: airport });
const carrier = z.object({
  code: z.string().regex(/^[A-Z0-9]{2}$/),
  name: z.string(),
});
const localTime = z.iso.datetime({ local: true });
const duration = z.string().regex(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?$/);
const segment = z.object({
  airline: carrier,
  operatingAirline: carrier,
  flightNumber: z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/),
  operatingFlightNumber: z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/),
  origin: place,
  destination: place,
  departure: localTime,
  arrival: localTime,
  duration,
  connection: duration.nullable(),
  pendingGovtApproval: z.boolean(),
  // Fail visibly on an unverified same-flight-stop shape instead of hiding it.
  stopCount: z.literal(0),
  metal: z.array(z.object({ name: z.string() })).min(1),
  legs: z
    .array(
      z.object({
        origin: place,
        destination: place,
        departure: localTime,
        arrival: localTime,
        duration,
        isDominantLeg: z.boolean(),
      }),
    )
    .length(1),
});
const fareFamily = z.enum([
  "AWARD-ECONOMY",
  "AWARD-COMFORT-PLUS-PREMIUM-ECONOMY",
  "AWARD-BUSINESS-FIRST",
]);
const cabinNames = z.enum(["Economy Classic", "Premium", "Upper Class"]);
const fare = z.object({
  availability: z.enum(["SOLD_OUT"]).nullable(),
  available: z.boolean().nullable(),
  fareFamilyType: fareFamily,
  isSaverFare: z.boolean(),
  promoCodeApplied: z.boolean().nullable(),
  price: z
    .object({
      awardPoints: z.string().regex(/^\d+$/),
      amountIncludingTax: z.number().finite().nonnegative(),
      tax: z.number().finite().nonnegative(),
      amount: z.literal(0),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .nullable(),
  fareSegments: z
    .array(
      z.object({
        cabinName: cabinNames,
        bookingClass: z.string(),
        isDominantLeg: z.boolean(),
        isSaverFare: z.boolean(),
      }),
    )
    .nullable(),
});
const flightAndFares = z.object({
  flight: z.object({
    origin: place,
    destination: place,
    departure: localTime,
    arrival: localTime,
    duration,
    segments: z.array(segment).min(1),
  }),
  fares: z.array(fare).min(1),
});
/** Inventory-only boundary: no basket, customer, fare-selection or authentication identifiers. */
export const virginResultSchema = z.object({
  slices: z.object({ current: z.literal(0), total: z.literal(1) }),
  criteria: z.object({
    origin: place,
    destination: place,
    departing: z.iso.date(),
  }),
  slice: z.object({ flightsAndFares: z.array(flightAndFares) }),
});
export const virginRequestSchema = z.object({
  flightSearchRequest: z.object({
    searchOriginDestinations: z
      .array(
        z.object({
          origin: airport,
          destination: airport,
          departureDate: z.iso.date(),
        }),
      )
      .length(1),
    awardSearch: z.literal(true),
    bundleOffer: z.literal(false),
    calendarSearch: z.literal(false),
    flexiDateSearch: z.literal(false),
    nonStopOnly: z.literal(false),
    refundableOnly: z.literal(false),
    checkInBaggageAllowance: z.literal(false),
    carryOnBaggageAllowance: z.literal(false),
  }),
  customerDetails: z
    .array(z.object({ ptc: z.literal("ADT") }))
    .min(1)
    .max(9),
});
export const virginPayloadSchema = z.object({
  type: z.literal("virgin-member-awards"),
  request: virginRequestSchema,
  result: virginResultSchema,
});
export type VirginPayload = z.infer<typeof virginPayloadSchema>;
export type VirginFlight = z.infer<typeof flightAndFares>;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24);
const familyCabin: Record<z.infer<typeof fareFamily>, Cabin> = {
  "AWARD-ECONOMY": "Y",
  "AWARD-COMFORT-PLUS-PREMIUM-ECONOMY": "W",
  "AWARD-BUSINESS-FIRST": "J",
};
const namedCabin: Record<z.infer<typeof cabinNames>, Cabin> = {
  "Economy Classic": "Y",
  Premium: "W",
  "Upper Class": "J",
};
const familyName: Record<z.infer<typeof fareFamily>, string> = {
  "AWARD-ECONOMY": "Economy Classic",
  "AWARD-COMFORT-PLUS-PREMIUM-ECONOMY": "Premium",
  "AWARD-BUSINESS-FIRST": "Upper Class",
};
function fail(detail: string): never {
  throw new ProviderError(
    `Virgin Atlantic ${detail}. Complete native award results could not be confirmed.`,
  );
}
export function virginMinutes(value: string): number {
  const m = value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?$/);
  const n = m
    ? Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
    : 0;
  if (!n) fail("returned an invalid duration");
  return n;
}
export function virginBookingUrl(q: SearchQuery) {
  const u = new URL(
    "https://www.virginatlantic.com/en-US/flights/search/slice",
  );
  u.search = new URLSearchParams({
    passengers: `a${q.pax}t0c0i0`,
    origin: q.origin,
    destination: q.dest,
    departing: q.departDate,
    awardSearch: "true",
  }).toString();
  return u.href;
}
export const virginFlightKey = (f: VirginFlight) =>
  f.flight.segments
    .map((s) =>
      [
        s.flightNumber,
        s.operatingFlightNumber,
        s.origin.code,
        s.destination.code,
        s.departure,
        s.arrival,
      ].join("|"),
    )
    .join(";");

export function virginFlights(input: unknown, q: SearchQuery): VirginPayload {
  const parsed = virginPayloadSchema.safeParse(input);
  if (!parsed.success)
    fail("returned a changed flight, cabin, stop or fare format");
  const p = parsed.data,
    r = p.request.flightSearchRequest.searchOriginDestinations[0];
  if (
    q.returnDate ||
    r.origin !== q.origin ||
    r.destination !== q.dest ||
    r.departureDate !== q.departDate ||
    p.request.customerDetails.length !== q.pax ||
    p.result.criteria.origin.code !== q.origin ||
    p.result.criteria.destination.code !== q.dest ||
    p.result.criteria.departing !== q.departDate
  )
    fail("returned a different route, date or passenger count");
  if (!p.result.slice.flightsAndFares.length)
    fail("did not supply a verified flight-result set");
  const seen = new Set<string>();
  for (const f of p.result.slice.flightsAndFares) {
    const ss = f.flight.segments,
      first = ss[0],
      last = ss.at(-1)!;
    const key = virginFlightKey(f);
    if (seen.has(key)) fail("returned duplicate flight combinations");
    seen.add(key);
    if (
      f.flight.origin.code !== q.origin ||
      f.flight.destination.code !== q.dest ||
      first.origin.code !== q.origin ||
      last.destination.code !== q.dest ||
      first.departure !== f.flight.departure ||
      last.arrival !== f.flight.arrival ||
      first.departure.slice(0, 10) !== q.departDate ||
      ss.some(
        (s, i) =>
          (i > 0 && ss[i - 1].destination.code !== s.origin.code) ||
          s.legs[0].origin.code !== s.origin.code ||
          s.legs[0].destination.code !== s.destination.code ||
          s.legs[0].departure !== s.departure ||
          s.legs[0].arrival !== s.arrival ||
          (i < ss.length - 1 ? !s.connection : s.connection !== null),
      )
    )
      fail("returned an incomplete or inconsistent itinerary");
    const total = ss.reduce(
      (n, s) =>
        n +
        virginMinutes(s.duration) +
        (s.connection ? virginMinutes(s.connection) : 0),
      0,
    );
    if (total !== virginMinutes(f.flight.duration))
      fail("returned inconsistent connection durations");
    const families = new Set<string>();
    for (const a of f.fares) {
      if (families.has(a.fareFamilyType))
        fail("returned repeated cabin offers");
      families.add(a.fareFamilyType);
      if (a.availability === "SOLD_OUT") {
        if (a.price !== null || a.fareSegments !== null)
          fail("returned contradictory sold-out pricing");
        continue;
      }
      if (
        a.available === false ||
        !a.price ||
        !a.fareSegments ||
        a.fareSegments.length !== ss.length ||
        !Number.isSafeInteger(Number(a.price.awardPoints)) ||
        Number(a.price.awardPoints) <= 0 ||
        Math.abs(a.price.amountIncludingTax - a.price.tax) > 0.001 ||
        a.fareSegments.filter((s) => s.isDominantLeg).length !== 1
      )
        fail("returned incomplete or contradictory fare details");
      const dominant = a.fareSegments.find((s) => s.isDominantLeg)!;
      if (namedCabin[dominant.cabinName] !== familyCabin[a.fareFamilyType])
        fail("returned an ambiguous main-flight cabin");
    }
  }
  return p;
}

export function parseVirginNative(
  input: unknown,
  q: SearchQuery,
  observedAt: string,
): AwardResult[] {
  const p = virginFlights(input, q);
  return p.result.slice.flightsAndFares.flatMap((f) => {
    const fares: AwardPrice[] = f.fares
      .flatMap((a) => {
        if (a.availability === "SOLD_OUT") return [];
        const price = a.price!,
          fs = a.fareSegments!,
          cabin = familyCabin[a.fareFamilyType];
        const segmentCabins = fs.map((s) => namedCabin[s.cabinName]);
        return [
          {
            fareId: hash([virginFlightKey(f), a.fareFamilyType, price]),
            fareName: `${familyName[a.fareFamilyType]}${a.isSaverFare ? " · Saver" : ""}`,
            cabin,
            segmentCabins,
            bookingClasses: fs.map((s) => s.bookingClass),
            mixedCabin: new Set(segmentCabins).size > 1,
            points: Number(price.awardPoints) / q.pax,
            partyPoints: Number(price.awardPoints),
            quotedPassengers: q.pax,
            cash: price.amountIncludingTax / q.pax,
            currency: price.currency,
            seats: null,
            refundable: null,
            eligibility: {
              type: "account" as const,
              label: "Member-account quote",
              description:
                "Observed through PointSnap’s authorized Flying Club member session. Confirm the final price and your eligibility with Virgin Atlantic before transferring points.",
            },
            bookingNotes: [
              ...(a.promoCodeApplied
                ? ["A promotion was applied to this member quote."]
                : []),
              ...(f.flight.segments.some((s) => s.pendingGovtApproval)
                ? ["An operating segment is pending government approval."]
                : []),
            ],
          },
        ];
      })
      .filter(
        (a) => CABIN_ORDER.indexOf(a.cabin) >= CABIN_ORDER.indexOf(q.minCabin),
      );
    if (!fares.length) return [];
    const prices: AwardResult["prices"] = {};
    for (const a of fares)
      if (!prices[a.cabin] || a.points < prices[a.cabin]!.points)
        prices[a.cabin] = a;
    return [
      {
        id: `virgin-${hash(virginFlightKey(f))}`,
        programId: "VS_FLYING_CLUB",
        kind: "flight" as const,
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        segments: f.flight.segments.map((s) => ({
          origin: s.origin.code,
          destination: s.destination.code,
          departure: s.departure,
          arrival: s.arrival,
          airline: s.airline.code,
          airlineName: s.airline.name,
          flightNumber: s.flightNumber,
          operatingAirline: s.operatingAirline.code,
          operatedBy: s.operatingAirline.name,
          operatingFlightNumber: s.operatingFlightNumber,
          aircraft: s.metal.map((m) => m.name).join(" / "),
        })),
        duration: virginMinutes(f.flight.duration),
        fares,
        prices,
        source: "Virgin Atlantic Flying Club · direct airline · member quote",
        freshness: "live" as const,
        observedAt,
        bookingUrl: virginBookingUrl(q),
      },
    ];
  });
}
