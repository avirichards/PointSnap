import { createHash } from "node:crypto";
import { z } from "zod";
import type { SearchQuery } from "@/lib/types";
import { southwestBookingUrl } from "@/lib/bookingHandoff";
import {
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

const airport = z.string().regex(/^[A-Z]{3}$/);
const integer = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
const flightNumber = z.string().regex(/^\d{1,4}$/);
const money = z.object({
  currencyCode: z.string().regex(/^(?:[A-Z]{3}|POINTS)$/),
  value: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
});
const cabinInfo = z.array(z.object({ cabin: z.literal("ECO") })).min(1);
const fare = z.discriminatedUnion("availabilityStatus", [
  z.object({
    availabilityStatus: z.literal("AVAILABLE"),
    passengerType: z.literal("ADULT"),
    cabinInfo,
    fare: z.object({
      baseFare: money,
      totalFare: money,
      totalTaxesAndFees: money,
      fareType: z.literal("NONDISCOUNT"),
    }),
  }),
  z.object({
    availabilityStatus: z.literal("UNAVAILABLE"),
    passengerType: z.literal("ADULT"),
    cabinInfo,
  }),
]);
const leg = z.object({
  originationAirportCode: airport,
  destinationAirportCode: airport,
  departureDateTime: timestamp,
  arrivalDateTime: timestamp,
  flightNumber,
  legDuration: integer,
  stopDuration: integer,
  changePlanes: z.boolean(),
});
const segment = z.object({
  originationAirportCode: airport,
  destinationAirportCode: airport,
  departureDateTime: timestamp,
  arrivalDateTime: timestamp,
  flightNumber,
  marketingCarrierCode: z.string().regex(/^[A-Z0-9]{2}$/),
  operatingCarrierCode: z.string().regex(/^[A-Z0-9]{2}$/),
  duration: z.string().regex(/^\d{2,3}:[0-5]\d$/),
  numberOfStops: integer,
  aircraftEquipmentType: z.string().min(1),
  stopsDetails: z.array(leg).min(1),
});
const detail = z.object({
  originationAirportCode: airport,
  destinationAirportCode: airport,
  departureDateTime: timestamp,
  arrivalDateTime: timestamp,
  totalDuration: integer.positive(),
  flightNumbers: z.array(flightNumber).min(1),
  segments: z.array(segment).min(1),
  fareProducts: z.object({ ADULT: z.record(z.string(), fare) }).strict(),
});
/** Keep only flight and price evidence, never selection tokens or account metadata. */
export const southwestResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    searchResults: z.object({
      airProducts: z
        .array(
          z.object({
            originationAirportCode: airport,
            destinationAirportCode: airport,
            details: z.array(detail).min(1),
          }),
        )
        .length(1),
    }),
  }),
});
export const southwestRequestSchema = z.object({
  adultPassengersCount: z.string(),
  adultsCount: z.string(),
  departureDate: z.string(),
  departureTimeOfDay: z.literal("ALL_DAY"),
  destinationAirportCode: airport,
  fareType: z.enum(["POINTS", "USD"]),
  lapInfantPassengersCount: z.literal("0"),
  olderChildCount: z.literal("0"),
  originationAirportCode: airport,
  passengerType: z.literal("ADULT"),
  promoCode: z.literal(""),
  returnAirportCode: z.literal(""),
  returnDate: z.literal(""),
  returnTimeOfDay: z.literal("ALL_DAY"),
  teensCount: z.literal("0"),
  tripType: z.literal("oneway"),
  youngerChildCount: z.literal("0"),
});
const observation = z.object({
  request: southwestRequestSchema,
  response: southwestResponseSchema,
  observedAt: timestamp,
});
export const southwestPayloadSchema = z.object({
  type: z.literal("southwest-points-cash"),
  points: observation,
  cash: observation.optional(),
});
type Observation = z.infer<typeof observation>;
type Detail = z.infer<typeof detail>;
export const SOUTHWEST_FAMILIES: Record<string, string> = {
  WGA: "Basic",
  PLU: "Choice",
  ANY: "Choice Preferred",
  BUS: "Choice Extra",
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24);
function invalid(reason: string): never {
  throw new ProviderError(
    `Southwest returned ${reason}. Complete award results could not be confirmed.`,
  );
}
const minutes = (start: string, end: string) =>
  (Date.parse(end) - Date.parse(start)) / 60000;

