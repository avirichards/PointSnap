import { createHash, randomUUID } from "node:crypto";
import { bookingUrl } from "@/lib/bookingHandoff";
import { CABIN_ORDER, type Cabin, type SearchQuery } from "@/lib/types";
import {
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

const airlineOrigin = "https://www.aeromexico.com";
const metadataOrigin = "https://amx-c-mtpsbk-pd.aeromexico.com";
const searchUrl =
  "https://amx-c-bkngbk-pd.aeromexico.com/bc/ow/search/flight/points";
// This is the current public client's literal unauthenticated marker, not a token.
const publicAuthorization =
  "Atmosphere realm=http://atmosphere,atmosphere_app_id=WorkAndCoApp, atmosphere_signature_method=NONE";
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProviderError("Aeromexico returned unreadable award inventory.");
  return value as RecordValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new ProviderError("Aeromexico returned an incomplete flight list.");
  return value;
}
function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new ProviderError("Aeromexico returned an invalid award quote.");
  return value;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new ProviderError(
      "Aeromexico returned unrecognized flight information.",
    );
  return value;
}
function validateQuery(q: SearchQuery): void {
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
    q.pax > 9 ||
    !CABIN_ORDER.includes(q.minCabin)
  )
    throw new ProviderError(
      "Aeromexico needs a valid route, date, cabin and one to nine adults.",
      400,
    );
}
function sourceCabin(value: unknown): Cabin {
  // AM Plus is extra-legroom seating in Economy, not Premium Economy.
  if (value === "MAIN" || value === "AM_PLUS") return "Y";
  if (value === "BUSINESS") return "J";
  throw new ProviderError("Aeromexico returned an unrecognized award cabin.");
}
function fareName(fare: RecordValue): string {
  const family = text(fare.fareFamily, /^[A-Z][A-Z0-9_]*$/);
  const name = family
    .replace(/^AMPLUS_/, "AM Plus ")
    .replace(/^MAIN_/, "Main ")
    .replace(/^PREMIER_/, "Premier ")
    .replaceAll("_", " ")
    .replace(/\b[A-Z]{2,}\b/g, (word) => word[0] + word.slice(1).toLowerCase())
    .replace(/^Am Plus /, "AM Plus ");
  return `${name} · ${fare.ticketType === "CLASSIC" ? "Classic award" : "Dynamic award"}`;
}
export function aeromexicoBookingUrl(q: SearchQuery): string {
  validateQuery(q);
  return bookingUrl("AM_CLUB_PREMIER", q);
}

