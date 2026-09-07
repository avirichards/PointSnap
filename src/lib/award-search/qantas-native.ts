import { createHash } from "node:crypto";
import { z } from "zod";
import { CABIN_ORDER, type Cabin, type SearchQuery } from "@/lib/types";
import { ProviderError, type AwardPrice, type AwardResult } from "./types";

const integer = z.number().int().nonnegative();
const amount = z.number().finite().nonnegative();
const airport = z.string().regex(/^[A-Z]{3}$/);
const sourceCabin = z.enum(["E", "P", "B", "F"]);
const currency = z.object({ code: airport, nbDecimals: integer.max(3) });
const location = z.object({ locationCode: airport });
const carrier = z.object({
  code: z.string().regex(/^[A-Z0-9]{2,3}$/),
  capitalizedName: z.string().min(1),
});
const price = z.object({
  convertedBaseFare: integer,
  tax: amount,
  currency,
});
const recommendation = z.object({
  ffCode: z.string().min(1),
  priceForOne: price,
  priceForAll: price,
  taxForOne: amount,
  taxForAll: amount,
  isRewardPlus: z.boolean(),
  cabins: z.record(z.string(), sourceCabin),
  rbds: z.array(z.string().min(1)),
  mixedCabins: z.array(
    z.object({ segmentId: integer, realCabinCode: sourceCabin }),
  ),
  nbLastSeatsAvailable: integer.nullable(),
  isCorporateDiscount: z.literal(false),
  isFareBasisDiscount: z.literal(false),
  blockRestrictedFares: z.boolean(),
  restrictedFare: z.boolean(),
});
const family = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  rewardPlusName: z.string().nullable(),
  isMarginal: z.boolean(),
  belongsToFirstDesktopColumn: z.boolean(),
});
const segment = z.object({
  id: integer,
  beginDate: integer,
  endDate: integer,
  beginLocationCode: z.string().min(1),
  endLocationCode: z.string().min(1),
  airline: carrier,
  operatingCarrier: carrier.extend({ code: carrier.shape.code.nullable() }),
  operatingAirlineFlightNumber: z.string().nullable(),
  flightNumber: z.string().regex(/^\d{1,4}$/),
  duration: integer.positive(),
  transitionTime: integer,
  // A new same-flight stop shape requires validation before it can be normalized.
  nbrOfStops: z.literal(0),
  stopLocationList: z.null(),
});
const itinerary = z.object({
  itemId: z.string().min(1),
  beginDate: integer,
  endDate: integer,
  beginLocationCode: z.string().min(1),
  endLocationCode: z.string().min(1),
  duration: integer.positive(),
  nbrOfStops: integer,
  segments: z.array(segment).min(1),
});

/** Public flight inventory only; discard booking/session references and account state. */
export const qantasNativeResponseSchema = z.object({
  modelInput: z.object({
    tripType: z.literal("O"),
    displayRewardsOnly: z.literal(true),
    milesQuoteCallSuccess: z.literal(true),
    aamPromoCodeApplied: z.literal(false),
    isJustAfterLateLogin: z.literal(false),
    listMessages: z.object({ hasErrors: z.literal(false) }),
    yourSearchBean: z.object({
      searchDataBean: z.object({
        itineraryList: z
          .array(
            z.object({
              beginDate: integer,
              beginLocation: location,
              endLocation: location,
            }),
          )
          .length(1),
      }),
    }),
    availability: z.object({
      currency,
      priceBox: z.object({
        passengers: z.object({
          number: z.object({
            ADT: integer.min(1).max(9),
            C15: z.literal(0),
            CHD: z.literal(0),
            INF: z.literal(0),
            YTH: z.literal(0),
          }),
          totalNbrOfPassengers: integer.positive(),
        }),
      }),
      listFareFamily: z.object({ fareFamilies: z.record(z.string(), family) }),
      bounds: z
        .array(
          z.object({
            boundId: z.literal(0),
            aamPromoCodeAppliedToBound: z.literal(false),
            hasCorporateDiscount: z.literal(false),
            ffCodeToAssociatedCabin: z.record(z.string(), sourceCabin),
            listItineraries: z.object({
              itineraries: z.array(itinerary),
              locations: z.record(z.string(), location),
            }),
            flights: z.record(
              z.string(),
              z.object({
                flightId: z.string().min(1),
                listRecommendation: z.record(z.string(), recommendation),
              }),
            ),
          }),
        )
        .length(1),
    }),
  }),
});
export type QantasNativeResponse = z.infer<typeof qantasNativeResponseSchema>;
const cabins: Record<z.infer<typeof sourceCabin>, Cabin> = {
  E: "Y",
  P: "W",
  B: "J",
  F: "F",
};
function invalid(reason: string): never {
  throw new ProviderError(
    `Qantas returned ${reason}. Complete native award results could not be confirmed.`,
  );
}
// The source encodes airport-local clock values as epoch-shaped numbers, not UTC instants.
function local(value: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    invalid("an invalid airport-local date");
  return date.toISOString().slice(0, 19);
}
const moneyMatches = (a: number, b: number) => Math.abs(a - b) < 0.005;

