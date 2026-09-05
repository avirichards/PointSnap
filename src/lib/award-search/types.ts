import type { Cabin, SearchQuery } from "@/lib/types";
export type CoverageState =
  | "partial"
  | "pending"
  | "success"
  | "empty"
  | "unavailable"
  | "error";
export interface Coverage {
  programId: string;
  state: CoverageState;
  message?: string;
  source?: string;
  inventory?: "flights" | "calendar";
}
export interface AwardPrice {
  fareId?: string;
  fareName?: string;
  bookingClasses?: string[];
  refundable?: boolean | null;
  segmentCabins?: (Cabin | null)[];
  cabin: Cabin;
  points: number;
  partyPoints?: number;
  quotedPassengers?: number;
  feesIncludedInPoints?: boolean;
  cabinUnconfirmed?: boolean;
  cash: number | null;
  currency: string | null;
  seats: number | null;
  seatCountLabel?: string;
  bookingNotes?: string[];
  mixedCabin: boolean;
  cashFare?: {
    amount: number;
    currency: string;
    fareName: string;
    refundable: boolean | null;
    observedAt: string;
    bookingUrl: string;
  };
  transferOptions?: { currencyId: string; points: number; bonusPct: number }[];
}
export interface AwardSegment {
  origin: string;
  destination: string;
  departure: string | null;
  arrival: string | null;
  airline: string;
  airlineName?: string | null;
  operatedBy?: string | null;
  operatingAirline?: string | null;
  operatingFlightNumber?: string | null;
  flightNumber: string;
  aircraft?: string | null;
  cabin?: Cabin | null;
  /** Intermediate stops on the same flight, distinct from a connection. */
  technicalStops?: {
    airport: string;
    arrival: string | null;
    departure: string | null;
    duration: number | null;
  }[];
}
export interface AwardResult {
  id: string;
  programId: string;
  origin: string;
  destination: string;
  date: string;
  kind: "flight" | "calendar";
  segments: AwardSegment[];
  duration: number | null;
  /** The source supplies flight changes but may omit same-flight stops. */
  stopDetailsUnconfirmed?: boolean;
  prices: Partial<Record<Cabin, AwardPrice>>;
  // Preserve every source fare, including multiple fare families in a cabin.
  fares?: AwardPrice[];
  // A daily summary whose source does not identify a cabin or an itinerary.
  calendarQuote?: Pick<AwardPrice, "points" | "cash" | "currency" | "seats">;
  retrievedAt?: string;
  source: string;
  freshness: "live" | "cached";
  observedAt: string;
  bookingUrl: string;
}
export type AwardEvent =
  | { type: "meta"; programs: string[] }
  | { type: "results"; rows: AwardResult[] }
  | { type: "coverage"; coverage: Coverage }
  | { type: "complete"; durationMs: number }
  | { type: "error"; message: string };
export interface ProviderContext {
  query: SearchQuery;
  signal: AbortSignal;
  emit: (event: AwardEvent) => void;
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
export function cabin(value: unknown): Cabin | null {
  const s = String(value ?? "")
    .toLowerCase()
    .replace(/[_ -]/g, "");
  if (["y", "economy", "coach", "main", "saver"].includes(s)) return "Y";
  if (["w", "premiumeconomy", "premium", "premiumclass"].includes(s))
    return "W";
  if (["j", "business", "upperclass", "mint"].includes(s)) return "J";
  if (["f", "first"].includes(s)) return "F";
  return null;
}
export function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
