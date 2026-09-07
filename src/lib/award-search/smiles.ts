import { createHash } from "node:crypto";
import { z } from "zod";
import { bookingUrl } from "@/lib/bookingHandoff";
import { CABIN_ORDER, type Cabin, type SearchQuery } from "@/lib/types";
import {
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

const nonnegative = z.number().finite().nonnegative();
const integer = nonnegative.int();
const decimal = z.union([
  nonnegative,
  z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .transform(Number),
]);
const cabinCode = z.enum([
  "ECONOMIC",
  "PREMIUM_ECONOMIC",
  "BUSINESS",
  "FIRST_CLASS",
]);
const airport = z.object({ code: z.string().regex(/^[A-Z]{3}$/) });
const place = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/)
    .refine((s) => {
      const d = new Date(s + "Z");
      return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 19) === s;
    }),
  airport,
});
const carrier = z.object({
  code: z.string().regex(/^[A-Z0-9]{2}$/),
  name: z.string().max(150).optional(),
});
const fare = z.object({
  type: z.enum([
    "SMILES",
    "SMILES_MONEY",
    "SMILES_CLUB",
    "SMILES_MONEY_CLUB",
    "SMILES_TIER",
    "SMILES_MONEY_TIER",
    "MONEY",
    "MONEY_CLUB",
  ]),
  miles: integer,
  money: nonnegative,
  offer: integer.optional(),
  g3: z
    .object({
      costTax: decimal.optional(),
      productClass: z.string().max(20).optional(),
    })
    .optional(),
});
const flight = z.object({
  cabin: cabinCode,
  sourceGDS: z.string().min(1).max(50),
  stops: integer,
  departure: place,
  arrival: place,
  airline: carrier,
  availableSeats: decimal.nullish(),
  duration: z.object({ hours: integer, minutes: integer.max(59) }),
  legList: z
    .array(
      z.object({
        cabin: cabinCode,
        flightNumber: z.string().regex(/^\d{1,5}[A-Z]?$/),
        departure: place,
        arrival: place,
        marketingAirline: carrier,
        operationAirline: carrier,
        equipment: z.string().max(30).nullish(),
        stops: integer.optional(),
        classOfService: z.string().max(20).nullish(),
        congener: z
          .object({ resBookDesigCode: z.string().max(20).nullish() })
          .optional(),
      }),
    )
    .min(1)
    .max(12),
  fareList: z.array(fare).min(1),
});
const quote = z.object({
  region: z.literal("BRASIL"),
  language: z.literal("pt-BR"),
  flightList: z
    .array(
      flight.extend({
        refundable: z.boolean().optional(),
        cancellationTax: decimal.nullish(),
        cancellationCurrency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
      }),
    )
    .length(1),
  totals: z.object({
    passenger: integer.positive(),
    totalFare: z.object({ miles: integer, money: nonnegative }),
    totalBoardingTax: z.object({
      money: nonnegative,
      airlineTax: nonnegative,
      boardingTaxMoney: nonnegative,
    }),
    totalPassengerTypeList: z
      .array(
        z.object({
          type: z.literal("ADT"),
          passenger: integer.positive(),
          totalFare: z.object({ miles: integer, money: nonnegative }),
        }),
      )
      .length(1),
  }),
});
const extension = z
  .object({
    flightIndex: integer,
    money: z.object({ fareList: z.array(fare) }),
    upsells: z.array(
      z.object({
        fareList: z.array(fare),
        fareRules: z
          .object({
            upSell: z.array(
              z.object({ item: z.string().max(500), available: z.boolean() }),
            ),
          })
          .optional(),
      }),
    ),
    tax: quote.optional(),
    unavailable: z
      .object({
        code: z.literal("113"),
        reason: z.literal("seats-unavailable"),
      })
      .optional(),
  })
  .refine((e) => !!e.tax !== !!e.unavailable);