export function readQantasNative(value: unknown, q: SearchQuery) {
  const parsed = qantasNativeResponseSchema.safeParse(value);
  if (!parsed.success) invalid("an unsupported flight, fare or search format");
  const m = parsed.data.modelInput,
    a = m.availability;
  const query = m.yourSearchBean.searchDataBean.itineraryList[0];
  if (
    query.beginLocation.locationCode !== q.origin ||
    query.endLocation.locationCode !== q.dest ||
    local(query.beginDate).slice(0, 10) !== q.departDate ||
    a.priceBox.passengers.number.ADT !== q.pax ||
    a.priceBox.passengers.totalNbrOfPassengers !== q.pax
  )
    invalid("a different route, date or passenger count");
  const b = a.bounds[0],
    ids = b.listItineraries.itineraries.map((i) => i.itemId);
  if (!ids.length)
    invalid("an empty response without verified empty-availability semantics");
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== Object.keys(b.flights).length ||
    ids.some((id) => b.flights[id]?.flightId !== id)
  )
    invalid("incomplete or conflicting flight references");
  return parsed.data;
}

export function qantasNativeCounts(value: unknown, q: SearchQuery) {
  const m = readQantasNative(value, q).modelInput,
    a = m.availability,
    b = a.bounds[0];
  const itineraries = b.listItineraries.itineraries;
  const exact = itineraries.filter(
    (i) =>
      b.listItineraries.locations[i.beginLocationCode]?.locationCode ===
        q.origin &&
      b.listItineraries.locations[i.endLocationCode]?.locationCode === q.dest,
  );
  const count = (items: typeof itineraries) =>
    items.reduce(
      (n, i) =>
        n +
        Object.values(b.flights[i.itemId].listRecommendation).filter(
          (r) => a.listFareFamily.fareFamilies[r.ffCode]?.isMarginal,
        ).length,
      0,
    );
  return {
    itineraries: itineraries.length,
    fares: count(itineraries),
    exactItineraries: exact.length,
    exactFares: count(exact),
    otherAirportItineraries: itineraries.length - exact.length,
  };
}

