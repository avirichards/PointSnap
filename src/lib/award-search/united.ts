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
const integer = z.number().int().nonnegative();
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d$/);
const product = z.object({
  ColumnId: integer,
  CabinType: z.enum(["Coach", "PREMIUMPLUS", "Business", "First"]).nullish(),
  BookingCode: z.string(),
  ProductType: z.string(),
  AwardType: z.string().nullish(),
  Description: z.string().nullish(),
  Fares: z.array(z.object({ FareBasisCode: z.string().nullish() })).optional(),
  Prices: z.array(
    z.object({
      Currency: z.string(),
      Amount: z.number().finite(),
      PricingType: z.string(),
    }),
  ),
});
const segment = z.object({
  Origin: airport,
  Destination: airport,
  DepartDateTime: localDateTime,
  DestinationDateTime: localDateTime,
  OriginTimezoneOffset: z.number().min(-14).max(14),
  DestinationTimezoneOffset: z.number().min(-14).max(14),
  MarketingCarrier: z.string().regex(/^[A-Z0-9]{2}$/),
  MarketingCarrierDescription: z.string(),
  OperatingCarrier: z.string(),
  OperatingCarrierDescription: z.string(),
  FlightNumber: z.string().regex(/^\d{1,4}$/),
  TravelMinutes: integer.positive(),
  EquipmentDisclosures: z.object({ EquipmentDescription: z.string() }),
  // A new same-flight-stop shape must be supported before accepting that itinerary.
  StopInfos: z.array(z.never()),
  Products: z.array(product),
});
const flight = segment.extend({
  TravelMinutesTotal: integer.positive(),
  Connections: z.array(segment),
});
/** Allowlist inventory at the capture boundary; never retain loyalty IDs, session/cart references or tokens. */
export const unitedResponseSchema = z.object({
  data: z.object({
    Status: z.literal(1),
    PageCount: z.literal(1),
    PageCurrent: z.literal(1),
    TripCount: z.literal(1),
    TravellerCount: integer.min(1).max(9),
    CountryCode: z.string(),
    EliteLevel: integer,
    Errors: z.array(z.never()).nullish(),
    Warnings: z
      .array(
        z.object({
          MajorCode: z.string(),
          MinorCode: z.string(),
          MinorDescription: z.string(),
        }),
      )
      .nullish(),
    Trips: z
      .array(
        z.object({
          Origin: airport,
          Destination: airport,
          DepartDate: z.iso.date(),
          FlightCount: integer,
          ColumnInformation: z.object({
            Columns: z.array(
              z.object({
                Value: z.string(),
                Type: z.string(),
                SubType: z.literal("Reward"),
              }),
            ),
          }),
          Flights: z.array(flight),
        }),
      )
      .length(1),
  }),
});
export const unitedPayloadSchema = z.object({
  type: z.literal("united-member-awards"),
  query: z.object({
    origin: airport,
    dest: airport,
    departDate: z.iso.date(),
    pax: integer.min(1).max(9),
  }),
  responses: z.array(unitedResponseSchema).min(1),
  accountPricing: z.literal(true),
});
export type UnitedFlight = z.infer<typeof flight>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
function invalid(reason: string): never {
  throw new ProviderError(
    `United returned ${reason}. Complete MileagePlus results could not be confirmed.`,
  );
}
export const unitedFlightKey = (f: UnitedFlight) =>
  [f, ...f.Connections]
    .map((s) =>
      [
        s.MarketingCarrier,
        s.FlightNumber,
        s.Origin,
        s.Destination,
        s.DepartDateTime,
        s.DestinationDateTime,
      ].join("|"),
    )
    .join(";");
