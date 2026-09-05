import { createHash } from "node:crypto";
import { bookingUrl } from "@/lib/bookingHandoff";
import { type Cabin, type SearchQuery } from "@/lib/types";
import {
  cabin,
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

// Candidate parser for AA's current public booking response. There is deliberately
// no enabled transport: browser results do not prove unattended server access.
type RecordValue = Record<string, unknown>;
function invalid(reason: string): never {
  throw new ProviderError(
    `American returned ${reason}. Complete availability could not be confirmed.`,
  );
}
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("an incomplete response");
  return value as RecordValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid("an incomplete flight list");
  return value;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    invalid("unrecognized flight information");
  return value;
}
function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    invalid("an invalid fare amount");
  return value;
}
function integer(value: unknown): number {
  const n = numeric(value);
  if (!Number.isSafeInteger(n)) invalid("an invalid count");
  return n;
}
function airport(value: unknown): string {
  return text(object(value).code, /^[A-Z]{3}$/);
}
function timestamp(value: unknown): string {
  const result = text(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  if (!Number.isFinite(Date.parse(result))) invalid("an invalid flight time");
  return result;
}
function sourceCabin(value: unknown): Cabin {
  const result = cabin(value);
  if (!result) invalid("an unknown cabin");
  return result;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
const fareNames: Record<Cabin, string> = {
  Y: "Main Cabin",
  W: "Premium Economy",
  J: "Business",
  F: "First",
};

interface Leg {
  segment: AwardSegment;
  products: RecordValue[];
}
function parseLegs(slice: RecordValue): Leg[] {
  const result: Leg[] = [];
  for (const item of array(slice.segments)) {
    const segment = object(item),
      marketingFlight = object(segment.flight);
    const legs = array(segment.legs);
    if (!legs.length) invalid("a flight without its legs");
    for (const item of legs) {
      const leg = object(item);
      const flight = leg.flight == null ? marketingFlight : object(leg.flight);
      const airline = text(flight.carrierCode, /^[A-Z0-9]{2}$/);
      const flightNumber = text(flight.flightNumber, /^\d{1,4}[A-Z]?$/);
      const departure = timestamp(leg.departureDateTime),
        arrival = timestamp(leg.arrivalDateTime);
      if (Date.parse(arrival) <= Date.parse(departure))
        invalid("inconsistent flight times");
      const aircraft =
        typeof leg.aircraftCode === "string" ? leg.aircraftCode : null;
      result.push({
        segment: {
          origin: airport(leg.origin),
          destination: airport(leg.destination),
          departure,
          arrival,
          airline,
          airlineName:
            typeof flight.carrierName === "string" ? flight.carrierName : null,
          flightNumber: `${airline}${flightNumber}`,
          aircraft,
          // A regional carrier disclosure is not an operating flight number.
          operatedBy:
            typeof leg.operationalDisclosure === "string" &&
            leg.operationalDisclosure
              ? leg.operationalDisclosure
              : null,
        },
        products: array(leg.productDetails).map(object),
      });
    }
  }
  if (!result.length) invalid("an itinerary without flights");
  for (let i = 1; i < result.length; i++) {
    const prior = result[i - 1].segment,
      next = result[i].segment;
    if (
      prior.destination !== next.origin ||
      Date.parse(next.departure!) < Date.parse(prior.arrival!)
    )
      invalid("a disconnected itinerary");
  }
  return result;
}

function parseFare(
  value: unknown,
  legs: Leg[],
  q: SearchQuery,
): AwardPrice | null {
  const fare = object(value);
  if (fare.productAvailable === false) return null;
  if (fare.productAvailable !== true) invalid("an unconfirmed fare");
  const code = sourceCabin(fare.productType),
    points = integer(fare.perPassengerAwardPoints);
  if (!points) invalid("an available award without a points price");
  const fees = object(fare.perPassengerTaxesAndFees),
    totalFees = object(fare.allPassengerTaxesAndFees);
  const cash = numeric(fees.amount),
    currency = text(fees.currency, /^[A-Z]{3}$/);
  if (
    totalFees.currency !== currency ||
    Math.abs(numeric(totalFees.amount) - cash * q.pax) > 0.011
  )
    invalid("a different passenger total");
  const reportedSeats = integer(fare.seatsRemaining);
  // AA uses zero for available fares without a low-seat warning, not sold out.
  const seats = reportedSeats > 0 ? reportedSeats : null;
  if (seats !== null && seats < q.pax)
    invalid("a fare with too few seats for the requested party");
  const details = legs.map(({ products }) => {
    const matches = products.filter((p) => p.productType === fare.productType);
    if (matches.length !== 1) invalid("an ambiguous segment cabin");
    return matches[0];
  });
  const segmentCabins = details.map((p) => sourceCabin(p.cabinType));
  const bookingClasses = details.map((p) =>
    text(p.bookingCode, /^[A-Z0-9]{1,2}$/),
  );
  const refundable =
    typeof fare.refundable === "boolean" ? fare.refundable : null;
  const fareCode =
    typeof fare.extendedFareCode === "string" ? fare.extendedFareCode : "";
  return {
    fareId: hash(
      JSON.stringify([
        fare.productType,
        fareCode,
        points,
        cash,
        currency,
        refundable,
        segmentCabins,
        bookingClasses,
      ]),
    ),
    fareName: fareNames[code],
    cabin: code,
    points,
    partyPoints: points * q.pax,
    quotedPassengers: q.pax,
    cash,
    currency,
    seats,
    refundable,
    segmentCabins,
    bookingClasses,
    mixedCabin: segmentCabins.some((c) => c !== code),
  };
}

/** Parse a verified uncached, one-way AA award response; retain every itinerary
 * and every supplied price, not the cheapest six flights from the legacy worker.
 * The caller must submit the same adult count as q.pax in a fresh search.
 * No browser cookies, booking/session IDs or cached captures are booking links. */
export function parseAmerican(
  payload: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  if (!Number.isInteger(q.pax) || q.pax < 1 || q.pax > 9)
    invalid("an invalid passenger request");
  const source = object(payload);
  if (source.error) invalid("a failed search");
  const meta = object(source.responseMetadata);
  if (
    meta.searchType !== "Award" ||
    meta.tripType !== "ONE_WAY" ||
    meta.roundTrip !== false ||
    meta.sliceCount !== 1 ||
    meta.pricedSliceIndex !== 0
  )
    invalid("a different search type");
  if (
    airport(meta.origin) !== q.origin ||
    airport(meta.destination) !== q.dest ||
    meta.departureDate !== q.departDate
  )
    invalid("a different route or date");
  if (meta.cached !== false)
    invalid("cached prices without a verified observation time");
  for (const container of [source, meta]) {
    if (
      container.nextPage ||
      container.nextCursor ||
      container.hasMore ||
      container.continuationToken
    )
      invalid("an unfinished flight list");
  }
  const slices = array(source.slices);
  if (source.totalCount !== undefined && source.totalCount !== slices.length)
    invalid("an unfinished flight list");
  const seen = new Set<string>();
  return slices.map((entry) => {
    const slice = object(entry),
      legs = parseLegs(slice),
      segments = legs.map((l) => l.segment);
    if (
      airport(slice.origin) !== q.origin ||
      airport(slice.destination) !== q.dest ||
      segments[0].origin !== q.origin ||
      segments.at(-1)!.destination !== q.dest ||
      segments[0].departure!.slice(0, 10) !== q.departDate
    )
      invalid("an itinerary outside the requested route or date");
    const duration = integer(slice.durationInMinutes);
    if (
      Math.abs(
        (Date.parse(segments.at(-1)!.arrival!) -
          Date.parse(segments[0].departure!)) /
          60000 -
          duration,
      ) > 1
    )
      invalid("an inconsistent itinerary duration");
    const identity = segments
      .map(
        (s) =>
          `${s.flightNumber}:${s.origin}:${s.destination}@${s.departure}/${s.arrival}`,
      )
      .join("|");
    if (seen.has(identity))
      invalid("duplicate itinerary records that need reconciliation");
    seen.add(identity);
    const fares: AwardPrice[] = [];
    for (const entry of array(slice.pricingDetail)) {
      const price = object(entry);
      for (const candidate of [
        price,
        ...array(price.refundableProducts ?? []),
      ]) {
        // Do not silently discard a new nested fare structure.
        if (
          candidate !== price &&
          array(object(candidate).refundableProducts ?? []).length
        )
          invalid("unrecognized nested fare alternatives");
        const fare = parseFare(candidate, legs, q);
        if (fare && !fares.some((f) => f.fareId === fare.fareId))
          fares.push(fare);
      }
    }
    if (!fares.length) invalid("an itinerary without available prices");
    const prices: AwardResult["prices"] = {};
    for (const fare of fares) {
      const previous = prices[fare.cabin];
      if (
        !previous ||
        fare.points < previous.points ||
        (fare.points === previous.points && fare.cash! < previous.cash!)
      )
        prices[fare.cabin] = fare;
    }
    return {
      id: `aa-${hash(identity)}`,
      programId: "AA_AADVANTAGE",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration,
      prices,
      fares,
      source: "American AAdvantage · direct airline",
      freshness: "live",
      observedAt,
      bookingUrl: bookingUrl("AA_AADVANTAGE", q),
    };
  });
}