/** This allowlist also removes anonymous shopping identifiers and page/account state. */
export const smilesPayloadSchema = z.object({
  query: z.object({
    origin: z.string(),
    dest: z.string(),
    departDate: z.string(),
    pax: integer.positive(),
  }),
  requestedCabin: z.enum(["ALL", "ECONOMIC"]),
  endOfResults: z.literal(true),
  displayedFlightCount: integer,
  response: z.object({
    tripTypeRequest: z.literal("ONE_WAY"),
    passenger: z.object({
      adults: z.string().regex(/^\d+$/),
      children: z.literal("0"),
      infants: z.literal("0"),
    }),
    requestedFlightSegmentList: z
      .array(
        z.object({ type: z.literal("SEGMENT_1"), flightList: z.array(flight) }),
      )
      .length(1),
  }),
  extensions: z.array(extension),
});
export type SmilesPayload = z.infer<typeof smilesPayloadSchema>;
const CABINS: Record<z.infer<typeof cabinCode>, Cabin> = {
  ECONOMIC: "Y",
  PREMIUM_ECONOMIC: "W",
  BUSINESS: "J",
  FIRST_CLASS: "F",
};
function fail(reason: string): never {
  throw new ProviderError(
    `Smiles returned ${reason}. Complete availability could not be confirmed.`,
  );
}
const cents = (n: number) => Math.round(n * 100);
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 24);
function identity(f: z.infer<typeof flight>) {
  return f.legList
    .map(
      (l) =>
        `${l.departure.airport.code}-${l.arrival.airport.code}-${l.marketingAirline.code}${l.flightNumber}@${l.departure.date}-${l.arrival.date}`,
    )
    .join("|");
}
function regular(f: z.infer<typeof fare>) {
  return f.type === "SMILES" || f.type === "SMILES_MONEY";
}

export function smilesObservationCounts(payload: unknown) {
  const p = smilesPayloadSchema.parse(payload);
  return {
    listed: p.displayedFlightCount,
    withdrawn: p.extensions.filter((e) => e.unavailable).length,
    otherAirports: p.response.requestedFlightSegmentList[0].flightList.filter(
      (f) =>
        f.departure.airport.code !== p.query.origin ||
        f.arrival.airport.code !== p.query.dest,
    ).length,
  };
}

