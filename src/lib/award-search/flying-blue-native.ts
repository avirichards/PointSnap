import { createHash } from "node:crypto";
import { z } from "zod";
import { CABIN_ORDER, type Cabin, type SearchQuery } from "@/lib/types";
import { ProviderError, type AwardPrice, type AwardResult } from "./types";

const airport = z.string().regex(/^[A-Z]{3}$/);
const place = z.object({ code: airport });
const carrier = z.object({
  code: z.string().regex(/^[A-Z0-9]{2}$/),
  name: z.string().optional(),
});
const localTime = z.iso.datetime({ local: true });
const commercialCabin = z.enum(["ECONOMY", "PREMIUM", "BUSINESS", "FIRST"]);
const marketingFlight = z.object({
  number: z.string().regex(/^\d{1,4}$/),
  suffix: z.string().nullable().optional(),
  carrier,
});
const segmentIdentity = z.object({
  origin: place,
  destination: place,
  departureDateTime: localTime,
  marketingFlight,
});
const segment = segmentIdentity.extend({
  arrivalDateTime: localTime,
  duration: z.number().int().positive(),
  transferDuration: z.number().int().nonnegative().nullable(),
  highestPriority: z.boolean(),
  // A same-flight stop or surface sector needs an independently qualified shape.
  stopsAt: z.null(),
  equipmentType: z.literal("AIRCRAFT"),
  equipmentName: z.string(),
  marketingFlight: marketingFlight.extend({
    operatingFlight: z.object({
      number: z.string().regex(/^\d{1,4}$/),
      carrier,
    }),
  }),
});
const baseMoney = z.object({
  amount: z.number().finite().nonnegative().nullable(),
  currencyCode: z.string(),
});
const baseFare = z.object({
  cabinClass: commercialCabin,
  cabinClassTitle: z.string(),
  passengerCount: z.number().int().positive(),
  numberOfSeatsAvailable: z.number().int().nonnegative().nullable(),
  price: baseMoney.extend({ currencyCode: z.literal("MILES").nullable() }),
  tax: baseMoney.partial().nullable(),
});
const itinerary = z.object({
  activeConnection: z.object({
    duration: z.number().int().positive(),
    isDirect: z.boolean(),
    segments: z.array(segment).min(1),
  }),
  upsellCabinProducts: z
    .array(z.object({ connections: z.array(baseFare).length(1) }))
    .min(1),
});
const money = z.object({
  currency: z.string().regex(/^[A-Z]{3,5}$/),
  relevantPrice: z.number().finite().nonnegative(),
});
const expandedFare = z.object({
  activeConnectionUpsell: z.object({
    commercialCabin,
    commercialCabinLabel: z.string(),
    fareFamily: z.object({
      title: z.string(),
      bundleCode: z.string().nullable(),
    }),
    segments: z
      .array(
        z.object({ fareBasisCode: z.string(), sellingClassCode: z.string() }),
      )
      .min(1),
    price: money.extend({ currency: z.literal("MILES") }),
    taxDetails: money,
    primaryConditions: z.array(
      z.object({
        attributeSource: z.string(),
        code: z.string(),
        included: z.boolean(),
        commercialLabel: z.object({ text: z.string() }),
      }),
    ),
  }),
  price: money.extend({ currency: z.literal("MILES") }),
});
export const flyingBlueExpandedSchema = z.object({
  upsellRecommendations: z
    .array(
      z.object({
        activeFlightConnection: z.object({
          duration: z.number().int().positive(),
          segments: z.array(segmentIdentity).min(1),
        }),
        upsellFlightProducts: z.array(expandedFare).min(1),
      }),
    )
    .min(1),
});
/** Strip customer, traveler, authentication and opaque search/offer identifiers. */
export const flyingBlueRequestSchema = z.object({
  activeConnectionIndex: z.literal(0),
  bookingFlow: z.literal("REWARD"),
  availableOfferRequestBody: z.object({
    commercialCabins: z.tuple([z.literal("ECONOMY")]),
    passengers: z
      .array(z.object({ type: z.literal("ADT") }))
      .min(1)
      .max(9),
    requestedConnections: z
      .array(
        z.object({
          origin: place.extend({ type: z.literal("AIRPORT") }),
          destination: place.extend({ type: z.literal("AIRPORT") }),
          departureDate: z.iso.date(),
        }),
      )
      .length(1),
    bookingFlow: z.literal("REWARD"),
    withUpsellCabins: z.literal(true),
  }),
});
export const flyingBlueResultSchema = z.object({
  offerItineraries: z.array(itinerary),
});
export const flyingBluePayloadSchema = z.object({
  type: z.literal("flying-blue-member-awards"),
  request: flyingBlueRequestSchema,
  result: flyingBlueResultSchema,
  expanded: z.array(flyingBlueExpandedSchema),
});
export type FlyingBluePayload = z.infer<typeof flyingBluePayloadSchema>;
export type FlyingBlueItinerary = z.infer<typeof itinerary>;
export type FlyingBlueExpanded = z.infer<typeof flyingBlueExpandedSchema>;
export const flyingBlueCabin: Record<z.infer<typeof commercialCabin>, Cabin> = {
  ECONOMY: "Y",
  PREMIUM: "W",
  BUSINESS: "J",
  FIRST: "F",
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24);
const number = (s: string) => String(Number(s));
export const flyingBlueFlightKey = (c: {
  segments: z.infer<typeof segmentIdentity>[];
}) =>
  c.segments
    .map((s) =>
      [
        s.marketingFlight.carrier.code,
        number(s.marketingFlight.number),
        s.marketingFlight.suffix || "",
        s.origin.code,
        s.destination.code,
        s.departureDateTime,
      ].join("|"),
    )
    .join(";");
