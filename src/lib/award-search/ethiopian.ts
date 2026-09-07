import { createHash, randomUUID } from "node:crypto";
import { bookingUrl } from "@/lib/bookingHandoff";
import { CABIN_ORDER, type Cabin, type SearchQuery } from "@/lib/types";
import {
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

const base = "https://dxbooking.ethiopianairlines.com";
// The public booking service rejects Node's default User-Agent even for init.
const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProviderError("Ethiopian returned unreadable award inventory.");
  return value as Obj;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new ProviderError("Ethiopian returned an incomplete flight list.");
  return value;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new ProviderError(
      "Ethiopian returned unrecognized flight information.",
    );
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new ProviderError("Ethiopian returned an invalid award quote.");
  return value;
}
function sourceCabin(value: unknown): Cabin {
  if (value === "Economy") return "Y";
  if (value === "Business") return "J";
  throw new ProviderError("Ethiopian returned an unrecognized award cabin.");
}
function validate(q: SearchQuery) {
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
      "Ethiopian needs a valid route, date, cabin and one to nine adults.",
      400,
    );
}
function localTime(value: unknown): string {
  const s = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  if (
    !Number.isFinite(Date.parse(`${s}Z`)) ||
    new Date(`${s}Z`).toISOString().slice(0, 19) !== s
  )
    throw new ProviderError("Ethiopian returned an invalid flight time.");
  return s;
}
function time(value: unknown, offset: unknown): string {
  return localTime(value) + text(offset, /^[+-](?:0\d|1[0-4]):[0-5]\d$/);
}
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 24);

/** Sabre's JSON graph shares itinerary parts/segments with @id and @ref. */
function references(root: Obj) {
  const index = new Map<string, Obj>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value)) {
      const o = value as Obj;
      if (typeof o["@id"] === "string") {
        if (index.has(o["@id"]))
          throw new ProviderError(
            "Ethiopian returned conflicting flight references.",
          );
        index.set(o["@id"], o);
      }
    }
    Object.values(value).forEach(visit);
  }
  visit(root);
  return (value: unknown): Obj => {
    const o = object(value);
    if (o["@ref"] === undefined) return o;
    const resolved = index.get(String(o["@ref"]));
    if (!resolved)
      throw new ProviderError("Ethiopian omitted a referenced flight segment.");
    return resolved;
  };
}