export function parseSmiles(
  payload: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const parsed = smilesPayloadSchema.safeParse(payload);
  if (!parsed.success) fail("an incomplete flight, fare or tax response");
  const p = parsed.data,
    flights = p.response.requestedFlightSegmentList[0].flightList;
  if (
    p.query.origin !== q.origin ||
    p.query.dest !== q.dest ||
    p.query.departDate !== q.departDate ||
    p.query.pax !== q.pax ||
    Number(p.response.passenger.adults) !== q.pax
  )
    fail("a different search or traveler count");
  if (
    p.displayedFlightCount !== flights.length ||
    p.extensions.length !== flights.length ||
    new Set(p.extensions.map((e) => e.flightIndex)).size !== flights.length
  )
    fail("incomplete flight or fare counts");
  const results = new Map<string, AwardResult>();
  for (const [index, f] of flights.entries()) {
    const e = p.extensions.find((e) => e.flightIndex === index);
    if (!e) fail("missing fare details");
    const legs = f.legList;
    if (
      f.departure.date.slice(0, 10) !== q.departDate ||
      legs[0].departure.date !== f.departure.date ||
      legs.at(-1)!.arrival.date !== f.arrival.date ||
      legs[0].departure.airport.code !== f.departure.airport.code ||
      legs.at(-1)!.arrival.airport.code !== f.arrival.airport.code ||
      legs.some(
        (l, i) =>
          i > 0 &&
          legs[i - 1].arrival.airport.code !== l.departure.airport.code,
      )
    )
      fail("an incomplete itinerary or different travel date");
    if (e.unavailable) continue;
    const tax = e.tax;
    if (!tax) fail("missing travel-fee verification");
    const quoted = tax.flightList[0],
      total = tax.totals,
      base = f.fareList.filter((x) => x.type === "SMILES");
    if (
      base.length !== 1 ||
      base[0].miles <= 0 ||
      base[0].money !== 0 ||
      identity(quoted) !== identity(f) ||
      quoted.cabin !== f.cabin ||
      quoted.legList.some((l, i) => l.cabin !== f.legList[i]?.cabin) ||
      quoted.fareList.length !== 1 ||
      quoted.fareList[0].type !== "SMILES" ||
      quoted.fareList[0].money !== 0
    )
      fail("an inconsistent quoted itinerary");
    if (
      total.passenger !== q.pax ||
      total.totalPassengerTypeList[0].passenger !== q.pax ||
      total.totalFare.miles !== base[0].miles * q.pax ||
      total.totalPassengerTypeList[0].totalFare.miles !==
        total.totalFare.miles ||
      total.totalFare.money !== 0 ||
      total.totalPassengerTypeList[0].totalFare.money !== 0 ||
      quoted.fareList[0].miles !== base[0].miles
    )
      fail("a changed fare or traveler total");
    if (
      cents(total.totalBoardingTax.money) !==
      cents(
        total.totalBoardingTax.airlineTax +
          total.totalBoardingTax.boardingTaxMoney,
      )
    )
      fail("inconsistent travel fees");
    const quotedCabin = CABINS[f.cabin];
    if (p.requestedCabin === "ECONOMIC" && quotedCabin !== "Y")
      fail("a cabin outside the submitted search");
    if (f.stops < legs.length - 1) fail("an inconsistent stop count");
    if (f.duration.hours * 60 + f.duration.minutes <= 0)
      fail("an invalid trip duration");
    const moneyBase = f.fareList.filter((x) => x.type === "SMILES_MONEY");
    if (
      moneyBase.length > 1 ||
      e.money.fareList.some(
        (x) => x.type !== "SMILES_MONEY" || !x.miles || !x.money,
      ) ||
      (moneyBase.length &&
        !e.money.fareList.some(
          (x) =>
            x.miles === moneyBase[0].miles && x.money === moneyBase[0].money,
        )) ||
      (!moneyBase.length && e.money.fareList.length)
    )
      fail("incomplete cash-and-miles choices");
    if (
      new Set(e.money.fareList.map((f) => f.offer)).size !==
        e.money.fareList.length ||
      e.money.fareList.some((f, i) => f.offer !== i + 1)
    )
      fail("incomplete payment-choice numbering");
    const native = f.sourceGDS === "G3",
      expectedUpsells = native ? 1 + e.money.fareList.length : 0;
    if (e.upsells.length !== expectedUpsells)
      fail("missing fare-family checks");
    const fees = cents(total.totalBoardingTax.money) / 100 / q.pax;
    if (
      native &&
      base[0].g3?.costTax !== undefined &&
      cents(base[0].g3.costTax) !== cents(fees)
    )
      fail("changed travel fees");
    const count = quoted.availableSeats ?? f.availableSeats;
    if (count != null && !Number.isSafeInteger(count))
      fail("an invalid seat count");
    const seats = count && count > 0 ? count : null;
    const segments: AwardSegment[] = legs.map((l) => ({
      origin: l.departure.airport.code,
      destination: l.arrival.airport.code,
      departure: l.departure.date,
      arrival: l.arrival.date,
      airline: l.marketingAirline.code,
      airlineName: l.marketingAirline.name,
      operatingAirline: l.operationAirline.code,
      operatedBy: l.operationAirline.name,
      flightNumber: l.marketingAirline.code + l.flightNumber,
      aircraft: l.equipment,
      cabin: CABINS[l.cabin],
    }));
    const segmentCabins = legs.map((l) => CABINS[l.cabin]);
    const fares: AwardPrice[] = [];
    const append = (v: z.infer<typeof fare>, upgraded = false, bag = false) => {
      if (!regular(v)) return;
      if (
        !v.miles ||
        (v.type === "SMILES" && v.money !== 0) ||
        (v.type === "SMILES_MONEY" && !v.money)
      )
        fail("an invalid award quote");
      if (upgraded && v.g3?.costTax === undefined)
        fail("an upgrade without verified taxes");
      if (v.g3?.costTax !== undefined && cents(v.g3.costTax) !== cents(fees))
        fail("different taxes on an alternative fare");
      const family = v.g3?.productClass ?? base[0].g3?.productClass;
      const label =
        family === "LI"
          ? "Light"
          : family === "CL"
            ? "Classic"
            : upgraded
              ? "Baggage bundle"
              : null;
      const notes = [
        "Travel fees paid in cash. Smiles also offers payment of these fees with miles at booking.",
      ];
      if (bag) notes.push("Includes one checked bag up to 23 kg.");
      if (
        quoted.refundable &&
        quoted.cancellationTax &&
        quoted.cancellationCurrency
      )
        notes.push(
          `Cancellation fee: ${quoted.cancellationTax} ${quoted.cancellationCurrency} per traveler.`,
        );
      fares.push({
        fareId: hash([index, v.type, v.miles, v.money, family, upgraded]),
        fareName: [
          v.type === "SMILES_MONEY" ? "Smiles & Money" : "Smiles award",
          label,
        ]
          .filter(Boolean)
          .join(" · "),
        cabin: quotedCabin,
        points: v.miles,
        partyPoints: v.miles * q.pax,
        quotedPassengers: q.pax,
        cash: cents(v.money + fees) / 100,
        currency: "BRL",
        seats,
        segmentCabins,
        mixedCabin: new Set(segmentCabins).size > 1,
        bookingClasses: legs
          .map((l) => l.classOfService || l.congener?.resBookDesigCode)
          .filter((s): s is string => !!s),
        refundable: upgraded ? null : (quoted.refundable ?? null),
        bookingNotes: notes,
      });
    };
    append(base[0]);
    e.money.fareList.forEach((v) => append(v));
    for (const u of e.upsells)
      for (const v of u.fareList)
        append(
          v,
          true,
          !!u.fareRules?.upSell.some(
            (r) =>
              r.available &&
              r.item === "1ª bagagem despachada gratuita até 23kg",
          ),
        );
    if (
      // Smiles includes nearby airports even when its submitted query names an
      // exact airport (observed LAX -> AUS also contains ONT departures). Keep
      // every candidate fully validated, then expose only the requested route.
      f.departure.airport.code !== q.origin ||
      f.arrival.airport.code !== q.dest ||
      CABIN_ORDER.indexOf(quotedCabin) < CABIN_ORDER.indexOf(q.minCabin) ||
      (seats !== null && seats < q.pax)
    )
      continue;
    const key = identity(f);
    let row = results.get(key);
    if (!row) {
      row = {
        id: "smiles-" + hash(key),
        programId: "G3_GOL_SMILES",
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        kind: "flight",
        segments,
        duration: f.duration.hours * 60 + f.duration.minutes,
        stopDetailsUnconfirmed:
          f.stops > legs.length - 1 || legs.some((l) => (l.stops ?? 0) > 0),
        prices: {},
        fares: [],
        source: "GOL Smiles · airline browser",
        freshness: "live",
        observedAt,
        bookingUrl: bookingUrl("G3_GOL_SMILES", q),
      };
      results.set(key, row);
    }
    for (const price of fares) {
      if (!row.fares!.some((p) => p.fareId === price.fareId))
        row.fares!.push(price);
      const old = row.prices[price.cabin];
      if (
        !old ||
        price.points < old.points ||
        (price.points === old.points && price.cash! < old.cash!)
      )
        row.prices[price.cabin] = price;
    }
  }
  return [...results.values()];
}
