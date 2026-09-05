import type { Cabin, SearchQuery } from "@/lib/types";
export type CoverageState =
  "pending" | "success" | "empty" | "unavailable" | "error";
export interface Coverage {
  programId: string;
  state: CoverageState;
  message?: string;
  source?: string;
}
export interface AwardPrice {
  cabin: Cabin;
  points: number;
  cash: number | null;
  currency: string | null;
  seats: number | null;
  mixedCabin: boolean;
  transferOptions?: { currencyId: string; points: number; bonusPct: number }[];
}
export interface AwardSegment {
  origin: string;
  destination: string;
  departure: string | null;
  arrival: string | null;
  airline: string;
  flightNumber: string;
  aircraft?: string | null;
  cabin?: Cabin | null;
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
  prices: Partial<Record<Cabin, AwardPrice>>;
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
