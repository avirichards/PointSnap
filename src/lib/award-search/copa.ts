import { createHash } from "node:crypto";
import { z } from "zod";
import type { Cabin, SearchQuery } from "@/lib/types";
import {
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";
const airport = z.string().regex(/^[A-Z]{3}$/);
const date = z.iso.date();
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const integer = z.number().int().nonnegative();
const amount = z.number().finite().nonnegative();
const price = z.object({ miles: integer, taxes: amount });
const endpoint = z.object({
  airportCode: airport,
  flightDate: date,
  flightTime: clock,
});
const carrier = z.object({
  airlineCode: z.string().regex(/^[A-Z0-9]{2,3}$/),
  airlineName: z.string().min(1),
  flightNumber: z.string().regex(/^\d{1,4}$/),
});
const family = z.object({
  code: z.enum(["ESV", "ESD", "BSV", "BSD"]),
  name: z.string().min(1),
  isEconomyBasic: z.literal(false),
});
const offer = z.object({
  pricePerAdult: price,
  totalPrice: price,
  originalPricePerAdult: integer,
  fareFamily: family,
  classOfService: z.array(z.string().min(1)).min(1),
  fareBasisCodes: z.array(z.string().min(1)).min(1),
  promoCodeApplied: z.literal(false),
  conventionCodeFlag: z.literal(false),
});
const segment = z.object({
  departure: endpoint,
  arrival: endpoint,
  marketingCarrier: carrier,
  operatingCarrier: z
    .object({
      airlineCode: carrier.shape.airlineCode.nullable(),
      airlineName: z.string().min(1),
      flightNumber: carrier.shape.flightNumber.nullable(),
    })
    .nullable(),
  aircraftName: z.string().min(1),
  thruFlights: integer,
  stops: z.array(
    z.object({
      airportCode: airport,
      arrivalDate: date,
      arrivalTime: clock,
      departureDate: date,
      departureTime: clock,
    }),
  ),
});
const solution = z.object({
  numberOfLayovers: integer,
  journeyTime: z.string().regex(/^PT\d+H[0-5]?\dM$/),
  flights: z.array(segment).min(1),
  offers: z.array(offer).min(1),
});
/** Allowlist public inventory only: no session, offer references, personal or authentication state. */
export const copaResponseSchema = z
  .array(
    z.object({
      origin: z.object({ code: airport, departureDate: date }),
      destination: z.object({ code: airport }),
      currency: z.object({ code: airport, decimals: integer.max(3) }),
      promoCodeApplied: z.literal(false),
      discountType: z.null(),
      solutions: z.array(solution),
    }),
  )
  .length(1);
export const copaRequestSchema = z.object({
  adults: integer.min(1).max(9),
  children: z.literal(0),
  infants: z.literal(0),
  departureAirport1: airport,
  arrivalAirport1: airport,
  departureDate1: date,
  departureDate2: z.literal(""),
  isRoundTrip: z.literal(false),
  promoCode: z.null(),
  isConventionCode: z.null(),
});
export const copaPayloadSchema = z.object({
  type: z.literal("copa-miles"),
  request: copaRequestSchema,
  response: copaResponseSchema,
});
function invalid(reason: string): never {
  throw new ProviderError(
    `Copa returned ${reason}. Complete award results could not be confirmed.`,
  );
}
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24);
const local = (d: string, t: string) => `${d}T${t}:00`;
// These are local airport clocks, not UTC instants. Only compare intervals at the same airport.
const sameAirportMinutes = (a: string, b: string) =>
  (Date.parse(b + "Z") - Date.parse(a + "Z")) / 60000;
