import { createHash } from "node:crypto";
import { etihadBookingUrl } from "@/lib/bookingHandoff";
export { etihadBookingUrl } from "@/lib/bookingHandoff";
import { z } from "zod";
import type { Cabin, SearchQuery } from "@/lib/types";
import { ProviderError, type AwardPrice, type AwardResult } from "./types";

const integer = z.number().int().nonnegative();
const code = z.string().regex(/^[A-Z]{3}$/);
const money = z.object({
  base: integer,
  total: integer,
  totalTaxes: integer,
  totalFees: integer.optional(),
  currencyCode: code,
});
const conversion = z.object({
  convertedMiles: z.object({ base: integer, total: integer }),
});
const location = z.object({
  locationCode: code,
  dateTime: z.iso.datetime({ offset: true }),
});
const availability = z.object({
  flightId: z.string().min(1),
  cabin: z.enum(["eco", "premiumEco", "business", "first"]),
  bookingClass: z.string().regex(/^[A-Z]$/),
  statusCode: z.string(),
  quota: integer,
});
const fareSchema = z.object({
  fareFamilyCode: z.string().regex(/^[A-Z0-9]+$/),
  availabilityDetails: z.array(availability).min(1),
  prices: z.object({
    unitPrices: z
      .array(
        z.object({
          travelerIds: z.array(z.string()).min(1),
          prices: z.array(money).length(1),
          milesConversion: conversion,
        }),
      )
      .min(1),
    totalPrices: z.array(money).length(1),
    milesConversion: conversion,
    isRedemption: z.boolean(),
  }),
  fareConditionsCodes: z.array(z.string()),
});

