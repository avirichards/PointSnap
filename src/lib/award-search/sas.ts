import { createHash } from "node:crypto";
import { z } from "zod";
import type { Cabin, SearchQuery } from "@/lib/types";
import { sasBookingUrl } from "@/lib/bookingHandoff";
import {
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

const code = z.string().regex(/^[A-Z]{3}$/);
const integer = z.number().int().nonnegative();
const amount = z.number().finite().nonnegative();
const time = z.iso.datetime({ offset: true });
const named = z.object({ code: z.string().min(1), name: z.string() });
const duration = z.string().regex(/^\d{2,3}:[0-5]\d:00$/);
const price = z.object({
  currency: code,
  totalTax: amount,
  totalPrice: amount,
  points: integer,
  pointsAfterDiscount: integer,
  discountedPoints: z.literal(0),
  credits: z.literal(0),
});
const product = z.object({
  productName: z.string().min(1),
  productCode: z.string().min(1),
  isStandardAward: z.boolean().optional(),
  price: price.extend({
    pricePerPassengerType: z
      .array(
        z.object({
          type: z.literal("ADT"),
          numberCount: integer.positive(),
          price,
        }),
      )
      .length(1),
  }),
  fares: z
    .array(
      z.object({
        segmentId: z.string(),
        fareClass: z.string(),
        bookingClass: z.string().min(1),
        avlSeats: integer,
        cabinClass: z.string().min(1),
      }),
    )
    .min(1),
});
const flight = z.object({
  id: integer,
  origin: named,
  destination: named,
  connectionDuration: duration,
  startTimeInLocal: time,
  startTimeInGmt: time,
  endTimeInLocal: time,
  endTimeInGmt: time,
  stops: integer,
  segments: z
    .array(
      z.object({
        id: integer,
        departureDateTimeInLocal: time,
        departureDateTimeInGmt: time,
        arrivalDateTimeInLocal: time,
        arrivalDateTimeInGmt: time,
        departureAirport: named,
        arrivalAirport: named,
        airCraft: named,
        flightNumber: z.string().regex(/^\d{1,4}$/),
        duration,
        marketingCarrier: named,
        operatingCarrier: named.optional(),
        numberOfStops: integer,
      }),
    )
    .min(1),
  cabins: z.record(
    z.string(),
    z.record(z.string(), z.object({ products: z.record(z.string(), product) })),
  ),
});
/** An allowlist of inventory fields; never persist offer tokens, sessions or account metadata. */
export const sasResponseSchema = z.object({
  bookingFlow: z.literal("POINTS"),
  tripType: z.literal("O"),
  currency: z.object({ code }),
  outboundFlights: z.record(z.string(), flight),
});
export const sasRequestSchema = z.object({
  from: code,
  to: code,
  outDate: z.string().regex(/^\d{8}$/),
  adt: z.string(),
  chd: z.literal("0"),
  inf: z.literal("0"),
  yth: z.literal("0"),
  bookingFlow: z.literal("points"),
  pos: z.string().regex(/^[a-z]{2}$/),
  channel: z.literal("web"),
  displayType: z.literal("upsell"),
});
export const sasPayloadSchema = z.object({
  type: z.literal("sas-points"),
  request: sasRequestSchema,
  response: sasResponseSchema,
});
type Flight = z.infer<typeof flight>;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24);
function invalid(reason: string): never {
  throw new ProviderError(
    `SAS returned ${reason}. Complete award results could not be confirmed.`,
  );
}
const elapsed = (a: string, b: string) =>
  (Date.parse(b) - Date.parse(a)) / 60000;
const mins = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
};
const equalMoney = (a: number, b: number) =>
  Math.round(a * 100) === Math.round(b * 100);
