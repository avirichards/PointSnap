import { createHash } from "node:crypto";
import { bookingUrl } from "@/lib/bookingHandoff";
import { CABIN_ORDER, type Cabin, type SearchQuery } from "@/lib/types";
import {
  cabin,
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

const bootstrapUrl = "https://www.jetblue.com/booking/";
const searchUrl = "https://cb-api.jetblue.com/cb-flight-search/v1/search/NGB";
type ObjectValue = Record<string, unknown>;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
function invalid(message = "an incomplete flight response"): never {
  throw new ProviderError(
    `JetBlue returned ${message}. Complete availability could not be confirmed.`,
  );
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as ObjectValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
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
function sourceCabin(value: unknown): Cabin {
  const result = cabin(value);
  if (!result) invalid("an unknown cabin");
  return result;
}
function validateQuery(q: SearchQuery) {
  const date = new Date(`${q.departDate}T00:00:00Z`);
  if (
    !/^[A-Z]{3}$/.test(q.origin) ||
    !/^[A-Z]{3}$/.test(q.dest) ||
    q.origin === q.dest ||
    !/^\d{4}-\d{2}-\d{2}$/.test(q.departDate) ||
    !Number.isFinite(+date) ||
    date.toISOString().slice(0, 10) !== q.departDate ||
    !Number.isInteger(q.pax) ||
    q.pax < 1 ||
    q.pax > 9
  ) {
    throw new ProviderError(
      "JetBlue needs a valid route, departure date and one to nine adults.",
      400,
    );
  }
}

/** The same public application marker delivered to every anonymous booking visitor.
 * Refresh from airline HTML; never embed it or reuse a member/browser session. */
export function jetbluePublicKey(html: string): string {
  const script = html.match(
    /<script\b[^>]*\bid=["']rwb-config["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  const key = script?.match(
    /\bcrystalBlueSubscriptionKey\s*:\s*["']([a-zA-Z0-9_-]{16,128})["']/,
  )?.[1];
  if (!key)
    throw new ProviderError(
      "JetBlue's public booking configuration is temporarily unavailable.",
    );
  return key;
}

export function jetblueRequest(q: SearchQuery, awardBooking = true) {
  validateQuery(q);
  return {
    awardBooking,
    travelerTypes: [{ type: "ADULT", quantity: q.pax }],
    searchComponents: [{ from: q.origin, to: q.dest, date: q.departDate }],
    // No cabin, stop, brand or lowest-fare filter: retrieve all supplied choices.
  };
}

// Fare identities from the current public booking client's brand-code mapping.
const fareNames: Record<string, string> = {
  DN: "Main Base",
  AN: "Main",
  GR: "Main Flex",
  DE: "EvenMore Base",
  EN: "EvenMore",
  ER: "EvenMore Flex",
  MN: "Mint",
  MR: "Mint Flex",
  AR: "Main refundable",
  CN: "Blue Plus",
  CR: "Blue Plus refundable",
  GN: "Blue Extra",
  A1: "Economy",
  M1: "Business",
  J1: "Business",
  A2: "Economy award",
  W2: "Premium Economy award",
  J2: "Business award",
  Z2: "First award",
};
const refundableBrands = new Set(["AR", "CR", "GR", "ER", "MR"]);
const nonRefundableBrands = new Set(["DN", "AN", "DE", "EN", "MN", "CN", "GN"]);
function refundability(brand: string): boolean | null {
  return refundableBrands.has(brand)
    ? true
    : nonRefundableBrands.has(brand)
      ? false
      : null;
}
interface ParsedFare {
  identity: string;
  brand: string;
  cabin: Cabin;
  segmentCabins: Cabin[];
  points: number | null;
  cash: number;
  currency: string;
  seats: number;
}
interface ParsedItinerary {
  key: string;
  segments: AwardSegment[];
  duration: number;
  fares: ParsedFare[];
}
function parseInventory(
  payload: unknown,
  q: SearchQuery,
  award: boolean,
): ParsedItinerary[] {
  validateQuery(q);
  const source = object(payload);
  if (object(source.status).transactionStatus !== "success")
    invalid("a failed or partial search");
  const searches = array(object(source.data).searchResults);
  if (searches.length !== 1) invalid("an unexpected number of search legs");
  const search = object(searches[0]),
    component = object(search.searchComponent);
  if (
    component.from !== q.origin ||
    component.to !== q.dest ||
    component.date !== q.departDate
  )
    invalid("a different route or date");
  // A changed/paginated contract must not silently become a complete result.
  if (
    search.nextPage ||
    search.nextCursor ||
    search.hasMore ||
    search.continuationToken
  )
    invalid("an unfinished flight list");
  const products = array(search.productOffers);
  if (search.totalCount !== undefined && search.totalCount !== products.length)
    invalid("an unfinished flight list");
  const seen = new Set<string>();
  return products.map((entry, productIndex) => {
    const product = object(entry),
      journeys = array(product.originAndDestination);
    if (journeys.length !== 1) invalid("an unexpected itinerary structure");
    const journey = object(journeys[0]);
    if (journey.awardBooking !== award) invalid("a different payment type");
    const flightSegments = array(journey.flightSegments);
    if (!flightSegments.length) invalid("an itinerary without flights");
    const segments = flightSegments.map((item): AwardSegment => {
      const segment = object(item),
        departure = object(segment.departure),
        arrival = object(segment.arrival),
        info = object(segment.flightInfo);
      const airline = text(info.marketingAirlineCode, /^[A-Z0-9]{2}$/);
      const operating = text(info.operatingAirlineCode, /^[A-Z0-9]{2}$/);
      const flight = String(info.marketingFlightNumber ?? "");
      if (!/^\d{1,4}$/.test(flight)) invalid("an invalid flight number");
      const depart = text(
        departure.date,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)?$/,
      );
      const arrive = text(
        arrival.date,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)?$/,
      );
      if (
        !Number.isFinite(Date.parse(depart)) ||
        !Number.isFinite(Date.parse(arrive))
      )
        invalid("an invalid flight time");
      return {
        origin: text(departure.airport, /^[A-Z]{3}$/),
        destination: text(arrival.airport, /^[A-Z]{3}$/),
        departure: depart,
        arrival: arrive,
        airline,
        airlineName: airline === "B6" ? "JetBlue" : null,
        operatedBy: operating,
        flightNumber: `${airline}${flight}`,
        aircraft:
          typeof segment.aircraft === "string" ? segment.aircraft : null,
        // The itinerary's reference cabin does not describe each offered fare.
        cabin: null,
      };
    });
    if (
      segments[0].origin !== q.origin ||
      segments.at(-1)?.destination !== q.dest ||
      segments[0].departure?.slice(0, 10) !== q.departDate ||
      segments.some(
        (segment, i) => i > 0 && segments[i - 1].destination !== segment.origin,
      )
    )
      invalid("an incomplete or different itinerary");
    const duration = numeric(journey.totalDuration);
    if (duration <= 0) invalid("an invalid flight duration");
    const key = segments
      .map(
        (s) =>
          `${s.origin}-${s.destination}:${s.flightNumber}@${s.departure}/${s.arrival}`,
      )
      .join("|");
    if (seen.has(key)) invalid("duplicate itinerary records");
    seen.add(key);
    const fares: ParsedFare[] = [];
    for (const entry of array(product.offers)) {
      const offer = object(entry);
      if (typeof offer.soldOut !== "boolean")
        invalid("unknown fare availability");
      if (offer.soldOut) continue;
      const seats = numeric(object(offer.seatsRemaining).count);
      if (!Number.isInteger(seats)) invalid("an invalid seat count");
      if (seats < q.pax) continue;
      const brand = text(object(offer.brand).brandId, /^[A-Z0-9_-]{1,20}$/);
      const code = sourceCabin(offer.cabinClass);
      const parts = array(offer.offerSegmentInfo).map(object);
      if (parts.length !== segments.length)
        invalid("missing per-segment fare information");
      const segmentCabins: Cabin[] = [],
        segmentFares: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const ref = `#/data/searchResults/0/productOffers/${productIndex}/originAndDestination/0/flightSegments/${i}`;
        const matches = parts.filter(
          (part) => object(object(part.ref).flightSegment).$ref === ref,
        );
        if (matches.length !== 1)
          invalid("an inconsistent flight-to-fare reference");
        segmentCabins.push(sourceCabin(matches[0].cabinClass));
        segmentFares.push(
          `${text(matches[0].bookingClass, /^[A-Z0-9]{1,3}$/)}:${text(matches[0].fareBasis, /^[A-Z0-9/-]{1,30}$/)}`,
        );
      }
      if (
        !segmentCabins.includes(code) ||
        segmentCabins.some(
          (c) => CABIN_ORDER.indexOf(c) > CABIN_ORDER.indexOf(code),
        )
      )
        invalid("inconsistent cabin information");
      const amounts = array(offer.price).map(object);
      const pointAmounts = amounts.filter((p) => p.currency === "FFCURRENCY");
      const cashAmounts = amounts.filter((p) => p.currency !== "FFCURRENCY");
      if (pointAmounts.length !== (award ? 1 : 0) || cashAmounts.length !== 1)
        invalid("an ambiguous payment quote");
      const points = award ? numeric(pointAmounts[0].amount) : null;
      if (award && !points) invalid("an invalid points price");
      const currency = text(cashAmounts[0].currency, /^[A-Z]{3}$/),
        cash = numeric(cashAmounts[0].amount);
      fares.push({
        identity: `${brand}:${code}:${segmentCabins.join(",")}:${segmentFares.join("|")}`,
        brand,
        cabin: code,
        segmentCabins,
        points,
        cash,
        currency,
        seats,
      });
    }
    return { key, segments, duration, fares };
  });
}

/** Preserve every eligible offer, including mixed-cabin connections and Flex fares. Prices are per adult. */
export function parseJetBlueFlights(
  payload: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  return parseInventory(payload, q, true)
    .filter((row) => row.fares.length)
    .map((row) => {
      const fares: AwardPrice[] = row.fares.map((fare) => ({
        fareId: hash(fare.identity),
        fareName: fareNames[fare.brand] ?? `Fare ${fare.brand}`,
        refundable: refundability(fare.brand),
        cabin: fare.cabin,
        segmentCabins: fare.segmentCabins,
        points: fare.points!,
        cash: fare.cash,
        currency: fare.currency,
        seats: fare.seats,
        mixedCabin: fare.segmentCabins.some((c) => c !== fare.cabin),
      }));
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
        id: `B6_${hash(row.key)}`,
        programId: "B6_TRUEBLUE",
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        kind: "flight",
        segments: row.segments,
        duration: row.duration,
        prices,
        fares,
        source: "JetBlue",
        freshness: "live",
        observedAt,
        bookingUrl: bookingUrl("B6_TRUEBLUE", q),
      };
    });
}

export function attachJetBlueCash(
  rows: AwardResult[],
  payload: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const cashByFlight = new Map(
    parseInventory(payload, q, false).map((row) => [
      `B6_${hash(row.key)}`,
      row.fares,
    ]),
  );
  const url = new URL(bookingUrl("B6_TRUEBLUE", q));
  url.searchParams.set("usePoints", "false");
  return rows.map((row) => {
    const candidates = cashByFlight.get(row.id) ?? [];
    const enrich = (price: AwardPrice): AwardPrice => {
      // Exact flights, times, fare family, fare basis, booking classes and cabins.
      const cash = candidates
        .filter(
          (f) =>
            hash(f.identity) === price.fareId && f.currency === price.currency,
        )
        .sort((a, b) => a.cash - b.cash)[0];
      return cash
        ? {
            ...price,
            cashFare: {
              amount: cash.cash,
              currency: cash.currency,
              fareName: fareNames[cash.brand] ?? `Fare ${cash.brand}`,
              refundable: refundability(cash.brand),
              observedAt,
              bookingUrl: url.toString(),
            },
          }
        : price;
    };
    return {
      ...row,
      fares: row.fares?.map(enrich),
      prices: Object.fromEntries(
        Object.entries(row.prices).map(([code, price]) => [
          code,
          enrich(price),
        ]),
      ),
    };
  });
}

export async function jetblueSearch(
  q: SearchQuery,
  signal: AbortSignal,
  onRows?: (rows: AwardResult[]) => void,
): Promise<AwardResult[]> {
  validateQuery(q);
  signal.throwIfAborted();
  const opts = {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    cache: "no-store" as const,
    redirect: "error" as const,
  };
  const bootstrap = await fetch(bootstrapUrl, {
    ...opts,
    headers: { Accept: "text/html" },
  });
  if (!bootstrap.ok)
    throw new ProviderError(
      `JetBlue's booking service is unavailable (HTTP ${bootstrap.status}).`,
      bootstrap.status,
    );
  const key = jetbluePublicKey(await bootstrap.text());
  const request = async (award: boolean) => {
    const res = await fetch(searchUrl, {
      ...opts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Application-Channel": "Desktop_Web",
        "ocp-apim-subscription-key": key,
        Origin: "https://www.jetblue.com",
        Referer: bootstrapUrl,
      },
      body: JSON.stringify(jetblueRequest(q, award)),
    });
    if (!res.ok)
      throw new ProviderError(
        `JetBlue's flight search is unavailable (HTTP ${res.status}).`,
        res.status,
      );
    return { data: await res.json(), at: new Date().toISOString() };
  };
  const cashTask = request(false).catch(() => null);
  const awards = await request(true);
  const rows = parseJetBlueFlights(awards.data, q, awards.at);
  signal.throwIfAborted();
  onRows?.(rows);
  const cash = await cashTask;
  signal.throwIfAborted();
  if (cash) {
    try {
      return attachJetBlueCash(rows, cash.data, q, cash.at);
    } catch {
      /* An unavailable or changed cash response never hides valid awards. */
    }
  }
  return rows;
}