const cabinMap: Record<string, Cabin> = {
  Coach: "Y",
  PREMIUMPLUS: "W",
  Business: "J",
  First: "F",
};
// These are airline column identities verified against its Economy, Premium, Business and First headings.
const columnCabin: Record<number, Cabin> = {
  3: "Y",
  103: "W",
  104: "W",
  107: "J",
  108: "J",
  109: "F",
  111: "F",
};
const label: Record<Cabin, string> = {
  Y: "Economy",
  W: "Premium Economy",
  J: "Business",
  F: "First",
};
const local = (value: string) => value.replace(" ", "T") + ":00";
const instant = (value: string, offset: number) =>
  Date.parse(local(value) + "Z") - offset * 3600000;
export function unitedFlights(value: unknown, q: SearchQuery) {
  const p = unitedPayloadSchema.safeParse(value);
  if (!p.success) invalid("an unsupported flight, cabin, stop or price format");
  const payload = p.data;
  if (
    Object.entries(payload.query).some(
      ([key, v]) => q[key as keyof SearchQuery] !== v,
    )
  )
    invalid("a different search query");
  const flights = new Map<string, UnitedFlight>();
  let elite: number | undefined;
  for (const { data } of payload.responses) {
    const t = data.Trips[0];
    if (
      t.Origin !== q.origin ||
      t.Destination !== q.dest ||
      t.DepartDate !== q.departDate ||
      data.TravellerCount !== q.pax
    )
      invalid("a different route, date or passenger count");
    if (elite !== undefined && elite !== data.EliteLevel)
      invalid("a changed account-pricing context");
    elite = data.EliteLevel;
    if (t.FlightCount !== t.Flights.length || !t.Flights.length)
      invalid("an incomplete or unverified empty inventory batch");
    for (const f of t.Flights) {
      if (
        f.Origin !== q.origin ||
        (f.Connections.at(-1) ?? f).Destination !== q.dest ||
        !f.DepartDateTime.startsWith(q.departDate)
      )
        invalid("an itinerary for another route or departure date");
      for (const p of f.Products) {
        if (
          !t.ColumnInformation.Columns.some(
            (c) =>
              c.Value.endsWith("-" + p.ColumnId) && c.Type === p.ProductType,
          )
        )
          invalid("an unrecognized fare column");
      }
      const key = unitedFlightKey(f),
        previous = flights.get(key);
      // Multiple FetchFlights batches can overlap. Only exact duplicates are safe to coalesce.
      if (previous && JSON.stringify(previous) !== JSON.stringify(f))
        invalid("conflicting repeated itinerary batches");
      flights.set(key, f);
    }
  }
  return { payload, flights: [...flights.values()], elite: elite! };
}
export function parseUnited(
  value: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const { flights, elite } = unitedFlights(value, q);
  return flights.map((f) => {
    const all = [f, ...f.Connections],
      key = hash(unitedFlightKey(f));
    const segments: AwardSegment[] = all.map((s, i) => {
      const previous = all[i - 1];
      if (
        instant(s.DestinationDateTime, s.DestinationTimezoneOffset) -
          instant(s.DepartDateTime, s.OriginTimezoneOffset) !==
          s.TravelMinutes * 60000 ||
        (previous &&
          instant(s.DepartDateTime, s.OriginTimezoneOffset) <
            instant(
              previous.DestinationDateTime,
              previous.DestinationTimezoneOffset,
            ))
      )
        invalid("inconsistent flight times or connections");
      return {
        origin: s.Origin,
        destination: s.Destination,
        departure: local(s.DepartDateTime),
        arrival: local(s.DestinationDateTime),
        airline: s.MarketingCarrier,
        airlineName: s.MarketingCarrierDescription,
        flightNumber: s.MarketingCarrier + s.FlightNumber,
        operatingAirline: s.OperatingCarrier || null,
        operatedBy: s.OperatingCarrierDescription || null,
        aircraft: s.EquipmentDisclosures.EquipmentDescription,
        cabin: null,
      };
    });
    if (
      instant(
        all.at(-1)!.DestinationDateTime,
        all.at(-1)!.DestinationTimezoneOffset,
      ) -
        instant(f.DepartDateTime, f.OriginTimezoneOffset) !==
      f.TravelMinutesTotal * 60000
    )
      invalid("an inconsistent journey duration");
    const fares: AwardPrice[] = [],
      seen = new Set<string>();
    for (const p of f.Products) {
      const mileage = p.Prices.filter(
        (x) => x.Currency === "MILES" && x.PricingType === "Award",
      );
      if (!mileage.length || mileage.every((x) => x.Amount <= 0)) continue;
      const taxes = p.Prices.filter((x) => x.PricingType === "Tax");
      if (
        mileage.length !== 1 ||
        taxes.length !== 1 ||
        !/^[A-Z]{3}$/.test(taxes[0].Currency) ||
        taxes[0].Amount < 0 ||
        !Number.isInteger(mileage[0].Amount)
      )
        invalid("an unsupported mileage or tax quote");
      const cabin = columnCabin[p.ColumnId];
      if (!cabin) invalid("a new cabin column");
      const segmentProducts = all.map((s) =>
        s.Products.filter((o) => o.ColumnId === p.ColumnId),
      );
      if (
        segmentProducts.some(
          (ps) => ps.length !== 1 || !ps[0].CabinType || !ps[0].BookingCode,
        )
      )
        invalid("missing segment cabin or booking-class details");
      const segmentCabins = segmentProducts.map(
        (ps) => cabinMap[ps[0].CabinType!],
      );
      const bookingClasses = segmentProducts.map((ps) => ps[0].BookingCode);
      // Domestic First feeding international Business is a premium connection, not a downgrade.
      const mixedCabin = segmentCabins.some(
        (c) => c !== cabin && !(cabin === "J" && c === "F"),
      );
      const points = mileage[0].Amount,
        tax = taxes[0];
      const semantic = [
        key,
        cabin,
        points,
        tax.Currency,
        tax.Amount,
        segmentCabins,
        bookingClasses,
        p.AwardType,
        segmentProducts.map((ps) => ps[0].Fares?.map((x) => x.FareBasisCode)),
      ];
      const fareId = "UA_" + hash(semantic);
      // Mixed-allowed and not-mixed columns repeat the same fare when every segment is identical.
      if (seen.has(fareId)) continue;
      seen.add(fareId);
      fares.push({
        fareId,
        fareName:
          label[cabin] + (p.AwardType ? " · " + p.AwardType + " award" : ""),
        cabin,
        points,
        quotedPassengers: q.pax,
        cash: tax.Amount,
        currency: tax.Currency,
        seats: null,
        segmentCabins,
        bookingClasses,
        mixedCabin,
        refundable: null,
        eligibility: {
          type: "account",
          label: elite > 0 ? "Elite account price" : "Member account price",
          description:
            "Observed while signed in to an authorized MileagePlus account. Your account may have different award access or prices; confirm with United before transferring points.",
        },
        bookingNotes: [
          ...all.flatMap((s, i) =>
            i && all[i - 1].Destination !== s.Origin
              ? [
                  "Airport change: arrive at " +
                    all[i - 1].Destination +
                    " and depart from " +
                    s.Origin +
                    ". Ground transfer is required between these flights.",
                ]
              : [],
          ),
        ],
      });
    }
    if (!fares.length) invalid("a flight without a positive award fare");
    const prices: AwardResult["prices"] = {};
    for (const p of fares) {
      const best = prices[p.cabin];
      if (
        !best ||
        p.points < best.points ||
        (p.points === best.points && p.cash! < best.cash!)
      )
        prices[p.cabin] = p;
    }
    return {
      id: "UA_" + key,
      programId: "UA_MP",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration: f.TravelMinutesTotal,
      prices,
      fares,
      source: "United MileagePlus · member airline browser",
      freshness: "live",
      observedAt,
      bookingUrl:
        "https://www.united.com/en/us/book-flight/united-award-travel",
    };
  });
}
