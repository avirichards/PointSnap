import { createHash } from "node:crypto";
import type { ResultSegment } from "./types";

export interface ItineraryHashInput {
  programId: string;
  pax: number;
  departDate: string;
  segments: Pick<
    ResultSegment,
    "operatingAirlineIata" | "flightNumber" | "departAt" | "originIata" | "destIata"
  >[];
}

/**
 * Canonical serializer for an itinerary used as the upsert key in `search_results`.
 * Stable across scraper restarts so the same physical flight always hashes to the
 * same value — that's what makes re-scrape idempotent and history append-only.
 */
export function canonicalItinerary(input: ItineraryHashInput): string {
  const segs = [...input.segments]
    .sort((a, b) => a.departAt.localeCompare(b.departAt))
    .map(
      (s) =>
        `${s.operatingAirlineIata}|${s.flightNumber}|${s.departAt}|${s.originIata}>${s.destIata}`,
    )
    .join("~");
  return [
    `program=${input.programId}`,
    `pax=${input.pax}`,
    `depart=${input.departDate}`,
    `segs=${segs}`,
  ].join(";");
}

export function itineraryHash(input: ItineraryHashInput): string {
  return createHash("sha256").update(canonicalItinerary(input)).digest("hex");
}

/**
 * Deterministic key for the operating flight identity.
 * Format: `${IATA}${flight#}@${YYYYMMDDTHHMM}` — used to collapse the same physical
 * flight across the N programs that can ticket it ("1 flight, 3 ways to book").
 */
export function operatingFlightKey(
  operatingAirlineIata: string,
  flightNumber: string,
  departAt: string,
): string {
  const d = new Date(departAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${operatingAirlineIata}${flightNumber}@${yyyy}${mm}${dd}T${hh}${mi}`;
}
