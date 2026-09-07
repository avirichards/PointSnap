import { createHash } from "node:crypto";
import { load } from "cheerio/slim";
import type { SearchQuery } from "@/lib/types";
import { bookingUrl } from "@/lib/bookingHandoff";
import {
  ProviderError,
  type AwardPrice,
  type AwardResult,
  type AwardSegment,
} from "./types";

const bookingOrigin = "https://booking.flyfrontier.com";
const publicOrigin = "https://www.flyfrontier.com";
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProviderError("Frontier returned an unreadable flight list.");
  return value as RecordValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new ProviderError("Frontier returned an incomplete flight list.");
  return value;
}
function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ProviderError("Frontier returned an unreadable award price.");
  return value;
}
function validFare(n: number) {
  return n >= 0 && n < Number.MAX_SAFE_INTEGER;
}
function validQuery(q: SearchQuery) {
  const date = new Date(q.departDate + "T00:00:00Z");
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
  )
    throw new ProviderError(
      "Frontier needs a valid route, date, and one to nine adults.",
      400,
    );
}

/** A new one-way search, never an anonymous session or selected-fare token. */
export function frontierBookingUrl(q: SearchQuery): string {
  validQuery(q);
  return bookingUrl("F9_FRONTIER_MILES", q);
}

export function extractFrontierFlightData(html: string): unknown {
  const raw = /\bFlightData\s*=\s*'([^\r\n]*?)';/.exec(html)?.[1];
  if (!raw)
    throw new ProviderError(
      "Frontier did not return its complete award flight list.",
    );
  try {
    // Decode the HTML-encoded JSON literal; never execute airline JavaScript.
    return JSON.parse(load(raw, {}, false).text());
  } catch {
    throw new ProviderError("Frontier returned unreadable award inventory.");
  }
}

