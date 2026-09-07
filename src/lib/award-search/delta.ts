import { createHash } from "node:crypto";
import { bookingUrl } from "@/lib/bookingHandoff";
import type { Cabin, SearchQuery } from "@/lib/types";
import {
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

type Obj = Record<string, unknown>;
function invalid(reason: string): never {
  throw new ProviderError(
    `Delta returned ${reason}. Complete availability could not be confirmed.`,
  );
}
function obj(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("an incomplete response");
  return value as Obj;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid("an incomplete list");
  return value;
}
function str(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    invalid("unrecognized flight information");
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid("an invalid count");
  return value;
}
function clock(value: unknown): string {
  const text = str(
    value,
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
  );
  if (!Number.isFinite(Date.parse(text + "Z")))
    invalid("an invalid local flight time");
  return text.length === 16 ? text + ":00" : text;
}
function duration(value: unknown): number {
  const d = obj(value);
  // Delta's own display uses hourCnt/minuteCnt. dayCnt is the arrival-day
  // offset: DL960 is 5h21m overnight, not a 29h21m journey.
  const minutes = count(d.minuteCnt);
  if (minutes > 59) invalid("an invalid trip duration");
  return count(d.hourCnt) * 60 + minutes;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
// Delta's current public retail brands. Comfort remains an Economy seat;
// Premium Select is Premium Economy and Delta One is Business.
const BRANDS: Record<string, { cabin: Cabin; name: string }> = {
  BMAIN: { cabin: "Y", name: "Delta Main Basic" },
  CMAIN: { cabin: "Y", name: "Delta Main Classic" },
  CDCP: { cabin: "Y", name: "Delta Comfort Classic" },
  CDPS: { cabin: "W", name: "Delta Premium Select Classic" },
  CD1: { cabin: "J", name: "Delta One Classic" },
  CFIRST: { cabin: "F", name: "Delta First Classic" },
};
type Brand = { cabin: Cabin; name: string };
const PARENT_CABINS: Record<string, Cabin> = {
  MAIN: "Y",
  DCP: "Y",
  DPPS: "W",
  D1: "J",
  FIRST: "F",
};
function brand(value: unknown, definitions: Map<string, Brand>) {
  const code = str(value, /^[A-Z0-9]{2,12}$/);
  const found = BRANDS[code] || definitions.get(code);
  if (!found) invalid(`an unrecognized cabin brand (${code})`);
  return found;
}

/** Brands whose meaning must be obtained from Delta's public content catalog. */
export function missingDeltaBrands(payload: unknown): string[] {
  const codes = new Set<string>();
  for (const page of list(obj(payload).pages))
    for (const raw of list(obj(page).gqlOffersSets))
      for (const value of list(obj(raw).offers)) {
        const offer = obj(value),
          a = obj(offer.additionalOfferProperties);
        if (
          offer.soldOut === true ||
          a.soldOut === true ||
          a.offered === false ||
          a.unavailableForSale === true
        )
          continue;
        codes.add(str(a.dominantSegmentBrandId, /^[A-Z0-9]{2,12}$/));
        for (const item of list(offer.offerItems))
          for (const retail of list(obj(item).retailItems))
            for (const fare of list(
              obj(obj(retail).retailItemMetaData).fareInformation,
            ))
              for (const leg of list(obj(fare).brandByFlightLegs))
                codes.add(str(obj(leg).brandId, /^[A-Z0-9]{2,12}$/));
      }
  return [...codes].filter((code) => !BRANDS[code]);
}

function brandDefinitions(value: unknown): Map<string, Brand> {
  const result = new Map<string, Brand>();
  for (const raw of list(value ?? [])) {
    const b = obj(raw),
      id = str(b.id, /^[A-Z0-9]{2,12}$/),
      parent = str(b.parentBrandId, /^[A-Z0-9]{2,12}$/);
    const cabin = PARENT_CABINS[parent];
    if (!cabin || result.has(id))
      invalid("an unrecognized or duplicate catalog cabin");
    const name = str(obj(b.shortBrandPrimaryName).text, /^[^<>]{1,150}$/)
      .replaceAll("&#174;", "®")
      .replaceAll("&reg;", "®")
      .replaceAll("&amp;", "&");
    result.set(id, { cabin, name });
  }
  return result;
}

type ParsedTrip = {
  segments: AwardSegment[];
  legKeys: string[][];
  duration: number;
  tripId: string;
};
function trip(value: unknown, q: SearchQuery): ParsedTrip {
  const t = obj(value),
    segments: AwardSegment[] = [],
    legKeys: string[][] = [];
  const tripId = str(t.tripId, /^\d+$/);
  for (const raw of list(t.flightSegment)) {
    const s = obj(raw),
      marketing = obj(s.marketingCarrier),
      operating = obj(s.operatingCarrier);
    const airline = str(marketing.carrierCode, /^[A-Z0-9]{2}$/),
      number = str(marketing.carrierNum, /^\d{1,4}[A-Z]?$/),
      operatingAirline = str(operating.carrierCode, /^[A-Z0-9]{2}$/),
      operatingNumber = str(operating.carrierNum, /^\d{1,4}[A-Z]?$/);
    const legs = list(s.flightLeg).map(obj);
    if (!legs.length) invalid("a segment without its legs");
    const origin = str(s.originAirportCode, /^[A-Z]{3}$/),
      destination = str(s.destinationAirportCode, /^[A-Z]{3}$/),
      departure = clock(s.scheduledDepartureLocalTs),
      arrival = clock(s.scheduledArrivalLocalTs);
    if (
      legs[0].originAirportCode !== origin ||
      legs.at(-1)!.destinationAirportCode !== destination ||
      clock(legs[0].scheduledDepartureLocalTs) !== departure ||
      clock(legs.at(-1)!.scheduledArrivalLocalTs) !== arrival
    )
      invalid("inconsistent flight legs");
    for (let i = 1; i < legs.length; i++) {
      if (
        legs[i - 1].destinationAirportCode !== legs[i].originAirportCode ||
        clock(legs[i].scheduledDepartureLocalTs) <
          clock(legs[i - 1].scheduledArrivalLocalTs)
      )
        invalid("disconnected flight legs");
    }
    legKeys.push(
      legs.map(
        (l) =>
          `${tripId}/${str(s.flightSegmentNum, /^\d+$/)}/${str(l.legId, /^\d+$/)}`,
      ),
    );
    segments.push({
      origin,
      destination,
      departure,
      arrival,
      airline,
      flightNumber: `${airline}${number}`,
      airlineName: airline === "DL" ? "Delta Air Lines" : null,
      operatingAirline,
      operatingFlightNumber: `${operatingAirline}${operatingNumber}`,
      operatedBy:
        typeof operating.carrierName === "string"
          ? operating.carrierName
          : null,
      aircraft:
        typeof obj(s.aircraft).fleetTypeCode === "string"
          ? String(obj(s.aircraft).fleetTypeCode)
          : null,
      ...(legs.length > 1
        ? {
            technicalStops: legs.slice(0, -1).map((leg, i) => ({
              airport: str(leg.destinationAirportCode, /^[A-Z]{3}$/),
              arrival: clock(leg.scheduledArrivalLocalTs),
              departure: clock(legs[i + 1].scheduledDepartureLocalTs),
              duration: Math.round(
                (Date.parse(
                  clock(legs[i + 1].scheduledDepartureLocalTs) + "Z",
                ) -
                  Date.parse(clock(leg.scheduledArrivalLocalTs) + "Z")) /
                  60000,
              ),
            })),
          }
        : {}),
    });
  }
  if (
    !segments.length ||
    t.originAirportCode !== q.origin ||
    t.destinationAirportCode !== q.dest ||
    segments[0].origin !== q.origin ||
    segments.at(-1)!.destination !== q.dest ||
    segments[0].departure!.slice(0, 10) !== q.departDate
  )
    invalid("a different route or date");
  if (
    clock(t.scheduledDepartureLocalTs) !== segments[0].departure ||
    clock(t.scheduledArrivalLocalTs) !== segments.at(-1)!.arrival
  )
    invalid("inconsistent itinerary times");
  for (let i = 1; i < segments.length; i++)
    if (
      segments[i - 1].destination !== segments[i].origin ||
      segments[i].departure! < segments[i - 1].arrival!
    )
      invalid("a disconnected itinerary");
  const minutes = duration(t.totalTripTime);
  if (!minutes) invalid("an invalid trip duration");
  const stops =
    segments.length -
    1 +
    segments.reduce((n, s) => n + (s.technicalStops?.length || 0), 0);
  if (count(t.stopCnt) !== stops) invalid("an incomplete stop list");
  return { segments, legKeys, duration: minutes, tripId };
}

function prices(
  value: unknown,
  t: ParsedTrip,
  currency: string,
  q: SearchQuery,
  definitions: Map<string, Brand>,
): AwardPrice[] {
  const offer = obj(value),
    a = obj(offer.additionalOfferProperties);
  if (
    offer.soldOut === true ||
    a.soldOut === true ||
    a.offered === false ||
    a.unavailableForSale === true
  )
    return [];
  if (
    offer.soldOut !== false ||
    a.soldOut !== false ||
    a.offered !== true ||
    a.unavailableForSale !== false
  )
    invalid("an unconfirmed offer");
  if (a.travelPolicyStatus != null && a.travelPolicyStatus !== "ALLOWED")
    invalid("a restricted offer");
  const cabinBrand = brand(a.dominantSegmentBrandId, definitions),
    result: AwardPrice[] = [];
  for (const rawItem of list(offer.offerItems))
    for (const rawRetail of list(obj(rawItem).retailItems)) {
      for (const rawFare of list(
        obj(obj(rawRetail).retailItemMetaData).fareInformation,
      )) {
        const f = obj(rawFare),
          brands = list(f.brandByFlightLegs).map(obj);
        const mappings = new Map<string, Obj>();
        for (const b of brands) {
          const key = `${str(b.tripId, /^\d+$/)}/${str(b.flightSegmentNum, /^\d+$/)}/${str(b.flightLegNum, /^\d+$/)}`;
          if (mappings.has(key)) invalid("duplicate leg-cabin records");
          mappings.set(key, b);
        }
        if (mappings.size !== t.legKeys.flat().length)
          invalid("an incomplete cabin list");
        const cabins: Cabin[] = [];
        const bookingClasses: string[] = [];
        const segmentCabins = t.legKeys.map((keys) => {
          const details = keys.map((key) => {
            const b = mappings.get(key);
            if (!b) invalid("a missing leg cabin");
            return b;
          });
          const legCabins = details.map(
            (b) => brand(b.brandId, definitions).cabin,
          );
          cabins.push(...legCabins);
          bookingClasses.push(
            details.map((b) => str(b.cosCode, /^[A-Z0-9]{1,3}$/)).join("/"),
          );
          return legCabins.every((c) => c === legCabins[0])
            ? legCabins[0]
            : null;
        });
        const reported =
          f.availableSeatCnt == null ? null : count(f.availableSeatCnt);
        const seats = reported && reported > 0 ? reported : null;
        if (seats !== null && seats < q.pax)
          invalid("an offer for too few passengers");
        for (const rawPrice of list(f.farePrice)) {
          const price = obj(rawPrice),
            total = obj(price.totalFarePrice),
            miles = obj(total.milesEquivalentPrice);
          if (miles.cashPlusMiles === true)
            invalid("a different points payment type");
          const points = count(miles.mileCnt);
          if (!points) invalid("an available award without a points price");
          const money = obj(total.currencyEquivalentPrice);
          // The visible grid rounds USD5.60 to USD6. Preserve the exact source string.
          const exact = str(
            money.formattedCurrencyAmt,
            /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,3})?$/,
          );
          const cash = Number(exact.replaceAll(",", ""));
          if (!Number.isFinite(cash)) invalid("an invalid fee amount");
          if (
            list(price.promotionalPrices ?? []).length ||
            list(price.discountsApplied ?? []).length
          )
            invalid("a promotional offer needing eligibility reconciliation");
          const refundable =
            typeof a.refundable === "boolean" ? a.refundable : null;
          result.push({
            fareId: hash([
              a.dominantSegmentBrandId,
              points,
              cash,
              currency,
              refundable,
              segmentCabins,
              bookingClasses,
            ]),
            fareName: cabinBrand.name,
            cabin: cabinBrand.cabin,
            points,
            partyPoints: points * q.pax,
            quotedPassengers: q.pax,
            cash,
            currency,
            seats,
            refundable,
            segmentCabins,
            bookingClasses,
            mixedCabin: cabins.some((c) => c !== cabinBrand.cabin),
            ...(seats === 9 ? { seatCountLabel: "9 or more reported" } : {}),
          });
        }
      }
    }
  if (!result.length) invalid("an available offer without fare details");
  return result;
}

