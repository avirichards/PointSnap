export type Cabin = "Y" | "W" | "J" | "F";

export const CABIN_ORDER: Cabin[] = ["Y", "W", "J", "F"];

export const CABIN_LABEL: Record<Cabin, string> = {
  Y: "Economy",
  W: "Premium",
  J: "Business",
  F: "First",
};

/** One row in the spreadsheet — a flight ticketed by a specific program. */
export interface SearchResultRow {
  id: string;
  itineraryHash: string;
  programId: string;
  programName: string;
  originIata: string;
  destIata: string;
  departDate: string;
  arriveDate: string;
  totalDurationMin: number;
  numSegments: number;
  segments: ResultSegment[];
  cabinPrices: Partial<Record<Cabin, CabinPrice>>;
  confidenceScore: number;
  observedAt: string;
  lastSeenAt: string;
  /** Composite key for collapse-by-operating-flight: "UA79@20260814T1110" */
  operatingFlightKey: string;
}

export interface ResultSegment {
  segmentOrder: number;
  operatingAirlineIata: string;
  marketingAirlineIata: string;
  flightNumber: string;
  originIata: string;
  destIata: string;
  departAt: string;
  arriveAt: string;
  aircraftIcao: string | null;
  segmentCabin: Cabin | null;
  fareClass: string | null;
}

export interface CabinPrice {
  cabin: Cabin;
  seatsRemaining: number;
  milesPerPax: number;
  surchargeUsdPerPax: number;
  taxesUsdPerPax: number;
  cppMicroAtObs: number | null;
}

/**
 * SSE event shape. Mock now, real scrapers later — same wire format.
 *  - meta: search metadata (programs being queried)
 *  - partial: per-program batch of rows
 *  - program_done: one program finished
 *  - confidence_update: post-shadow-confirm score adjustment
 *  - complete: all programs done
 */
export type SearchStreamEvent =
  | { type: "meta"; searchId: string; programs: string[]; pax: number }
  | { type: "partial"; programId: string; rows: SearchResultRow[] }
  | {
      type: "program_done";
      programId: string;
      status: "success" | "partial" | "failed" | "circuit_open";
    }
  | {
      type: "confidence_update";
      resultId: string;
      newScore: number;
      reason: "shadow_confirm" | "multi_source" | "user_report";
    }
  | { type: "complete"; totalRows: number; durationMs: number };

export interface SearchQuery {
  origin: string;
  dest: string;
  departDate: string;
  returnDate?: string;
  pax: number;
  minCabin: Cabin;
}