const minutes = (s: string) => {
  const m = s.match(/^PT(\d+)H(\d+)M$/)!;
  return Number(m[1]) * 60 + Number(m[2]);
};
export function validateCopaRequest(value: unknown, q: SearchQuery) {
  const p = copaRequestSchema.safeParse(value);
  if (!p.success) invalid("an unsupported search request");
  if (
    p.data.adults !== q.pax ||
    p.data.departureAirport1 !== q.origin ||
    p.data.arrivalAirport1 !== q.dest ||
    p.data.departureDate1 !== q.departDate
  )
    invalid("a different route, date or party");
  return p.data;
}
export function copaObservationCounts(
  value: unknown,
  q: Pick<SearchQuery, "origin" | "dest">,
) {
  const [r] = copaResponseSchema.parse(value);
  const exact = r.solutions.filter(
    (s) =>
      s.flights[0].departure.airportCode === q.origin &&
      s.flights.at(-1)!.arrival.airportCode === q.dest,
  );
  return {
    itineraries: r.solutions.length,
    fares: r.solutions.reduce((n, s) => n + s.offers.length, 0),
    exactItineraries: exact.length,
    exactFares: exact.reduce((n, s) => n + s.offers.length, 0),
    otherAirportItineraries: r.solutions.length - exact.length,
  };
}
export function parseCopa(
  value: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const parsed = copaPayloadSchema.safeParse(value);
  if (!parsed.success) invalid("an unsupported flight or price format");
  const p = parsed.data;
  validateCopaRequest(p.request, q);
  const [r] = p.response;
  if (
    r.origin.code !== q.origin ||
    r.destination.code !== q.dest ||
    r.origin.departureDate !== q.departDate
  )
    invalid("a response for a different trip");
  if (!r.solutions.length)
    invalid("an empty response without verified availability status");
  const seen = new Set<string>(),
    rows: AwardResult[] = [];
  for (const s of r.solutions) {
    if (
      s.numberOfLayovers !== s.flights.length - 1 ||
      minutes(s.journeyTime) <= 0 ||
      s.flights[0].departure.flightDate !== q.departDate
    )
      invalid("inconsistent itinerary dates, duration or connections");
    const route: AwardSegment[] = s.flights.map((f, i) => {
      const prev = s.flights[i - 1];
      if (
        prev &&
        (prev.arrival.airportCode !== f.departure.airportCode ||
          sameAirportMinutes(
            local(prev.arrival.flightDate, prev.arrival.flightTime),
            local(f.departure.flightDate, f.departure.flightTime),
          ) < 0)
      )
        invalid("inconsistent connecting airports or local times");
      if (f.thruFlights !== f.stops.length)
        invalid("incomplete same-flight stop details");
      const technicalStops = f.stops.map((stop) => {
        const arrival = local(stop.arrivalDate, stop.arrivalTime),
          departure = local(stop.departureDate, stop.departureTime),
          duration = sameAirportMinutes(arrival, departure);
        if (duration < 0) invalid("inconsistent same-flight stop times");
        return { airport: stop.airportCode, arrival, departure, duration };
      });
      return {
        origin: f.departure.airportCode,
        destination: f.arrival.airportCode,
        departure: local(f.departure.flightDate, f.departure.flightTime),
        arrival: local(f.arrival.flightDate, f.arrival.flightTime),
        airline: f.marketingCarrier.airlineCode,
        airlineName: f.marketingCarrier.airlineName,
        flightNumber:
          f.marketingCarrier.airlineCode + f.marketingCarrier.flightNumber,
        operatingAirline: f.operatingCarrier
          ? f.operatingCarrier.airlineCode
          : f.marketingCarrier.airlineCode,
        operatedBy: (f.operatingCarrier ?? f.marketingCarrier).airlineName,
        operatingFlightNumber:
          f.operatingCarrier?.airlineCode && f.operatingCarrier.flightNumber
            ? f.operatingCarrier.airlineCode + f.operatingCarrier.flightNumber
            : null,
        aircraft: f.aircraftName,
        cabin: null,
        ...(technicalStops.length ? { technicalStops } : {}),
      };
    });
    const key = hash(route);
    if (seen.has(key)) invalid("duplicate physical itineraries");
    seen.add(key);
    const row: AwardResult = {
      id: "CM_" + key,
      programId: "CM_CONNECTMILES",
      origin: route[0].origin,
      destination: route.at(-1)!.destination,
      date: q.departDate,
      kind: "flight",
      segments: route,
      duration: minutes(s.journeyTime),
      prices: {},
      fares: [],
      source: "Copa ConnectMiles · airline browser",
      freshness: "live",
      observedAt,
      bookingUrl: "https://www.copaair.com/",
    };
    const fareKeys = new Set<string>();
    for (const o of s.offers) {
      const single = o.pricePerAdult,
        total = o.totalPrice,
        scale = 10 ** r.currency.decimals;
      if (
        single.miles <= 0 ||
        single.miles !== o.originalPricePerAdult ||
        total.miles !== single.miles * q.pax ||
        Math.round(total.taxes * scale) !==
          Math.round(single.taxes * q.pax * scale) ||
        o.classOfService.length !== route.length ||
        o.fareBasisCodes.length !== route.length
      )
        invalid("inconsistent fare or passenger totals");
      const cabin: Cabin = o.fareFamily.code.startsWith("E") ? "Y" : "J";
      const expectedName =
        (cabin === "Y" ? "Economy" : "Business") +
        (o.fareFamily.code.endsWith("SV") ? " Saver" : " Standard");
      if (o.fareFamily.name !== expectedName)
        invalid("an inconsistent cabin or fare family");
      const fareId =
        "CM_" +
        hash([
          key,
          o.fareFamily.code,
          o.classOfService,
          o.fareBasisCodes,
          single,
        ]);
      if (fareKeys.has(fareId)) invalid("duplicate fare choices");
      fareKeys.add(fareId);
      const segmentCabins = route.map(() =>
        route.length === 1 ? cabin : null,
      );
      const fare: AwardPrice = {
        fareId,
        fareName: o.fareFamily.name,
        cabin,
        points: single.miles,
        partyPoints: total.miles,
        quotedPassengers: q.pax,
        cash: single.taxes,
        currency: r.currency.code,
        seats: null,
        bookingClasses: o.classOfService,
        segmentCabins,
        cabinUnconfirmed: segmentCabins.includes(null),
        mixedCabin: false,
        refundable: null,
        bookingNotes: [
          "Anonymous ConnectMiles quote; member availability and final cost may differ after login.",
          "Sign in on Copa to confirm the final price and book.",
        ],
      };
      row.fares!.push(fare);
      const best = row.prices[cabin];
      if (
        !best ||
        fare.points < best.points ||
        (fare.points === best.points && fare.cash! < best.cash!)
      )
        row.prices[cabin] = fare;
    }
    // Copa expands airport searches to nearby departures. Preserve exact-route results only;
    // the caller reports excluded alternatives using copaObservationCounts.
    if (row.origin === q.origin && row.destination === q.dest) rows.push(row);
  }
  if (!rows.length)
    invalid(
      "only other-airport alternatives without a verified empty exact-route result",
    );
  return rows;
}