/** All source pages are mandatory; errors, truncated pages and unknown brands fail closed. */
export function parseDelta(
  payload: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const root = obj(payload),
    query = obj(root.query);
  if (
    query.origin !== q.origin ||
    query.dest !== q.dest ||
    query.departDate !== q.departDate ||
    query.pax !== q.pax ||
    !Number.isInteger(q.pax) ||
    q.pax < 1 ||
    q.pax > 9 ||
    root.priceType !== "MILES"
  )
    invalid("a different search request");
  const pages = list(root.pages).map(obj);
  const definitions = brandDefinitions(root.brandDefinitions);
  if (!pages.length) invalid("a response without pagination metadata");
  const metadata = obj(pages[0].responseProperties),
    total = count(metadata.resultsPerRequestNum),
    pageCount = count(metadata.pageResultCnt);
  if (pages.length !== Math.max(1, pageCount))
    invalid("an unfinished page list");
  const result: AwardResult[] = [],
    seen = new Set<string>();
  let sourceRows = 0;
  pages.forEach((page, index) => {
    const meta = obj(page.responseProperties);
    if (
      page.page !== index + 1 ||
      meta.resultsPageNum !== index + 1 ||
      meta.pageResultCnt !== pageCount ||
      meta.resultsPerRequestNum !== total ||
      meta.tripTypeText !== "ONE_WAY"
    )
      invalid("inconsistent pagination");
    const currencyOptions = list(page.pricingOptions);
    if (currencyOptions.length !== 1) invalid("an ambiguous fee currency");
    const currency = str(
      obj(obj(currencyOptions[0]).pricingOptionDetail).currencyCode,
      /^[A-Z]{3}$/,
    );
    const sets = list(page.gqlOffersSets);
    sourceRows += sets.length;
    if (index < pages.length - 1 && !sets.length)
      invalid("an empty intermediate page");
    for (const raw of sets) {
      const set = obj(raw),
        trips = list(set.trips);
      if (trips.length !== 1) invalid("a different trip type");
      const parsed = trip(trips[0], q),
        identity = hash(parsed.segments);
      if (seen.has(identity)) invalid("duplicate itineraries across pages");
      seen.add(identity);
      const fares = list(set.offers).flatMap((o) =>
        prices(o, parsed, currency, q, definitions),
      );
      if (!fares.length) continue; // A documented sold-out itinerary has no bookable fare.
      const unique = new Map(fares.map((f) => [f.fareId, f]));
      const byCabin: AwardResult["prices"] = {};
      for (const fare of unique.values()) {
        const prior = byCabin[fare.cabin];
        if (
          !prior ||
          fare.points < prior.points ||
          (fare.points === prior.points && fare.cash! < prior.cash!)
        )
          byCabin[fare.cabin] = fare;
      }
      result.push({
        id: `dl-${identity}`,
        programId: "DL_SKYMILES",
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        kind: "flight",
        segments: parsed.segments,
        duration: parsed.duration,
        prices: byCabin,
        fares: [...unique.values()],
        source: "Delta SkyMiles · direct airline",
        freshness: "live",
        observedAt,
        bookingUrl: bookingUrl("DL_SKYMILES", q),
      });
    }
  });
  if (sourceRows !== total) invalid("an incomplete itinerary count");
  return result;
}