/** Parse the complete embedded source list, preserving every offered bundle. */
export function parseFrontier(
  data: unknown,
  q: SearchQuery,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  validQuery(q);
  const source = object(data);
  if (
    source.originOne !== q.origin ||
    source.destinationOne !== q.dest ||
    source.departureDateOne !== `${q.departDate}T00:00:00` ||
    source.paxCount !== q.pax
  )
    throw new ProviderError(
      "Frontier returned a different route, date, or passenger count.",
    );
  if (
    source.fareTypeBy !== "Miles" ||
    source.includeLoyalty !== true ||
    source.includeMonetary !== false ||
    source.isRoundTrip !== false ||
    source.isChangeFlight !== false ||
    source.isCodeShareFlight !== false
  )
    throw new ProviderError(
      "Frontier did not return the requested one-way award inventory.",
    );
  const journeys = array(source.journeys);
  if (journeys.length !== 1)
    throw new ProviderError("Frontier returned an unexpected set of journeys.");
  const journey = object(journeys[0]);
  if (
    journey.isMilesBooking !== true ||
    journey.isReturnTrip !== false ||
    journey.departureStation !== q.origin ||
    journey.arrivalStation !== q.dest
  )
    throw new ProviderError("Frontier returned an unexpected award journey.");
  // USD is explicit in the domestic site's fare renderer. International currency
  // and partner cabin semantics have not been verified, so fail closed there.
  if (journey.isInternational !== false)
    throw new ProviderError(
      "Frontier international award currency is not verified yet.",
    );
  const seen = new Set<string>();
  const rows: AwardResult[] = [];
  for (const entry of array(journey.flights)) {
    const flight = object(entry);
    if (flight.isMonetary !== false)
      throw new ProviderError(
        "Frontier returned cash fares in an award flight list.",
      );
    const miles = numeric(flight.standardFare),
      cash = numeric(flight.milesFare);
    if (!validFare(miles) || miles === 0 || !flight.milesFareKey) continue;
    if (!Number.isSafeInteger(miles) || !validFare(cash))
      throw new ProviderError("Frontier returned an invalid miles quote.");
    const legs = array(flight.legs).map(object);
    const utc: { departure: number; arrival: number }[] = [];
    const segments: AwardSegment[] = legs.map((leg) => {
      const departure = String(leg.departureDate ?? ""),
        arrival = String(leg.arrivalDate ?? "");
      const departureUtc = String(leg.departureDateUtc ?? ""),
        arrivalUtc = String(leg.arrivalDateUtc ?? "");
      const origin = String(leg.departureStation ?? ""),
        destination = String(leg.arrivalStation ?? "");
      const flightNumber = String(leg.flightNumber ?? "");
      if (
        leg.carrierCode !== "F9" ||
        !/^\d{1,4}$/.test(flightNumber) ||
        !/^[A-Z]{3}$/.test(origin) ||
        !/^[A-Z]{3}$/.test(destination) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(departure) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(arrival) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(departureUtc) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(arrivalUtc) ||
        !Number.isFinite(Date.parse(departureUtc)) ||
        !Number.isFinite(Date.parse(arrivalUtc)) ||
        Date.parse(arrivalUtc) <= Date.parse(departureUtc)
      )
        throw new ProviderError(
          "Frontier returned an unrecognized flight segment.",
        );
      utc.push({
        departure: Date.parse(departureUtc),
        arrival: Date.parse(arrivalUtc),
      });
      return {
        origin,
        destination,
        departure,
        arrival,
        airline: "F9",
        airlineName: "Frontier Airlines",
        flightNumber: `F9${flightNumber}`,
        cabin: "Y",
      };
    });
    if (
      !segments.length ||
      segments[0].origin !== q.origin ||
      segments.at(-1)?.destination !== q.dest ||
      segments[0].departure?.slice(0, 10) !== q.departDate ||
      flight.stopCount !== segments.length - 1 ||
      segments.some(
        (segment, i) =>
          i > 0 &&
          (segment.origin !== segments[i - 1].destination ||
            utc[i].departure < utc[i - 1].arrival),
      )
    )
      throw new ProviderError(
        "Frontier did not supply a complete connecting itinerary.",
      );
    const duration = (utc.at(-1)!.arrival - utc[0].departure) / 60000;
    const sourceDuration = /^(\d+) hrs (\d+) min$/.exec(
      String(flight.duration),
    );
    if (
      !sourceDuration ||
      Number(sourceDuration[1]) * 60 + Number(sourceDuration[2]) !== duration
    )
      throw new ProviderError(
        "Frontier flight duration did not match its segments.",
      );
    const key = segments
      .map((s) => `${s.flightNumber}@${s.departure}`)
      .join("|");
    if (seen.has(key))
      throw new ProviderError("Frontier returned duplicate itinerary data.");
    seen.add(key);
    const seatsValue = flight.milesFareFareSeatsRemaining;
    // Live responses use null or a literal "1 Seat Left!" label. A bare zero
    // has not been observed and could be a sentinel, so do not invent meaning.
    if (seatsValue === 0)
      throw new ProviderError(
        "Frontier returned an unrecognized award seat count.",
      );
    const seatLabel =
      typeof seatsValue === "string"
        ? /^(\d+) Seats? Left!$/.exec(seatsValue)
        : null;
    const seats =
      seatsValue == null
        ? null
        : seatLabel
          ? Number(seatLabel[1])
          : numeric(seatsValue);
    if (seats !== null && (!Number.isSafeInteger(seats) || seats < 0))
      throw new ProviderError(
        "Frontier returned an unreadable award seat count.",
      );
    if (seats !== null && seats < q.pax) continue;
    function fare(
      id: string,
      name: string,
      points: number,
      amount: number,
      unconfirmed = false,
    ): AwardPrice {
      return {
        fareId: id,
        fareName: name,
        cabin: "Y",
        points,
        quotedPassengers: q.pax,
        cash: amount,
        currency: "USD",
        seats,
        mixedCabin: false,
        refundable: null,
        segmentCabins: segments.map(() => (unconfirmed ? null : "Y")),
        ...(unconfirmed ? { cabinUnconfirmed: true } : {}),
      };
    }
    const basic = fare("basic", "Basic award", miles, cash);
    const fares: AwardPrice[] = [basic];
    const bundles = [
      ["economy", "Economy bundle", "milesBundleFareEcob"],
      ["premium", "Premium bundle", "milesBundleFarePrem"],
      ["business", "Business bundle", "milesBundleFareBusi"],
    ];
    for (const [prefix, name, milesKey] of bundles) {
      const amount = numeric(flight[`${prefix}Fare`]);
      if (!validFare(amount) || !flight[`${prefix}FareKey`]) continue;
      if (amount < cash)
        throw new ProviderError("Frontier returned an invalid bundle price.");
      const unconfirmed = prefix === "business";
      fares.push(
        fare(
          `${prefix}-cash`,
          `${name} · cash for bundle`,
          miles,
          amount,
          unconfirmed,
        ),
      );
      // Current source getFormattedMilesFare adds the base award miles to each
      // named milesBundleFare*, retaining the base cash tax quote. This is the
      // source's explicit 'use miles for bundles' alternative, not a conversion.
      const bundleMiles = numeric(flight[milesKey]);
      if (validFare(bundleMiles) && bundleMiles > 0) {
        if (!Number.isSafeInteger(bundleMiles))
          throw new ProviderError(
            "Frontier returned an invalid bundle miles price.",
          );
        fares.push(
          fare(
            `${prefix}-miles`,
            `${name} · miles for bundle`,
            miles + bundleMiles,
            cash,
            unconfirmed,
          ),
        );
      }
    }
    if (q.minCabin !== "Y") continue;
    rows.push({
      id: `F9_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
      programId: "F9_FRONTIER_MILES",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration,
      prices: { Y: basic },
      fares,
      source: "Frontier Miles · direct airline",
      freshness: "live",
      observedAt,
      bookingUrl: frontierBookingUrl(q),
    });
  }
  return rows;
}

export async function frontierSearch(
  q: SearchQuery,
  outerSignal: AbortSignal,
): Promise<AwardResult[]> {
  validQuery(q);
  if (q.minCabin !== "Y") return [];
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(45000)]);
  // Fresh, request-local anonymous cookies only. Never read a browser profile.
  const cookies = new Map<
    string,
    { value: string; domain: string; path: string; hostOnly: boolean }
  >();
  async function request(url: URL): Promise<Response> {
    if (
      ![publicOrigin, bookingOrigin].includes(url.origin) ||
      url.username ||
      url.password
    )
      throw new ProviderError(
        "Frontier returned an unexpected search location.",
      );
    const header = [...cookies]
      .filter(
        ([, c]) =>
          (c.hostOnly
            ? url.hostname === c.domain
            : url.hostname === c.domain ||
              url.hostname.endsWith(`.${c.domain}`)) &&
          (url.pathname === c.path ||
            url.pathname.startsWith(
              c.path.endsWith("/") ? c.path : c.path + "/",
            )),
      )
      .map(([name, c]) => `${name.split("|")[0]}=${c.value}`)
      .join("; ");
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      cache: "no-store",
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0",
        Referer: publicOrigin + "/",
        ...(header ? { Cookie: header } : {}),
      },
    });
    for (const value of response.headers.getSetCookie()) {
      const parts = value.split(";").map((s) => s.trim()),
        pair = /^([^=;\s]+)=([^;]*)$/.exec(parts[0]);
      if (!pair) continue;
      const domainAttribute = parts
        .find((p) => /^domain=/i.test(p))
        ?.slice(7)
        .replace(/^\./, "")
        .toLowerCase();
      const domain = domainAttribute ?? url.hostname;
      if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))
        continue;
      const path = parts.find((p) => /^path=/i.test(p))?.slice(5) || "/";
      cookies.set(`${pair[1]}|${domain}|${path}`, {
        value: pair[2],
        domain,
        path,
        hostOnly: !domainAttribute,
      });
    }
    if (!response.ok && ![301, 302, 303, 307, 308].includes(response.status))
      throw new ProviderError(
        `Frontier award search is unavailable (HTTP ${response.status}).`,
        response.status,
      );
    return response;
  }
  const homepage = await request(new URL(publicOrigin + "/"));
  if (!homepage.ok)
    throw new ProviderError(
      "Frontier did not open its anonymous booking form.",
    );
  await homepage.body?.cancel();
  let url = new URL(frontierBookingUrl(q));
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await request(url);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location)
        throw new ProviderError("Frontier omitted its search redirect.");
      const next = new URL(location, url);
      if (
        next.origin !== bookingOrigin ||
        next.pathname !== "/Flight/Select" ||
        next.search ||
        next.hash
      )
        throw new ProviderError(
          "Frontier did not start the requested anonymous award search.",
        );
      url = next;
      continue;
    }
    const html = await response.text();
    if (
      url.pathname !== "/Flight/Select" ||
      (!html.includes(
        "Fare and bundle prices shown are total one-way price per person, taxes &amp; fees included",
      ) &&
        !html.includes(
          "Fare and bundle prices shown are total one-way price per person, taxes & fees included",
        ))
    )
      throw new ProviderError(
        "Frontier did not confirm the award price scope.",
      );
    return parseFrontier(extractFrontierFlightData(html), q);
  }
  throw new ProviderError("Frontier returned too many search redirects.");
}