function fail(detail: string): never {
  throw new ProviderError(
    `Flying Blue ${detail}. Complete native award results could not be confirmed.`,
  );
}
export function flyingBlueBookingUrl(q: SearchQuery) {
  const u = new URL("https://www.klm.com/search/landing");
  u.search = new URLSearchParams({
    connections: `${q.origin}:A:${q.departDate.replaceAll("-", "")}>${q.dest}:A`,
    bookingFlow: "REWARD",
    cabinClass: "ECONOMY",
    pax: `${q.pax}:0:0:0:0:0:0:0`,
    activeConnection: "0",
  }).toString();
  return u.href;
}
export function flyingBlueBase(input: unknown, q: SearchQuery) {
  const parsed = flyingBluePayloadSchema
    .omit({ expanded: true })
    .safeParse(input);
  if (!parsed.success) fail("returned a changed flight, stop or fare format");
  const p = parsed.data,
    r = p.request.availableOfferRequestBody,
    c = r.requestedConnections[0];
  if (
    q.returnDate ||
    c.origin.code !== q.origin ||
    c.destination.code !== q.dest ||
    c.departureDate !== q.departDate ||
    r.passengers.length !== q.pax
  )
    fail("returned a different route, date or passenger count");
  if (!p.result.offerItineraries.length)
    fail("did not supply a verified flight-result set");
  const seen = new Set<string>();
  for (const f of p.result.offerItineraries) {
    const c = f.activeConnection,
      ss = c.segments,
      key = flyingBlueFlightKey(c);
    if (seen.has(key)) fail("returned duplicate flight combinations");
    seen.add(key);
    if (
      ss[0].origin.code !== q.origin ||
      ss.at(-1)!.destination.code !== q.dest ||
      ss[0].departureDateTime.slice(0, 10) !== q.departDate ||
      c.isDirect !== (ss.length === 1) ||
      ss.filter((s) => s.highestPriority).length !== 1 ||
      ss.some(
        (s, i) =>
          !!s.marketingFlight.suffix ||
          (i > 0 &&
            (ss[i - 1].destination.code !== s.origin.code ||
              ss[i - 1].arrivalDateTime >= s.departureDateTime)) ||
          (i < ss.length - 1
            ? s.transferDuration === null
            : s.transferDuration !== null),
      )
    )
      fail("returned an inconsistent itinerary");
    if (
      ss.reduce((n, s) => n + s.duration + (s.transferDuration ?? 0), 0) !==
      c.duration
    )
      fail("returned inconsistent flight or connection durations");
    const cabins = new Set<string>();
    for (const product of f.upsellCabinProducts) {
      const a = product.connections[0];
      if (cabins.has(a.cabinClass) || a.passengerCount !== q.pax)
        fail("returned ambiguous cabin or passenger totals");
      cabins.add(a.cabinClass);
      if (a.price.amount === null) {
        if (
          a.price.currencyCode !== null ||
          a.tax?.amount != null ||
          a.tax?.currencyCode != null
        )
          fail("returned contradictory unavailable pricing");
      } else if (
        !Number.isSafeInteger(a.price.amount) ||
        a.price.amount <= 0 ||
        a.price.currencyCode !== "MILES" ||
        a.tax?.amount == null ||
        !/^[A-Z]{3}$/.test(a.tax.currencyCode ?? "")
      )
        fail("returned invalid award points or fees");
    }
  }
  return p;
}
export function flyingBlueFlights(
  input: unknown,
  q: SearchQuery,
): FlyingBluePayload {
  const parsed = flyingBluePayloadSchema.safeParse(input);
  if (!parsed.success) fail("returned changed expanded fare details");
  const p = parsed.data;
  flyingBlueBase(p, q);
  const expanded = p.expanded.flatMap((e) => e.upsellRecommendations);
  const byKey = new Map(
    expanded.map((e) => [flyingBlueFlightKey(e.activeFlightConnection), e]),
  );
  const priced = p.result.offerItineraries.filter((f) =>
    f.upsellCabinProducts.some((a) => a.connections[0].price.amount !== null),
  );
  if (byKey.size !== expanded.length || byKey.size !== priced.length)
    fail("did not expand every available flight exactly once");
  for (const f of priced) {
    const e = byKey.get(flyingBlueFlightKey(f.activeConnection));
    if (!e || e.activeFlightConnection.duration !== f.activeConnection.duration)
      fail("returned expanded fares for a different flight");
    const fareKeys = new Set<string>();
    for (const a of e.upsellFlightProducts) {
      const fare = a.activeConnectionUpsell,
        key = hash(a);
      const base = f.upsellCabinProducts.find(
        (c) => c.connections[0].cabinClass === fare.commercialCabin,
      )?.connections[0];
      if (
        fareKeys.has(key) ||
        !base ||
        base.price.amount === null ||
        fare.segments.length !== f.activeConnection.segments.length ||
        fare.price.relevantPrice <= 0 ||
        !Number.isSafeInteger(fare.price.relevantPrice) ||
        a.price.relevantPrice !== fare.price.relevantPrice ||
        fare.taxDetails.currency !== base.tax?.currencyCode ||
        fare.price.relevantPrice < base.price.amount
      )
        fail("returned inconsistent or duplicated expanded fare choices");
      fareKeys.add(key);
    }
    for (const a of f.upsellCabinProducts.map((c) => c.connections[0])) {
      const fares = e.upsellFlightProducts.filter(
        (p) => p.activeConnectionUpsell.commercialCabin === a.cabinClass,
      );
      if (
        a.price.amount === null
          ? fares.length > 0
          : !fares.some(
              (p) =>
                p.price.relevantPrice === a.price.amount &&
                Math.abs(
                  p.activeConnectionUpsell.taxDetails.relevantPrice -
                    a.tax!.amount!,
                ) < 0.001,
            )
      )
        fail("did not retain every displayed cabin price and fee");
    }
  }
  return p;
}
export function parseFlyingBlueNative(
  input: unknown,
  q: SearchQuery,
  observedAt: string,
): AwardResult[] {
  const p = flyingBlueFlights(input, q);
  const expanded = new Map(
    p.expanded
      .flatMap((e) => e.upsellRecommendations)
      .map((e) => [flyingBlueFlightKey(e.activeFlightConnection), e]),
  );
  return p.result.offerItineraries.flatMap((f) => {
    const c = f.activeConnection,
      key = flyingBlueFlightKey(c);
    const fares: AwardPrice[] = (expanded.get(key)?.upsellFlightProducts ?? [])
      .map((a) => {
        const v = a.activeConnectionUpsell,
          cabin = flyingBlueCabin[v.commercialCabin];
        const cancel = v.primaryConditions.find((p) => p.code === "CANCEL");
        return {
          fareId: hash([key, a]),
          fareName: v.fareFamily.title,
          cabin,
          segmentCabins: c.segments.map(() =>
            c.segments.length === 1 ? cabin : null,
          ),
          cabinUnconfirmed: c.segments.length > 1,
          mixedCabin: false,
          bookingClasses: v.segments.map((s) => s.sellingClassCode),
          points: v.price.relevantPrice / q.pax,
          partyPoints: v.price.relevantPrice,
          quotedPassengers: q.pax,
          cash: v.taxDetails.relevantPrice / q.pax,
          currency: v.taxDetails.currency,
          // Source seat counts can be capped and aren't independently qualified.
          seats: null,
          refundable:
            cancel?.included &&
            /^Refundable\b/i.test(cancel.commercialLabel.text)
              ? true
              : null,
          bookingNotes: v.primaryConditions
            .filter((p) => p.attributeSource === "FARE")
            .map((p) => p.commercialLabel.text),
          eligibility: {
            type: "account" as const,
            label: "Member-account quote",
            description:
              "Observed through PointSnap’s authorized Flying Blue member session. Member benefits may affect the quote. Confirm your eligibility and the final price with Air France or KLM before transferring points.",
          },
        };
      })
      .filter(
        (a) => CABIN_ORDER.indexOf(a.cabin) >= CABIN_ORDER.indexOf(q.minCabin),
      );
    if (!fares.length) return [];
    const prices: AwardResult["prices"] = {};
    for (const fare of fares)
      if (
        !prices[fare.cabin] ||
        fare.points < prices[fare.cabin]!.points ||
        (fare.points === prices[fare.cabin]!.points &&
          fare.cash! < prices[fare.cabin]!.cash!)
      )
        prices[fare.cabin] = fare;
    return [
      {
        id: `flyingblue-${hash(key)}`,
        programId: "AF_FLYINGBLUE",
        kind: "flight" as const,
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        segments: c.segments.map((s) => ({
          origin: s.origin.code,
          destination: s.destination.code,
          departure: s.departureDateTime,
          arrival: s.arrivalDateTime,
          airline: s.marketingFlight.carrier.code,
          airlineName:
            s.marketingFlight.carrier.name ??
            (s.marketingFlight.carrier.code ===
            s.marketingFlight.operatingFlight.carrier.code
              ? s.marketingFlight.operatingFlight.carrier.name
              : undefined),
          flightNumber:
            s.marketingFlight.carrier.code + number(s.marketingFlight.number),
          operatingAirline: s.marketingFlight.operatingFlight.carrier.code,
          operatedBy: s.marketingFlight.operatingFlight.carrier.name,
          operatingFlightNumber:
            s.marketingFlight.operatingFlight.carrier.code +
            number(s.marketingFlight.operatingFlight.number),
          aircraft: s.equipmentName,
        })),
        duration: c.duration,
        fares,
        prices,
        source: "Flying Blue · direct airline · member quote",
        freshness: "live" as const,
        observedAt,
        bookingUrl: flyingBlueBookingUrl(q),
      },
    ];
  });
}