/** Strip selection tokens, office identifiers, accounts and unrelated metadata. */
export const etihadResponseSchema = z.object({
  data: z.object({
    airBoundGroups: z.array(
      z.object({
        boundDetails: z.object({
          originLocationCode: code,
          destinationLocationCode: code,
          duration: integer,
          segments: z.array(z.object({ flightId: z.string().min(1) })).min(1),
        }),
        airBounds: z.array(fareSchema),
      }),
    ),
  }),
  dictionaries: z.object({
    flight: z.record(
      z.string(),
      z.object({
        marketingAirlineCode: z.string().regex(/^[A-Z0-9]{2}$/),
        operatingAirlineCode: z
          .string()
          .regex(/^[A-Z0-9]{2}$/)
          .optional(),
        operatingAirlineName: z.string().optional(),
        marketingFlightNumber: z.string().regex(/^\d{1,4}[A-Z]?$/),
        departure: location,
        arrival: location,
        duration: integer,
        aircraftCode: z.string().optional(),
        isOpenSegment: z.literal(false),
        stops: z
          .array(
            z.object({
              locationCode: code,
              duration: integer,
              arrivalDateTime: z.iso.datetime({ offset: true }),
              departureDateTime: z.iso.datetime({ offset: true }),
              isChangeOfGauge: z.boolean(),
            }),
          )
          .optional(),
      }),
    ),
    airline: z.record(z.string(), z.string()),
    aircraft: z.record(z.string(), z.string()),
    currency: z.record(z.string(), z.object({ decimalPlaces: integer.max(4) })),
    anonymousTraveler: z.record(
      z.string(),
      z.object({ passengerTypeCode: z.literal("ADT") }),
    ),
    fareFamilyWithServices: z.record(
      z.string(),
      z.object({
        cabin: availability.shape.cabin,
        commercialFareFamily: z.enum([
          "ECONOMY",
          "PREMIUM_ECONOMY",
          "BUSINESS",
          "FIRST",
        ]),
      }),
    ),
    fareConditions: z.record(
      z.string(),
      z.object({
        category: z.string(),
        situation: z.string(),
        details: z.array(z.object({ isAllowed: z.boolean() })),
      }),
    ),
  }),
});
export const etihadPayloadSchema = z.object({
  type: z.literal("etihad-cabin-searches"),
  searches: z
    .array(
      z.object({
        cabins: z.array(z.string()),
        limit: integer.positive(),
        response: etihadResponseSchema,
      }),
    )
    .length(2),
});
type EtihadPayload = z.infer<typeof etihadPayloadSchema>;
const cabins: Record<string, Cabin> = {
  eco: "Y",
  premiumEco: "W",
  business: "J",
  first: "F",
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
function invalid(reason: string): never {
  throw new ProviderError(
    `Etihad returned ${reason}. Complete availability could not be confirmed.`,
  );
}

function readPayload(value: unknown): EtihadPayload {
  const parsed = etihadPayloadSchema.safeParse(value);
  if (!parsed.success) invalid("an incomplete flight or fare response");
  const payload = parsed.data;
  if (
    payload.searches[0].cabins.join(",") !== "ECONOMY,BUSINESS" ||
    payload.searches[1].cabins.join(",") !== "BUSINESS,FIRST"
  )
    invalid("an incomplete cabin search");
  for (const s of payload.searches)
    if (s.response.data.airBoundGroups.length >= s.limit)
      invalid(
        "its maximum itinerary list; additional flight combinations may be missing",
      );
  return payload;
}

/** Both published cabin searches are required; later quotes replace the same fare. */
export function parseEtihad(
  value: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const payload = readPayload(value);
  const results = new Map<
    string,
    { row: AwardResult; fares: Map<string, AwardPrice> }
  >();
  for (const search of payload.searches) {
    const { data, dictionaries: dict } = search.response;
    const travelers = Object.keys(dict.anonymousTraveler).sort();
    if (travelers.length !== q.pax) invalid("a different passenger count");
    const seenGroups = new Set<string>();
    for (const group of data.airBoundGroups) {
      const bound = group.boundDetails,
        ids = bound.segments.map((s) => s.flightId);
      if (new Set(ids).size !== ids.length)
        invalid("a duplicate flight segment");
      const segments = ids.map((id) => {
        const f = dict.flight[id];
        if (!f) invalid("a missing flight segment");
        if (!f.operatingAirlineCode && !f.operatingAirlineName)
          invalid("missing operating carrier information");
        let previousStop = Date.parse(f.departure.dateTime);
        for (const stop of f.stops ?? []) {
          const arrival = Date.parse(stop.arrivalDateTime),
            departure = Date.parse(stop.departureDateTime);
          if (
            arrival < previousStop ||
            departure > Date.parse(f.arrival.dateTime) ||
            (departure - arrival) / 1000 !== stop.duration
          )
            invalid("inconsistent intermediate stops");
          previousStop = departure;
        }
        const elapsed =
          (Date.parse(f.arrival.dateTime) - Date.parse(f.departure.dateTime)) /
          1000;
        if (elapsed !== f.duration || elapsed <= 0)
          invalid("inconsistent flight times");
        return {
          origin: f.departure.locationCode,
          destination: f.arrival.locationCode,
          departure: f.departure.dateTime,
          arrival: f.arrival.dateTime,
          airline: f.marketingAirlineCode,
          airlineName: dict.airline[f.marketingAirlineCode],
          operatingAirline: f.operatingAirlineCode ?? null,
          operatedBy:
            f.operatingAirlineName ??
            (f.operatingAirlineCode
              ? dict.airline[f.operatingAirlineCode]
              : undefined),
          flightNumber: f.marketingAirlineCode + f.marketingFlightNumber,
          technicalStops: f.stops?.map((stop) => ({
            airport: stop.locationCode,
            arrival: stop.arrivalDateTime,
            departure: stop.departureDateTime,
            duration: stop.duration / 60,
          })),
          aircraft: f.aircraftCode
            ? (dict.aircraft[f.aircraftCode] ?? f.aircraftCode)
            : null,
        };
      });
      if (
        bound.originLocationCode !== q.origin ||
        bound.destinationLocationCode !== q.dest ||
        segments[0].origin !== q.origin ||
        segments.at(-1)!.destination !== q.dest ||
        segments[0].departure.slice(0, 10) !== q.departDate ||
        (Date.parse(segments.at(-1)!.arrival) -
          Date.parse(segments[0].departure)) /
          1000 !==
          bound.duration
      )
        invalid("a different route/date or inconsistent journey duration");
      for (let i = 1; i < segments.length; i++)
        if (
          Date.parse(segments[i - 1].arrival) >
          Date.parse(segments[i].departure)
        )
          invalid("an inconsistent connection");
      const transportNotes: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (
          segment.aircraft &&
          /\b(?:TRAIN|BUS|COACH)\b/i.test(segment.aircraft)
        )
          transportNotes.push(
            `Includes ${segment.aircraft.toLowerCase()} travel from ${segment.origin} to ${segment.destination}, operated by ${segment.operatedBy ?? segment.airline}.`,
          );
        if (i && segments[i - 1].destination !== segment.origin)
          transportNotes.push(
            `Transfer between ${segments[i - 1].destination} and ${segment.origin} is required; check the airline's transfer arrangements.`,
          );
        if (dict.flight[ids[i]].stops?.some((stop) => stop.isChangeOfGauge))
          transportNotes.push(
            `Aircraft change during ${segment.flightNumber}; see Etihad's itinerary details.`,
          );
      }
      const id =
        "EY_" +
        hash(
          segments.map((s) => [
            s.flightNumber,
            s.origin,
            s.destination,
            s.departure,
          ]),
        );
      if (seenGroups.has(id)) invalid("duplicate itinerary groups");
      seenGroups.add(id);
      const entry: { row: AwardResult; fares: Map<string, AwardPrice> } =
        results.get(id) ?? {
          row: {
            id,
            programId: "EY_GUEST",
            origin: q.origin,
            destination: q.dest,
            date: q.departDate,
            kind: "flight" as const,
            segments,
            duration: bound.duration / 60,
            prices: {},
            source: "Etihad Guest · airline browser",
            freshness: "live" as const,
            observedAt,
            bookingUrl: etihadBookingUrl(q),
          },
          fares: new Map<string, AwardPrice>(),
        };
      results.set(id, entry);
      // A fresh cabin quote supersedes its earlier fare families, even when
      // the airline changed booking class or removed a fare entirely.
      const commercialCabins: Record<Cabin, string> = {
        Y: "ECONOMY",
        W: "PREMIUM_ECONOMY",
        J: "BUSINESS",
        F: "FIRST",
      };
      for (const [key, fare] of entry.fares)
        if (search.cabins.includes(commercialCabins[fare.cabin]))
          entry.fares.delete(key);
      const seenFares = new Set<string>();
      for (const fare of group.airBounds) {
        const family = dict.fareFamilyWithServices[fare.fareFamilyCode];
        if (!family) invalid("an unknown fare family");
        const av = ids.map((id) =>
          fare.availabilityDetails.find((a) => a.flightId === id),
        );
        if (
          av.some((a) => !a) ||
          fare.availabilityDetails.length !== ids.length ||
          new Set(fare.availabilityDetails.map((a) => a.flightId)).size !==
            ids.length
        )
          invalid("incomplete segment availability");
        const availability = av.map((a) => a!);
        const fareKey = hash([
          fare.fareFamilyCode,
          availability.map((a) => [a.bookingClass, a.cabin]),
        ]);
        if (seenFares.has(fareKey)) invalid("duplicate fare choices");
        seenFares.add(fareKey);
        // showSoldOut=true also returns priced zero-seat fares. They are not bookable.
        if (availability.some((a) => a.quota < q.pax)) {
          entry.fares.delete(fareKey);
          continue;
        }
        if (availability.some((a) => a.statusCode !== "HK"))
          invalid("unconfirmed seat availability");
        const p = fare.prices,
          total = p.totalPrices[0],
          currency = total.currencyCode;
        const decimals = dict.currency[currency]?.decimalPlaces;
        if (decimals === undefined || (total.totalFees ?? 0) !== 0)
          invalid("unrecognized fee units");
        const partyPoints = p.milesConversion.convertedMiles.base;
        if (!partyPoints) invalid("a zero-mile available fare");
        let summedMiles = 0,
          summedTaxes = 0,
          summedCash = 0;
        const pricedTravelers: string[] = [];
        for (const unit of p.unitPrices) {
          const price = unit.prices[0],
            n = unit.travelerIds.length;
          if (price.currencyCode !== currency || (price.totalFees ?? 0) !== 0)
            invalid("inconsistent passenger currencies or fees");
          pricedTravelers.push(...unit.travelerIds);
          summedMiles += n * unit.milesConversion.convertedMiles.base;
          summedTaxes += n * price.totalTaxes;
          summedCash += n * price.total;
        }
        if (
          pricedTravelers.sort().join(",") !== travelers.join(",") ||
          summedMiles !== partyPoints ||
          summedTaxes !== total.totalTaxes ||
          summedCash !== total.total
        )
          invalid("inconsistent party pricing");
        const refundRules = fare.fareConditionsCodes
          .map((code) => {
            const rule = dict.fareConditions[code];
            if (!rule) invalid("missing fare conditions");
            return rule;
          })
          .filter(
            (r) => r.category === "refund" && r.situation === "beforeDeparture",
          )
          .flatMap((r) => r.details);
        const refundable = refundRules.length
          ? refundRules.every((r) => r.isAllowed)
          : null;
        const name = fare.fareFamilyCode.replace(/^[YJFW]G?/, "").toLowerCase();
        const price: AwardPrice = {
          fareId: "EY_" + hash([id, fareKey]),
          fareName: `${name.charAt(0).toUpperCase() + name.slice(1)} · ${p.isRedemption ? "GuestSeat" : "Pay with miles"}`,
          cabin: cabins[family.cabin],
          points: partyPoints / q.pax,
          partyPoints,
          quotedPassengers: q.pax,
          // The published booking client uses convertedMiles.base plus totalTaxes.
          // remainingNonConverted belongs to the alternate tax-to-miles conversion.
          cash: total.totalTaxes / 10 ** decimals / q.pax,
          currency,
          seats: Math.min(...availability.map((a) => a.quota)),
          bookingClasses: availability.map((a) => a.bookingClass),
          segmentCabins: availability.map((a) => cabins[a.cabin]),
          mixedCabin: new Set(availability.map((a) => a.cabin)).size > 1,
          refundable,
          bookingNotes: [
            ...(transportNotes.length ? [transportNotes.join(" ")] : []),
            ...(refundable
              ? [
                  "Refund restrictions and penalties may apply; check Etihad's fare conditions.",
                ]
              : []),
          ],
        };
        entry.fares.set(fareKey, price);
      }
    }
  }
  return [...results.values()]
    .filter((e) => e.fares.size)
    .map(({ row, fares }) => {
      row.fares = [...fares.values()];
      for (const fare of row.fares) {
        const previous = row.prices[fare.cabin];
        if (
          !previous ||
          fare.points < previous.points ||
          (fare.points === previous.points && fare.cash! < previous.cash!)
        )
          row.prices[fare.cabin] = fare;
      }
      return row;
    });
}