/** All returned one-way itineraries and eligible source fares; prices are per adult. */
export function parseAeromexico(
  data: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  validateQuery(q);
  const source = object(data);
  const currency = text(source.currencyCode, /^[A-Z]{3}$/);
  if (array(source.warnings).length)
    throw new ProviderError(
      "Aeromexico returned warnings; complete award availability could not be confirmed.",
    );
  const conversion = array(source.conversionInfo).map(object);
  if (
    !conversion.some(
      (item) => item.legCode === `${q.origin}_${q.dest}_${q.departDate}`,
    )
  )
    throw new ProviderError(
      "Aeromexico returned a different award route or date.",
    );
  const results: AwardResult[] = [],
    seen = new Set<string>();
  for (const entry of array(source.outbound)) {
    const itinerary = object(entry),
      legs = array(itinerary.legCollection).map(object);
    const segments: AwardSegment[] = [];
    let duration = 0;
    for (const leg of legs) {
      const sourceSegments = array(leg.segments).map(object);
      if (!sourceSegments.length)
        throw new ProviderError("Aeromexico omitted an itinerary segment.");
      let legDuration = 0;
      for (const segment of sourceSegments) {
        const airline = text(segment.marketingCarrier, /^[A-Z0-9]{2}$/);
        const operatedBy = text(segment.operatingCarrier, /^[A-Z0-9]{2}$/);
        const number = String(segment.marketingFlightCode ?? "");
        if (!/^\d{1,4}$/.test(number))
          throw new ProviderError("Aeromexico omitted a flight number.");
        const departure = text(
          segment.departureDateTime,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        );
        const arrival = text(
          segment.arrivalDateTime,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        );
        if (
          !Number.isFinite(Date.parse(departure)) ||
          !Number.isFinite(Date.parse(arrival))
        )
          throw new ProviderError(
            "Aeromexico returned an invalid flight time.",
          );
        legDuration +=
          numeric(segment.duration) + numeric(segment.layoverDuration);
        segments.push({
          origin: text(segment.departureAirport, /^[A-Z]{3}$/),
          destination: text(segment.arrivalAirport, /^[A-Z]{3}$/),
          departure,
          arrival,
          airline,
          airlineName: airline === "AM" ? "Aeromexico" : null,
          operatedBy,
          flightNumber: `${airline}${number}`,
          aircraft:
            typeof segment.aircraftType === "string"
              ? segment.aircraftType
              : null,
          // The source segment bookingClass belongs to a reference fare. Other
          // fare families can use a different cabin, so do not copy it to all fares.
          cabin: null,
        });
      }
      const quotedDuration = numeric(leg.totalFlightDuration);
      if (quotedDuration <= 0 || Math.abs(quotedDuration - legDuration) > 1)
        throw new ProviderError(
          "Aeromexico returned inconsistent itinerary duration.",
        );
      duration += quotedDuration;
    }
    if (
      !segments.length ||
      segments[0].origin !== q.origin ||
      segments.at(-1)?.destination !== q.dest ||
      segments[0].departure?.slice(0, 10) !== q.departDate ||
      segments.some(
        (segment, index) =>
          index > 0 && segment.origin !== segments[index - 1].destination,
      )
    )
      throw new ProviderError(
        "Aeromexico returned an incomplete or different itinerary.",
      );
    const key = segments
      .map(
        (segment) =>
          `${segment.origin}-${segment.destination}-${segment.flightNumber}@${segment.departure}`,
      )
      .join("|");
    if (seen.has(key))
      throw new ProviderError("Aeromexico returned duplicate itinerary data.");
    seen.add(key);
    const prices: AwardResult["prices"] = {},
      fares: AwardPrice[] = [];
    for (const value of array(itinerary.fares)) {
      const fare = object(value),
        quote = object(fare.currency);
      if (fare.unavailable === true || fare.isCabinHidden === true) continue;
      const cabin = sourceCabin(fare.cabinClass),
        points = numeric(quote.points);
      if (
        points === 0 ||
        CABIN_ORDER.indexOf(cabin) < CABIN_ORDER.indexOf(q.minCabin)
      )
        continue;
      if (
        !Number.isSafeInteger(points) ||
        !["DYNAMIC", "CLASSIC"].includes(String(fare.ticketType))
      )
        throw new ProviderError(
          "Aeromexico returned an unrecognized award fare.",
        );
      // A missing/zero source count is not proof of no seats. Positive counts
      // below the requested party cannot be presented as available for that party.
      const seatCount =
        fare.seatsRemaining == null ? null : numeric(fare.seatsRemaining);
      if (seatCount !== null && !Number.isSafeInteger(seatCount))
        throw new ProviderError(
          "Aeromexico returned an invalid award seat count.",
        );
      const seats = seatCount && seatCount > 0 ? seatCount : null;
      if (seats !== null && seats < q.pax) continue;
      const sourceId = String(fare.fareId ?? "");
      if (!/^-?\d+$/.test(sourceId))
        throw new ProviderError("Aeromexico omitted a fare identifier.");
      const price: AwardPrice = {
        fareId: `${sourceId}:${String(fare.brandId ?? "")}`,
        fareName: fareName(fare),
        cabin,
        points,
        quotedPassengers: q.pax,
        // The current renderer directly selects totalCash when TUA is included.
        // It already includes taxes/TUA and booking fee; never add those again.
        cash: numeric(quote.totalCash),
        currency,
        seats,
        mixedCabin: false,
        refundable: null,
        segmentCabins: segments.map(() =>
          segments.length === 1 ? cabin : null,
        ),
      };
      fares.push(price);
      const best = prices[cabin];
      if (
        !best ||
        price.points < best.points ||
        (price.points === best.points && price.cash! < best.cash!)
      )
        prices[cabin] = price;
    }
    if (!fares.length) continue;
    results.push({
      id: `AM_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
      programId: "AM_CLUB_PREMIER",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration,
      prices,
      fares,
      source: "Aeromexico Rewards · direct airline",
      freshness: "live",
      observedAt,
      bookingUrl: aeromexicoBookingUrl(q),
    });
  }
  return results;
}

export async function aeromexicoSearch(
  q: SearchQuery,
  outerSignal: AbortSignal,
): Promise<AwardResult[]> {
  validateQuery(q);
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(45000)]);
  const bookingUrl = aeromexicoBookingUrl(q);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: publicAuthorization,
    "cache-control": "no-cache",
    access_type: "client_credentials",
    "Strict-Transport-Security": "max-age=300; includeSubDomains",
    "x-transactionId": randomUUID(),
    channel: "web",
    Origin: airlineOrigin,
    Referer: bookingUrl,
  };
  async function request(
    url: string,
    extra: Record<string, string>,
    body?: unknown,
  ): Promise<RecordValue> {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      signal,
      cache: "no-store",
      redirect: "error",
      headers: { ...headers, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new ProviderError(
        `Aeromexico award search is unavailable (HTTP ${response.status}).`,
        response.status,
      );
    try {
      return object(await response.json());
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "Aeromexico did not return its award flight list.",
      );
    }
  }
  // Current newFetchApi needs no member login, grant token, or browser cookies.
  const [pcc, region] = await Promise.all([
    request(`${metadataOrigin}/tc/pcc/getPccInfo`, {
      project: "BOOKING",
      storeFront: "MX_PP",
    }),
    request(`${metadataOrigin}/tc/region/regionByRoute`, {
      departure: q.origin,
      arrival: q.dest,
    }),
  ]);
  if (
    pcc.isoCountry !== "MX_PP" ||
    region.airportOriginDestination !== q.origin + q.dest
  )
    throw new ProviderError(
      "Aeromexico returned a different search market or route.",
    );
  const currency = text(pcc.currency, /^[A-Z]{3}$/);
  const data = await request(
    searchUrl,
    {
      cityCode: text(pcc.jipcc, /^[A-Z0-9]+$/),
      currency,
      isNewBF: "true",
      itinerary: `${q.origin}_${q.dest}_${q.departDate}`,
      language: "ES",
      legRegion: text(region.subRegionFinal, /^[A-Z0-9]+$/),
      locale: text(pcc.mappedTo, /^[A-Z0-9]+$/),
      promoCodes: "RED22",
      store: "MX",
      travelers: `A${q.pax}_C0_I0_PH0_PC0`,
    },
    {
      accountNumber: "",
      arrivalAirportLoyaltyZone: text(
        region.arrivalAirportLoyaltyZone,
        /^[A-Z0-9]+$/,
      ),
      arrivalAirportRegion: text(region.subRegionDestination, /^[A-Z0-9]+$/),
      cobrandCard: "",
      departureAirportLoyaltyZone: text(
        region.departureAirportLoyaltyZone,
        /^[A-Z0-9]+$/,
      ),
      departureAirportRegion: text(region.subRegionOrigin, /^[A-Z0-9]+$/),
      planMultiplica: "",
      promoCode: "",
      tier: "",
    },
  );
  if (data.currencyCode !== currency)
    throw new ProviderError("Aeromexico returned a different quote currency.");
  return parseAeromexico(data, q);
}