export function validateSouthwestRequest(
  value: unknown,
  q: SearchQuery,
  currency: "POINTS" | "USD",
) {
  const parsed = southwestRequestSchema.safeParse(value);
  if (!parsed.success) invalid("an unsupported search request");
  const r = parsed.data;
  if (
    r.adultPassengersCount !== String(q.pax) ||
    r.adultsCount !== String(q.pax) ||
    r.originationAirportCode !== q.origin ||
    r.destinationAirportCode !== q.dest ||
    r.departureDate !== q.departDate ||
    r.fareType !== currency
  )
    invalid("a different route, date, party or currency");
  return r;
}
function itineraryKey(d: Detail) {
  return hash(
    d.segments.map((s) => [
      s.marketingCarrierCode,
      s.operatingCarrierCode,
      s.flightNumber,
      s.originationAirportCode,
      s.destinationAirportCode,
      s.departureDateTime,
      s.arrivalDateTime,
    ]),
  );
}
function readSegments(d: Detail, q: SearchQuery): AwardSegment[] {
  if (
    d.originationAirportCode !== q.origin ||
    d.destinationAirportCode !== q.dest ||
    d.departureDateTime.slice(0, 10) !== q.departDate ||
    d.flightNumbers.join(",") !==
      d.segments.map((s) => s.flightNumber).join(",") ||
    d.departureDateTime !== d.segments[0].departureDateTime ||
    d.arrivalDateTime !== d.segments.at(-1)!.arrivalDateTime ||
    d.segments[0].originationAirportCode !== q.origin ||
    d.segments.at(-1)!.destinationAirportCode !== q.dest ||
    minutes(d.departureDateTime, d.arrivalDateTime) !== d.totalDuration
  )
    invalid("inconsistent itinerary details");
  return d.segments.map((s, index) => {
    const [hours, mins] = s.duration.split(":").map(Number);
    const legs = s.stopsDetails;
    if (
      minutes(s.departureDateTime, s.arrivalDateTime) !== hours * 60 + mins ||
      s.numberOfStops !== legs.length - 1 ||
      legs[0].originationAirportCode !== s.originationAirportCode ||
      legs.at(-1)!.destinationAirportCode !== s.destinationAirportCode ||
      legs[0].departureDateTime !== s.departureDateTime ||
      legs.at(-1)!.arrivalDateTime !== s.arrivalDateTime
    )
      invalid("inconsistent flight durations or stops");
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i],
        next = legs[i + 1];
      if (
        l.flightNumber !== s.flightNumber ||
        minutes(l.departureDateTime, l.arrivalDateTime) !== l.legDuration ||
        l.legDuration <= 0 ||
        (next &&
          (l.changePlanes ||
            l.destinationAirportCode !== next.originationAirportCode ||
            minutes(l.arrivalDateTime, next.departureDateTime) !==
              l.stopDuration))
      )
        invalid("inconsistent same-flight stop details");
    }
    const nextSegment = d.segments[index + 1],
      lastLeg = legs.at(-1)!;
    if (
      nextSegment
        ? !lastLeg.changePlanes ||
          s.destinationAirportCode !== nextSegment.originationAirportCode ||
          minutes(s.arrivalDateTime, nextSegment.departureDateTime) !==
            lastLeg.stopDuration
        : lastLeg.changePlanes || lastLeg.stopDuration !== 0
    )
      invalid("inconsistent connections");
    return {
      origin: s.originationAirportCode,
      destination: s.destinationAirportCode,
      departure: s.departureDateTime,
      arrival: s.arrivalDateTime,
      airline: s.marketingCarrierCode,
      airlineName:
        s.marketingCarrierCode === "WN"
          ? "Southwest Airlines"
          : s.marketingCarrierCode,
      operatingAirline: s.operatingCarrierCode,
      flightNumber: s.marketingCarrierCode + s.flightNumber,
      aircraft: s.aircraftEquipmentType,
      cabin: "Y",
      technicalStops: legs.slice(0, -1).map((l, i) => ({
        airport: l.destinationAirportCode,
        arrival: l.arrivalDateTime,
        departure: legs[i + 1].departureDateTime,
        duration: l.stopDuration,
      })),
    };
  });
}
function validateObservation(
  o: Observation,
  q: SearchQuery,
  currency: "POINTS" | "USD",
) {
  validateSouthwestRequest(o.request, q, currency);
  const p = o.response.data.searchResults.airProducts[0];
  if (
    p.originationAirportCode !== q.origin ||
    p.destinationAirportCode !== q.dest
  )
    invalid("a different airport group");
  const seen = new Set<string>();
  const expected = Object.keys(SOUTHWEST_FAMILIES)
    .map((k) => k + (currency === "POINTS" ? "RED" : ""))
    .sort()
    .join(",");
  for (const d of p.details) {
    readSegments(d, q);
    const key = itineraryKey(d);
    if (seen.has(key)) invalid("duplicate flight itineraries");
    seen.add(key);
    if (Object.keys(d.fareProducts.ADULT).sort().join(",") !== expected)
      invalid("a missing or unknown fare family");
    for (const f of Object.values(d.fareProducts.ADULT)) {
      if (f.cabinInfo.length !== d.segments.length)
        invalid("incomplete segment cabins");
      if (f.availabilityStatus === "UNAVAILABLE") continue;
      const v = f.fare;
      if (
        v.baseFare.currencyCode !== currency ||
        v.totalFare.currencyCode !== currency ||
        v.totalTaxesAndFees.currencyCode !== "USD"
      )
        invalid("unrecognized price units");
      if (
        currency === "POINTS"
          ? !/^\d+$/.test(v.totalFare.value) ||
            Number(v.totalFare.value) <= 0 ||
            v.baseFare.value !== v.totalFare.value
          : Math.round(Number(v.totalFare.value) * 100) !==
            Math.round(
              (Number(v.baseFare.value) + Number(v.totalTaxesAndFees.value)) *
                100,
            )
      )
        invalid("inconsistent fare totals");
    }
  }
  return p.details;
}
export function southwestObservationCounts(value: unknown) {
  const data = southwestResponseSchema.parse(value),
    rows = data.data.searchResults.airProducts[0].details;
  return {
    itineraries: rows.length,
    fares: rows.reduce(
      (n, d) =>
        n +
        Object.values(d.fareProducts.ADULT).filter(
          (f) => f.availabilityStatus === "AVAILABLE",
        ).length,
      0,
    ),
    choices: rows.reduce(
      (n, d) => n + Object.keys(d.fareProducts.ADULT).length,
      0,
    ),
  };
}
export function parseSouthwest(
  value: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const parsed = southwestPayloadSchema.safeParse(value);
  if (!parsed.success) invalid("an incomplete flight or price response");
  const payload = parsed.data;
  const awards = validateObservation(payload.points, q, "POINTS");
  const cash = new Map(
    (payload.cash ? validateObservation(payload.cash, q, "USD") : []).map(
      (d) => [itineraryKey(d), d],
    ),
  );
  return awards.flatMap((d) => {
    const key = itineraryKey(d),
      row: AwardResult = {
        id: "WN_" + key,
        programId: "WN_RAPID_REWARDS",
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        kind: "flight",
        segments: readSegments(d, q),
        duration: d.totalDuration,
        prices: {},
        fares: [],
        source: "Southwest Rapid Rewards · airline browser",
        freshness: "live",
        observedAt,
        bookingUrl: southwestBookingUrl(q),
      };
    for (const [family, f] of Object.entries(d.fareProducts.ADULT)) {
      if (f.availabilityStatus !== "AVAILABLE") continue;
      const cashFamily = family.replace(/RED$/, ""),
        name = SOUTHWEST_FAMILIES[cashFamily],
        cf = cash.get(key)?.fareProducts.ADULT[cashFamily];
      const price: AwardPrice = {
        fareId: "WN_" + hash([key, family]),
        fareName: name,
        cabin: "Y",
        points: Number(f.fare.totalFare.value),
        partyPoints: Number(f.fare.totalFare.value) * q.pax,
        quotedPassengers: q.pax,
        cash: Number(f.fare.totalTaxesAndFees.value),
        currency: f.fare.totalTaxesAndFees.currencyCode,
        seats: null,
        mixedCabin: false,
        segmentCabins: d.segments.map(() => "Y"),
        refundable: null,
      };
      if (cf?.availabilityStatus === "AVAILABLE" && payload.cash)
        price.cashFare = {
          amount: Number(cf.fare.totalFare.value),
          currency: cf.fare.totalFare.currencyCode,
          fareName: name,
          refundable: null,
          observedAt: payload.cash.observedAt,
          bookingUrl: southwestBookingUrl(q, "USD"),
        };
      row.fares!.push(price);
      if (
        !row.prices.Y ||
        price.points < row.prices.Y.points ||
        (price.points === row.prices.Y.points &&
          price.cash! < row.prices.Y.cash!)
      )
        row.prices.Y = price;
    }
    return row.fares!.length ? [row] : [];
  });
}