const cabins: Record<string, Cabin> = {
  ECONOMY: "Y",
  PREMIUM: "W",
  BUSINESS: "J",
};
export function validateSasRequest(value: unknown, q: SearchQuery) {
  const p = sasRequestSchema.safeParse(value);
  if (!p.success) invalid("an unsupported search request");
  const r = p.data;
  if (
    r.from !== q.origin ||
    r.to !== q.dest ||
    r.outDate !== q.departDate.replaceAll("-", "") ||
    r.adt !== String(q.pax)
  )
    invalid("a different route, date or party");
  return r;
}
function segments(f: Flight, q: SearchQuery): AwardSegment[] {
  if (
    f.origin.code !== q.origin ||
    f.destination.code !== q.dest ||
    f.startTimeInLocal.slice(0, 10) !== q.departDate ||
    f.segments[0].departureAirport.code !== q.origin ||
    f.segments.at(-1)!.arrivalAirport.code !== q.dest ||
    f.startTimeInLocal !== f.segments[0].departureDateTimeInLocal ||
    f.endTimeInLocal !== f.segments.at(-1)!.arrivalDateTimeInLocal ||
    elapsed(f.startTimeInLocal, f.endTimeInLocal) !==
      mins(f.connectionDuration) ||
    Date.parse(f.startTimeInLocal) !== Date.parse(f.startTimeInGmt) ||
    Date.parse(f.endTimeInLocal) !== Date.parse(f.endTimeInGmt)
  )
    invalid("inconsistent itinerary dates or airports");
  if (
    f.stops !==
    f.segments.length - 1 + f.segments.reduce((n, s) => n + s.numberOfStops, 0)
  )
    invalid("inconsistent stop counts");
  return f.segments.map((s, i) => {
    if (
      Date.parse(s.departureDateTimeInLocal) !==
        Date.parse(s.departureDateTimeInGmt) ||
      Date.parse(s.arrivalDateTimeInLocal) !==
        Date.parse(s.arrivalDateTimeInGmt) ||
      elapsed(s.departureDateTimeInLocal, s.arrivalDateTimeInLocal) !==
        mins(s.duration) ||
      mins(s.duration) <= 0
    )
      invalid("inconsistent segment times");
    const prev = f.segments[i - 1];
    if (
      prev &&
      (prev.arrivalAirport.code !== s.departureAirport.code ||
        elapsed(prev.arrivalDateTimeInLocal, s.departureDateTimeInLocal) < 0)
    )
      invalid("inconsistent connections");
    // Same-flight stop locations have not been verified in this response format.
    if (s.numberOfStops)
      invalid("same-flight stops without verified stop details");
    return {
      origin: s.departureAirport.code,
      destination: s.arrivalAirport.code,
      departure: s.departureDateTimeInLocal,
      arrival: s.arrivalDateTimeInLocal,
      airline: s.marketingCarrier.code,
      airlineName: s.marketingCarrier.name,
      flightNumber: s.marketingCarrier.code + s.flightNumber,
      operatingAirline: (s.operatingCarrier ?? s.marketingCarrier).code,
      operatedBy: (s.operatingCarrier ?? s.marketingCarrier).name,
      aircraft: s.airCraft.name,
      cabin: null,
    };
  });
}
export function sasObservationCounts(value: unknown) {
  const flights = Object.values(sasResponseSchema.parse(value).outboundFlights);
  return {
    itineraries: flights.length,
    fares: flights.reduce(
      (n, f) =>
        n +
        Object.values(f.cabins).reduce(
          (m, c) =>
            m +
            Object.values(c).reduce(
              (k, v) => k + Object.keys(v.products).length,
              0,
            ),
          0,
        ),
      0,
    ),
  };
}
export function parseSas(
  value: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const parsed = sasPayloadSchema.safeParse(value);
  if (!parsed.success) invalid("an unsupported flight or price response");
  const p = parsed.data;
  validateSasRequest(p.request, q);
  const flights = Object.values(p.response.outboundFlights);
  if (!flights.length)
    invalid("an empty response without verified availability status");
  const seen = new Set<string>();
  return flights.map((f) => {
    const route = segments(f, q),
      key = hash(route);
    if (seen.has(key)) invalid("duplicate itineraries");
    seen.add(key);
    const row: AwardResult = {
      id: "SK_" + key,
      programId: "SK_EUROBONUS",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments: route,
      duration: mins(f.connectionDuration),
      prices: {},
      fares: [],
      source: "SAS EuroBonus · airline browser",
      freshness: "live",
      observedAt,
      bookingUrl: sasBookingUrl(q),
    };
    for (const [group, families] of Object.entries(f.cabins)) {
      const cabin = cabins[group];
      if (!cabin) invalid("an unknown cabin");
      for (const [name, family] of Object.entries(families))
        for (const prod of Object.values(family.products)) {
          const total = prod.price,
            adult = total.pricePerPassengerType[0],
            single = adult.price;
          if (
            prod.productName !== name ||
            adult.numberCount !== q.pax ||
            single.currency !== p.response.currency.code ||
            total.currency !== single.currency ||
            single.points <= 0 ||
            single.pointsAfterDiscount !== single.points ||
            total.pointsAfterDiscount !== total.points ||
            total.points !== single.points * q.pax ||
            !equalMoney(total.totalTax, single.totalTax * q.pax) ||
            !equalMoney(total.totalPrice, single.totalPrice * q.pax) ||
            prod.fares.length !== route.length
          )
            invalid("inconsistent fare or passenger totals");
          const parts = f.segments.map((s) =>
            prod.fares.filter((x) => x.segmentId === String(s.id)),
          );
          if (
            parts.some((a) => a.length !== 1) ||
            parts.some((a) => a[0].avlSeats < q.pax)
          )
            invalid("incomplete segment availability");
          // Y means SAS Plus/Premium internally, and European Business uses it too.
          // A single segment is confirmed by its marketed cabin. Multi-leg Y codes remain unknown.
          const segmentCabins: (Cabin | null)[] = parts.map((a) =>
            route.length === 1
              ? cabin
              : a[0].cabinClass === "M"
                ? "Y"
                : a[0].cabinClass === "C"
                  ? "J"
                  : null,
          );
          const seats = Math.min(...parts.map((a) => a[0].avlSeats));
          const fare: AwardPrice = {
            fareId:
              "SK_" +
              hash([
                key,
                group,
                prod.productCode,
                prod.fares,
                single.points,
                single.totalTax,
              ]),
            fareName: name,
            cabin,
            points: single.points,
            partyPoints: total.points,
            quotedPassengers: q.pax,
            cash: single.totalTax,
            currency: single.currency,
            seats,
            seatCountLabel: `${seats} seats reported`,
            bookingClasses: parts.map((a) => a[0].bookingClass),
            segmentCabins,
            cabinUnconfirmed: segmentCabins.includes(null),
            mixedCabin: new Set(segmentCabins.filter(Boolean)).size > 1,
            refundable: null,
            bookingNotes: [
              prod.isStandardAward
                ? "SAS Bonus award"
                : "Regular SAS flight paid with EuroBonus points",
            ],
          };
          // totalPrice on regular points offers is a cash reference, not the award copayment.
          // Only totalTax was verified against SAS's selected-trip points cart.
          row.fares!.push(fare);
          const best = row.prices[cabin];
          if (
            !best ||
            fare.points < best.points ||
            (fare.points === best.points && fare.cash! < best.cash!)
          )
            row.prices[cabin] = fare;
        }
    }
    if (!row.fares!.length)
      invalid("an itinerary without available fare choices");
    return row;
  });
}