export function parseQantasNative(
  value: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const a = readQantasNative(value, q).modelInput.availability,
    b = a.bounds[0];
  const rows: AwardResult[] = [],
    identities = new Set<string>();
  const airportCode = (key: string) =>
    b.listItineraries.locations[key]?.locationCode ??
    invalid("an unidentified airport");
  for (const i of b.listItineraries.itineraries) {
    if (
      local(i.beginDate).slice(0, 10) !== q.departDate ||
      i.nbrOfStops !== i.segments.length - 1 ||
      i.beginDate !== i.segments[0].beginDate ||
      i.endDate !== i.segments.at(-1)!.endDate ||
      airportCode(i.beginLocationCode) !==
        airportCode(i.segments[0].beginLocationCode) ||
      airportCode(i.endLocationCode) !==
        airportCode(i.segments.at(-1)!.endLocationCode) ||
      i.duration !==
        i.segments.reduce((n, s) => n + s.duration + s.transitionTime, 0)
    )
      invalid("inconsistent itinerary dates, stops or duration");
    const segments = i.segments.map((s, n) => {
      const prev = i.segments[n - 1];
      if (
        prev &&
        (airportCode(prev.endLocationCode) !==
          airportCode(s.beginLocationCode) ||
          s.beginDate - prev.endDate !== prev.transitionTime)
      )
        invalid("inconsistent connections");
      return {
        origin: airportCode(s.beginLocationCode),
        destination: airportCode(s.endLocationCode),
        departure: local(s.beginDate),
        arrival: local(s.endDate),
        airline: s.airline.code,
        airlineName: s.airline.capitalizedName,
        flightNumber: s.airline.code + s.flightNumber,
        operatingAirline: s.operatingCarrier.code,
        operatedBy: s.operatingCarrier.capitalizedName,
        operatingFlightNumber:
          s.operatingCarrier.code && s.operatingAirlineFlightNumber
            ? s.operatingCarrier.code + s.operatingAirlineFlightNumber
            : null,
        aircraft: null,
        cabin: null,
      };
    });
    const fares: AwardPrice[] = [],
      prices: AwardResult["prices"] = {};
    for (const [key, r] of Object.entries(
      b.flights[i.itemId].listRecommendation,
    )) {
      const f = a.listFareFamily.fareFamilies[key],
        associated = b.ffCodeToAssociatedCabin[key];
      if (!f || f.code !== key || r.ffCode !== key || !associated)
        invalid("an unidentified fare family");
      // Commercial cash fares also carry converted points fields; they are not Classic awards.
      if (!f.isMarginal) continue;
      const code = cabins[associated],
        one = r.priceForOne,
        all = r.priceForAll;
      if (r.blockRestrictedFares || r.restrictedFare)
        invalid("a member-restricted award without verified eligibility");
      if (
        !one.convertedBaseFare ||
        all.convertedBaseFare !== one.convertedBaseFare * q.pax ||
        !moneyMatches(r.taxForAll, r.taxForOne * q.pax) ||
        !moneyMatches(one.tax, r.taxForOne) ||
        !moneyMatches(all.tax, r.taxForAll) ||
        one.currency.code !== a.currency.code ||
        all.currency.code !== a.currency.code
      )
        invalid("inconsistent per-adult points, fees or party totals");
      if (
        Object.keys(r.cabins).length !== segments.length ||
        r.rbds.length !== segments.length
      )
        invalid("incomplete segment cabin or booking-class information");
      const segmentCabins = segments.map((_, n) => {
        const c = r.cabins[String(n)];
        if (!c) invalid("an unidentified segment cabin");
        return cabins[c];
      });
      for (const mixed of r.mixedCabins) {
        const n = i.segments.findIndex((s) => s.id === mixed.segmentId);
        if (n < 0 || r.cabins[String(n)] !== mixed.realCabinCode)
          invalid("conflicting mixed-cabin details");
      }
      if (r.nbLastSeatsAvailable !== null && r.nbLastSeatsAvailable < q.pax)
        invalid("a displayed award with insufficient reported seats");
      const fareName = r.isRewardPlus ? f.rewardPlusName : f.name;
      if (!fareName) invalid("an unidentified Classic Plus fare");
      if (CABIN_ORDER.indexOf(code) < CABIN_ORDER.indexOf(q.minCabin)) continue;
      const fare: AwardPrice = {
        fareId: `${i.itemId}-${key}-${r.isRewardPlus ? "plus" : "classic"}`,
        fareName,
        cabin: code,
        points: one.convertedBaseFare,
        partyPoints: all.convertedBaseFare,
        quotedPassengers: q.pax,
        cash: r.taxForOne,
        currency: a.currency.code,
        seats: r.nbLastSeatsAvailable,
        refundable: null,
        bookingClasses: r.rbds,
        segmentCabins,
        mixedCabin: segmentCabins.some((c) => c !== code),
        bookingNotes: [
          "Anonymous Qantas award quote. Log in with Qantas to confirm eligibility and book; availability and prices can change.",
        ],
      };
      fares.push(fare);
      if (!prices[code] || fare.points < prices[code]!.points)
        prices[code] = fare;
    }
    if (
      segments[0].origin !== q.origin ||
      segments.at(-1)!.destination !== q.dest ||
      !fares.length
    )
      continue;
    const identity = segments
      .map((s) =>
        [s.flightNumber, s.origin, s.destination, s.departure].join(":"),
      )
      .join("|");
    if (identities.has(identity))
      invalid("duplicate physical itineraries requiring fare reconciliation");
    identities.add(identity);
    rows.push({
      id:
        "qf-native-" +
        createHash("sha256").update(identity).digest("hex").slice(0, 24),
      programId: "QF_FF",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration: i.duration / 60000,
      fares,
      prices,
      source: "Qantas native booking · anonymous award quote",
      freshness: "live",
      observedAt,
      bookingUrl: "https://www.qantas.com/en-us/book/flights",
    });
  }
  return rows;
}