/** All exact-date offers, not the neighboring dates' lowest-price calendar summaries. */
export function parseEthiopian(
  data: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  validate(q);
  const root = object(data),
    resolve = references(root);
  const meta = object(root.searchResultMetaData);
  if (
    meta.branded !== true ||
    meta.composedResult !== false ||
    meta.contextShopping !== false ||
    array(root.bundledOffers).length ||
    array(root.warnings).length
  )
    throw new ProviderError(
      "Ethiopian returned warnings or an unsupported inventory format; completeness could not be confirmed.",
    );
  const groups = array(root.unbundledOffers);
  if (groups.length > 1)
    throw new ProviderError("Ethiopian returned a different journey type.");
  const offers = groups.flatMap(array).map(object);
  // Branded mode renders these same offers grouped by itinerary. Include any
  // extra supplied brands, then deduplicate by source fare identity below.
  const branded = object(root.brandedResults);
  for (const group of array(branded.itineraryPartBrands)) {
    for (const value of array(group)) {
      const part = object(value);
      for (const offer of array(part.brandOffers))
        offers.push({ ...object(offer), itineraryPart: [part.itineraryPart] });
    }
  }
  const families = new Map(
    array(root.fareFamilies).map((value) => {
      const family = object(value);
      const labels = array(family.brandLabel).map(object);
      const label = labels.find((l) => l.languageId === "en_GB") ?? labels[0];
      return [String(family.brandId), label?.marketingText];
    }),
  );
  const rows = new Map<string, AwardResult>(),
    seen = new Set<string>();
  for (const offer of offers) {
    if (offer.soldout === true) continue;
    if (offer.soldout !== false)
      throw new ProviderError("Ethiopian omitted award availability.");
    const parts = array(offer.itineraryPart).map(resolve);
    if (parts.length !== 1)
      throw new ProviderError("Ethiopian returned a different journey type.");
    const part = parts[0],
      sourceSegments = array(part.segments).map(resolve);
    const segments: AwardSegment[] = sourceSegments.map((s) => {
      const flight = resolve(s.flight);
      if (object(s.segmentOfferInformation).awardFare !== true)
        throw new ProviderError(
          "Ethiopian returned a fare that is not an award.",
        );
      const airline = text(flight.airlineCode, /^[A-Z0-9]{2}$/);
      const operatingAirline = text(
        flight.operatingAirlineCode,
        /^[A-Z0-9]{2}$/,
      );
      const flightNumber = text(String(flight.flightNumber), /^\d{1,4}$/);
      const operatingNumber = text(
        String(flight.operatingFlightNumber),
        /^\d{1,4}$/,
      );
      const technicalStops = array(flight.stopAirports).map((value) => {
        const stop = resolve(value);
        return {
          airport: text(stop.airport, /^[A-Z]{3}$/),
          arrival: localTime(stop.arrival),
          departure: localTime(stop.departure),
          duration: number(stop.duration),
        };
      });
      const departure = time(s.departure, s.departureGMTOffset),
        arrival = time(s.arrival, s.arrivalGMTOffset);
      if (
        (Date.parse(arrival) - Date.parse(departure)) / 60000 !==
        number(s.duration)
      )
        throw new ProviderError(
          "Ethiopian returned inconsistent flight duration.",
        );
      return {
        origin: text(s.origin, /^[A-Z]{3}$/),
        destination: text(s.destination, /^[A-Z]{3}$/),
        departure,
        arrival,
        airline,
        airlineName: airline === "ET" ? "Ethiopian Airlines" : null,
        operatingAirline,
        operatingFlightNumber: `${operatingAirline}${operatingNumber}`,
        operatedBy:
          typeof s.aircraftLeaseText === "string"
            ? s.aircraftLeaseText.replace(/^\//, "").trim()
            : operatingAirline,
        flightNumber: `${airline}${flightNumber}`,
        aircraft: typeof s.equipment === "string" ? s.equipment : null,
        cabin: sourceCabin(s.cabinClass),
        ...(technicalStops.length ? { technicalStops } : {}),
      };
    });
    if (
      !segments.length ||
      segments[0].origin !== q.origin ||
      segments.at(-1)?.destination !== q.dest ||
      segments[0].departure?.slice(0, 10) !== q.departDate ||
      segments.some(
        (s, i) =>
          i > 0 &&
          (s.origin !== segments[i - 1].destination ||
            Date.parse(s.departure!) < Date.parse(segments[i - 1].arrival!)),
      )
    )
      throw new ProviderError(
        "Ethiopian returned an incomplete or different route or date.",
      );
    const duration = number(part.totalDuration);
    if (
      (Date.parse(segments.at(-1)!.arrival!) -
        Date.parse(segments[0].departure!)) /
        60000 !==
        duration ||
      number(part.stops) !==
        segments.length -
          1 +
          segments.reduce((n, s) => n + (s.technicalStops?.length ?? 0), 0)
    )
      throw new ProviderError(
        "Ethiopian returned inconsistent itinerary duration or stops.",
      );
    const cabin = sourceCabin(offer.cabinClass);
    if (CABIN_ORDER.indexOf(cabin) < CABIN_ORDER.indexOf(q.minCabin)) continue;
    const seats =
      offer.seatsRemaining == null
        ? null
        : number(object(offer.seatsRemaining).count);
    if (seats !== null && !Number.isSafeInteger(seats))
      throw new ProviderError("Ethiopian returned an invalid seat count.");
    if (seats !== null && seats < q.pax) continue;
    const key = hash(
      JSON.stringify(
        segments.map((s) => [
          s.origin,
          s.destination,
          s.flightNumber,
          s.departure,
          s.arrival,
        ]),
      ),
    );
    const sourceId = text(String(offer.shoppingBasketHashCode), /^-?\d+$/);
    const alternatives = array(object(offer.total).alternatives);
    if (!alternatives.length)
      throw new ProviderError("Ethiopian omitted an award price.");
    if (
      !alternatives.some((value) =>
        array(value).some((amount) => object(amount).currency === "FFCURRENCY"),
      )
    )
      throw new ProviderError(
        "Ethiopian omitted award miles from an available fare.",
      );
    for (const [index, value] of alternatives.entries()) {
      const amounts = array(value).map(object);
      const miles = amounts.filter((a) => a.currency === "FFCURRENCY");
      if (!miles.length) continue; // A cash-only alternative is not an award.
      const partyPoints = miles.reduce((n, a) => n + number(a.amount), 0);
      if (!Number.isSafeInteger(partyPoints) || partyPoints <= 0)
        throw new ProviderError("Ethiopian returned invalid award miles.");
      const money = amounts.filter((a) => a.currency !== "FFCURRENCY");
      const currencies = [
        ...new Set(money.map((a) => text(a.currency, /^[A-Z]{3}$/))),
      ];
      if (currencies.length > 1)
        throw new ProviderError(
          "Ethiopian returned an unsupported multi-currency quote.",
        );
      const fareId = `${sourceId}:${String(offer.brandId)}:${cabin}:${index}`;
      const identity = `${key}:${fareId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const price: AwardPrice = {
        fareId,
        fareName:
          typeof families.get(String(offer.brandId)) === "string"
            ? String(families.get(String(offer.brandId)))
                .toLowerCase()
                .replace(/\b\w/g, (c) => c.toUpperCase())
            : `${cabin === "Y" ? "Economy" : "Business"} award`,
        cabin,
        points: partyPoints / q.pax,
        partyPoints,
        quotedPassengers: q.pax,
        // Empty taxes/FFCURRENCY-only totals do not establish zero cash fees.
        cash: money.length
          ? money.reduce((n, a) => n + number(a.amount), 0) / q.pax
          : null,
        currency: currencies[0] ?? null,
        seats,
        mixedCabin: segments.some((s) => s.cabin !== cabin),
        refundable: null,
        segmentCabins: segments.map((s) => s.cabin ?? null),
        bookingClasses: sourceSegments.map((s) =>
          text(s.bookingClass, /^[A-Z0-9]{1,2}$/),
        ),
      };
      const row: AwardResult = rows.get(key) ?? {
        id: `et:${key}`,
        programId: "ET_SHEBAMILES",
        origin: q.origin,
        destination: q.dest,
        date: q.departDate,
        kind: "flight",
        segments,
        duration,
        fares: [],
        prices: {},
        source: "Ethiopian ShebaMiles",
        freshness: "live",
        observedAt,
        bookingUrl: bookingUrl("ET_SHEBAMILES", q),
      };
      row.fares!.push(price);
      const best = row.prices[cabin];
      if (
        !best ||
        price.points < best.points ||
        (price.points === best.points &&
          (price.cash ?? Infinity) < (best.cash ?? Infinity))
      )
        row.prices[cabin] = price;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

/** Fresh anonymous shopping session. No stored user cookies, login, or paid service. */
export async function ethiopianSearch(
  q: SearchQuery,
  outerSignal: AbortSignal,
  onRows?: (rows: AwardResult[]) => void,
): Promise<AwardResult[]> {
  validate(q);
  // The current airline booking form offers exactly Economy and Business.
  const cabins = ["Economy", "Business"].filter(
    (c) =>
      CABIN_ORDER.indexOf(sourceCabin(c)) >= CABIN_ORDER.indexOf(q.minCabin),
  );
  if (!cabins.length) return [];
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(50000)]);
  const cookies = new Map<
    string,
    { name: string; value: string; path: string; expires: number }
  >();
  async function request(
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) {
    const url = new URL(path, base);
    const cookie = [...cookies.values()]
      .filter(
        (c) =>
          c.expires > Date.now() &&
          (path === c.path ||
            path.startsWith(c.path.endsWith("/") ? c.path : `${c.path}/`)),
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      signal,
      cache: "no-store",
      redirect: "error",
      headers: {
        "User-Agent": userAgent,
        ...headers,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const attrs = new Map(
        attributes.map((v) => {
          const i = v.indexOf("=");
          return [
            v
              .slice(0, i < 0 ? undefined : i)
              .trim()
              .toLowerCase(),
            i < 0 ? "" : v.slice(i + 1).trim(),
          ];
        }),
      );
      const domain = attrs.get("domain")?.replace(/^\./, "").toLowerCase();
      if (
        domain &&
        url.hostname !== domain &&
        !url.hostname.endsWith(`.${domain}`)
      )
        continue;
      const cookiePath = attrs.get("path")?.startsWith("/")
        ? attrs.get("path")!
        : path.slice(0, path.lastIndexOf("/")) || "/";
      const maxAge = attrs.has("max-age") ? Number(attrs.get("max-age")) : NaN;
      const expiry = Date.parse(attrs.get("expires") ?? "");
      const expires = Number.isFinite(maxAge)
        ? Date.now() + maxAge * 1000
        : Number.isFinite(expiry)
          ? expiry
          : Infinity;
      const name = pair.slice(0, eq);
      cookies.set(`${cookiePath}:${name}`, {
        name,
        value: pair.slice(eq + 1),
        path: cookiePath,
        expires,
      });
    }
    if (!response.ok)
      throw new ProviderError(
        `Ethiopian award search is unavailable (HTTP ${response.status}).`,
        response.status,
      );
    return response;
  }
  const html = await (await request("/dx/ETDX/")).text();
  const cid = html.match(/sabre\[['"]cid['"]\]\s*=\s*['"]([^'"]+)/)?.[1];
  const appId = html.match(/sabre\[['"]appId['"]\]\s*=\s*['"]([^'"]*)/)?.[1];
  if (!cid)
    throw new ProviderError(
      "Ethiopian did not initialize anonymous award shopping.",
    );
  let execution = "";
  const requestId = randomUUID();
  async function gql(
    operationName: string,
    query: string,
    variables: Obj = {},
  ) {
    const response = await request(
      "/api/graphql",
      {
        "Content-Type": "application/json",
        Accept: "*/*",
        Origin: base,
        Referer: `${base}/dx/ETDX/`,
        "x-sabre-storefront": "ETDX",
        "x-sabre-path": "DC",
        "x-sabre-flow": "b2c",
        "x-request-id": requestId,
        "conversation-id": cid!,
        ...(appId ? { "application-id": appId } : {}),
        execution,
      },
      { operationName, query, variables },
    );
    execution = response.headers.get("execution") || execution;
    let data: Obj;
    try {
      data = object(await response.json());
    } catch {
      throw new ProviderError(
        "Ethiopian did not return its award flight response.",
      );
    }
    if (
      (Array.isArray(data.errors) && data.errors.length) ||
      (data.extensions && array(object(data.extensions).errors ?? []).length)
    )
      throw new ProviderError(
        "Ethiopian could not complete anonymous award shopping. Try again shortly.",
      );
    const original = object(object(data.data)[operationName]).originalResponse;
    if (typeof original !== "string" || original === "") return original;
    try {
      return JSON.parse(original);
    } catch {
      throw new ProviderError("Ethiopian returned unreadable award inventory.");
    }
  }
  await gql("init", "query init { init { originalResponse } }");
  const rows = new Map<string, AwardResult>();
  for (const cabinClass of cabins) {
    // Sequential requests share only this search's execution key, as when the
    // airline's user changes cabin. Parallel searches receive separate sessions.
    const data = await gql(
      "bookingAirSearch",
      "query bookingAirSearch($airSearchInput: CustomAirSearchInput) { bookingAirSearch(airSearchInput: $airSearchInput) { originalResponse } }",
      {
        airSearchInput: {
          cabinClass,
          awardBooking: true,
          currency: "USD",
          searchType: "BRANDED",
          itineraryParts: [
            {
              from: { useNearbyLocations: false, code: q.origin },
              to: { useNearbyLocations: false, code: q.dest },
              when: { date: q.departDate },
            },
          ],
          passengers: { ADT: q.pax },
        },
      },
    );
    for (const row of parseEthiopian(data, q)) {
      const prior = rows.get(row.id);
      rows.set(
        row.id,
        prior
          ? {
              ...row,
              fares: [...prior.fares!, ...row.fares!],
              prices: { ...prior.prices, ...row.prices },
            }
          : row,
      );
    }
    signal.throwIfAborted();
    if (rows.size) onRows?.([...rows.values()]);
  }
  return [...rows.values()];
}
