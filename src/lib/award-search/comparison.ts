import { convertMoney, type ExchangeRates } from "@/lib/currency";
import type { Cabin } from "@/lib/types";
import { CABIN_ORDER } from "@/lib/types";
import type { AwardPrice, AwardResult } from "./types";
import { centsPerPoint, pointsForParty } from "./value";
import { PROGRAMS } from "@/lib/programs";
import { stopAirports, stopCount } from "./stops";
export type SortOrder =
  | "points"
  | "value"
  | "fees"
  | "duration"
  | "depart"
  | "arrive"
  | "stops"
  | "freshness"
  | "programs";
export interface ResultFilters {
  text: string;
  programs: string[];
  airlines: string[];
  cabins: Cabin[];
  days: string[];
  maxPoints: string;
  maxFees: string;
  feeCurrency: string;
  minValue: string;
  minSeats: string;
  maxStops: string;
  maxDuration: string;
  minLayover: string;
  maxLayover: string;
  departAfter: string;
  departBefore: string;
  arriveAfter: string;
  arriveBefore: string;
  via: string;
  avoid: string;
  aircraft: string;
  fare: string;
  transfer: string;
  mixed: boolean;
  refundable: boolean;
  confirmedCabin: boolean;
  live: boolean;
  maxAge: string;
  noOvernight: boolean;
  walletOnly: boolean;
}
export const defaultFilters = (): ResultFilters => ({
  text: "",
  programs: [],
  airlines: [],
  cabins: [],
  days: [],
  maxPoints: "",
  maxFees: "",
  feeCurrency: "USD",
  minValue: "",
  minSeats: "",
  maxStops: "",
  maxDuration: "",
  minLayover: "",
  maxLayover: "",
  departAfter: "",
  departBefore: "",
  arriveAfter: "",
  arriveBefore: "",
  via: "",
  avoid: "",
  aircraft: "",
  fare: "",
  transfer: "",
  mixed: false,
  refundable: false,
  confirmedCabin: false,
  live: false,
  maxAge: "",
  noOvernight: false,
  walletOnly: false,
});
export interface FlightOffer {
  id: string;
  row: AwardResult;
  price: AwardPrice;
}
export interface FlightGroup {
  id: string;
  row: AwardResult;
  offers: FlightOffer[];
  programs: string[];
}
export function allFares(r: AwardResult): AwardPrice[] {
  return r.fares?.length
    ? r.fares
    : Object.values(r.prices).filter((p): p is AwardPrice => !!p);
}
function stamp(s: string | null) {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? `utc:${t}` : null;
  }
  return `local:${s.length === 16 ? s + ":00" : s.slice(0, 19)}`;
}
/** Never infer codeshare equivalence from a route and approximate departure time. */
export function flightKey(r: AwardResult): string {
  if (r.kind !== "flight" || !r.segments.length)
    return `unmatched:${r.programId}:${r.id}`;
  const legs = r.segments.map((s) => {
    const raw = (s.operatingFlightNumber || s.flightNumber)
      .replace(/\s/g, "")
      .toUpperCase();
    const m = raw.match(/^([A-Z0-9]{2})0*(\d+[A-Z]?)$/);
    const number = m
      ? `${m[1]}${m[2]}`
      : /^\d+[A-Z]?$/.test(raw) && s.airline
        ? `${s.operatingAirline ?? s.airline}${Number.parseInt(raw, 10)}${raw.match(/[A-Z]$/)?.[0] ?? ""}`
        : null;
    const departure = stamp(s.departure),
      arrival = stamp(s.arrival);
    return number && departure && arrival && s.origin && s.destination
      ? [s.origin, s.destination, number, departure, arrival]
      : null;
  });
  return legs.every(Boolean)
    ? JSON.stringify(legs)
    : `unmatched:${r.programId}:${r.id}`;
}
export function groupFlights(rows: AwardResult[]): FlightGroup[] {
  const groups = new Map<string, FlightGroup>();
  for (const row of rows) {
    if (row.kind !== "flight") continue;
    const id = flightKey(row),
      g = groups.get(id) ?? { id, row, offers: [], programs: [] };
    if (!g.programs.includes(row.programId)) g.programs.push(row.programId);
    allFares(row).forEach((price, i) =>
      g.offers.push({ id: `${row.id}:${price.fareId ?? i}`, row, price }),
    );
    groups.set(id, g);
  }
  return [...groups.values()];
}
export function layovers(row: AwardResult): (number | null)[] {
  return row.segments.slice(1).map((s, i) => {
    const prior = row.segments[i];
    if (prior.destination !== s.origin) return null;
    const a = prior.arrival,
      b = s.departure;
    if (!a || !b) return null;
    const offset = (v: string) => /(?:Z|[+-]\d{2}:?\d{2})$/.test(v);
    if (offset(a) !== offset(b)) return null;
    const n =
      (Date.parse(offset(b) ? b : b + "Z") -
        Date.parse(offset(a) ? a : a + "Z")) /
      60000;
    return Number.isFinite(n) && n >= 0 ? n : null;
  });
}
const tokens = (s: string) =>
  s
    .toUpperCase()
    .split(/[,\s]+/)
    .filter(Boolean);
function windowMatches(time: string | null, after: string, before: string) {
  if (!after && !before) return true;
  if (!time) return false;
  const t = time.slice(11, 16);
  if (after && before && after > before) return t >= after || t <= before;
  return (!after || t >= after) && (!before || t <= before);
}
const below = (n: number | null | undefined, limit: string, multiplier = 1) =>
  limit === "" ||
  (n != null && Number.isFinite(n) && n <= Number(limit) * multiplier);
const above = (n: number | null | undefined, limit: string) =>
  limit === "" || (n != null && Number.isFinite(n) && n >= Number(limit));
export function matchesOffer(
  offer: FlightOffer,
  f: ResultFilters,
  pax: number,
  balances: Record<string, number> = {},
  now = Date.now(),
  rates: ExchangeRates = {},
): boolean {
  const { row: r, price: p } = offer;
  const program =
    PROGRAMS.find((x) => x.id === r.programId)?.name ?? r.programId;
  const text =
    `${program} ${r.origin} ${r.destination} ${r.segments.map((s) => `${s.airline} ${s.airlineName ?? ""} ${s.operatedBy ?? ""} ${s.flightNumber} ${s.aircraft ?? ""}`).join(" ")} ${p.fareName ?? ""}`.toLowerCase();
  if (
    !f.text
      .toLowerCase()
      .split(/\s+/)
      .every((t) => text.includes(t))
  )
    return false;
  if (f.programs.length && !f.programs.includes(r.programId)) return false;
  if (
    f.airlines.length &&
    !r.segments.every((s) =>
      f.airlines.includes(s.operatingAirline ?? s.airline),
    )
  )
    return false;
  if (f.cabins.length && !f.cabins.includes(p.cabin)) return false;
  if (
    f.days.length &&
    !f.days.includes(String(new Date(r.date + "T12:00:00Z").getUTCDay()))
  )
    return false;
  if (
    !below(p.points, f.maxPoints) ||
    !above(centsPerPoint(p), f.minValue) ||
    !above(p.seats, f.minSeats)
  )
    return false;
  if (
    f.maxFees !== "" &&
    !below(
      convertMoney(p.cash, p.currency, f.feeCurrency, rates, now)?.amount,
      f.maxFees,
    )
  )
    return false;
  if (
    !below(r.stopDetailsUnconfirmed ? null : stopCount(r), f.maxStops) ||
    !below(r.duration, f.maxDuration, 60)
  )
    return false;
  const waits = layovers(r);
  if (f.minLayover !== "" && waits.some((n) => !above(n, f.minLayover)))
    return false;
  if (f.maxLayover !== "" && waits.some((n) => !below(n, f.maxLayover)))
    return false;
  if (
    !windowMatches(r.segments[0]?.departure, f.departAfter, f.departBefore) ||
    !windowMatches(
      r.segments.at(-1)?.arrival ?? null,
      f.arriveAfter,
      f.arriveBefore,
    )
  )
    return false;
  const connections = [
    ...stopAirports(r),
    ...r.segments.slice(1).map((s) => s.origin),
  ];
  if (f.via && !tokens(f.via).some((t) => connections.includes(t)))
    return false;
  if (f.avoid && tokens(f.avoid).some((t) => connections.includes(t)))
    return false;
  if (
    f.aircraft &&
    !r.segments.some((s) =>
      s.aircraft?.toLowerCase().includes(f.aircraft.toLowerCase()),
    )
  )
    return false;
  if (
    f.fare &&
    !`${p.fareName ?? ""} ${(p.bookingClasses ?? []).join(" ")}`
      .toLowerCase()
      .includes(f.fare.toLowerCase())
  )
    return false;
  if (
    f.transfer &&
    !p.transferOptions?.some((t) => t.currencyId === f.transfer)
  )
    return false;
  if (
    (f.mixed && p.mixedCabin) ||
    (f.confirmedCabin && p.cabinUnconfirmed) ||
    (f.refundable && p.refundable !== true) ||
    (f.live && r.freshness !== "live")
  )
    return false;
  const age = (now - Date.parse(r.observedAt)) / 3600000;
  if (
    f.maxAge !== "" &&
    (!Number.isFinite(age) || age < 0 || age > Number(f.maxAge))
  )
    return false;
  if (f.noOvernight) {
    if (
      !r.segments[0]?.departure ||
      !r.segments.at(-1)?.arrival ||
      r.segments[0].departure.slice(0, 10) !==
        r.segments.at(-1)!.arrival!.slice(0, 10)
    )
      return false;
  }
  if (f.walletOnly && (balances[r.programId] ?? -1) < pointsForParty(p, pax))
    return false;
  return true;
}
export function filterGroups(
  groups: FlightGroup[],
  f: ResultFilters,
  pax: number,
  balances: Record<string, number> = {},
  now = Date.now(),
  rates: ExchangeRates = {},
) {
  return groups
    .map((g) => {
      const offers = g.offers.filter((o) =>
        matchesOffer(o, f, pax, balances, now, rates),
      );
      return {
        ...g,
        offers,
        programs: [...new Set(offers.map((o) => o.row.programId))],
      };
    })
    .filter((g) => g.offers.length);
}
/** Date prices always come from the same filtered offers as the flight list. */
export function lowestFareForDate(
  groups: FlightGroup[],
  date: string,
  pax = 1,
  party = false,
): { points: number; cabin: Cabin } | null {
  let lowest: { points: number; cabin: Cabin } | null = null;
  for (const group of groups) {
    if (group.row.date !== date) continue;
    for (const offer of group.offers) {
      const points = party
        ? pointsForParty(offer.price, pax)
        : offer.price.points;
      if (!lowest || points < lowest.points)
        lowest = { points, cabin: offer.price.cabin };
    }
  }
  return lowest;
}
/** A previously sorted column cannot keep sorting a cabin that is filtered out. */
export function activeSortCabin(
  cabins: Cabin[],
  requested: Cabin | null,
): Cabin | null {
  if (cabins.length === 1) return cabins[0];
  return requested && (!cabins.length || cabins.includes(requested))
    ? requested
    : null;
}
export function compareOffers(
  a: FlightOffer,
  b: FlightOffer,
  sort: SortOrder,
  feeCurrency = "USD",
) {
  const pa = a.price,
    pb = b.price;
  const value = (p: AwardPrice) => centsPerPoint(p) ?? -Infinity;
  const fees = (p: AwardPrice) =>
    p.currency === feeCurrency && p.cash !== null ? p.cash : Infinity;
  const metric =
    sort === "value"
      ? value(pb) - value(pa)
      : sort === "fees"
        ? fees(pa) - fees(pb)
        : pa.points - pb.points;
  return metric || pa.points - pb.points || a.id.localeCompare(b.id);
}
export function sortGroups(
  groups: FlightGroup[],
  sort: SortOrder,
  feeCurrency = "USD",
  descending = false,
  sortCabin: Cabin | null = null,
  rates: ExchangeRates = {},
) {
  const metric = (g: FlightGroup): number | string | null => {
    const offers = sortCabin
      ? g.offers.filter((o) => o.price.cabin === sortCabin)
      : g.offers;
    if (sort === "points")
      return offers.length
        ? Math.min(...offers.map((o) => o.price.points))
        : null;
    if (sort === "fees") {
      const fees = offers.flatMap((o) => {
        const converted = convertMoney(
          o.price.cash,
          o.price.currency,
          feeCurrency,
          rates,
        );
        return converted ? [converted.amount] : [];
      });
      return fees.length ? Math.min(...fees) : null;
    }
    if (sort === "value") {
      const values = offers.flatMap((o) => {
        const n = centsPerPoint(o.price);
        return n === null ? [] : [n];
      });
      return values.length ? Math.max(...values) : null;
    }
    if (sort === "duration") return g.row.duration;
    if (sort === "stops")
      return g.row.stopDetailsUnconfirmed ? null : stopCount(g.row);
    if (sort === "programs") return g.programs.length;
    if (sort === "freshness") {
      const ts = g.offers
        .map((o) => Date.parse(o.row.observedAt))
        .filter(Number.isFinite);
      return ts.length ? Math.max(...ts) : null;
    }
    return (
      (sort === "depart"
        ? g.row.segments[0]?.departure
        : g.row.segments.at(-1)?.arrival) ?? null
    );
  };
  return [...groups].sort((a, b) => {
    const x = metric(a),
      y = metric(b);
    if (x === null || y === null)
      return x === y ? a.id.localeCompare(b.id) : x === null ? 1 : -1;
    const delta =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return (descending ? -delta : delta) || a.id.localeCompare(b.id);
  });
}
export function activeFilterCount(f: ResultFilters) {
  const defaults = defaultFilters();
  return Object.entries(f).filter(
    ([key, value]) =>
      JSON.stringify(value) !==
        JSON.stringify(defaults[key as keyof ResultFilters]) &&
      key !== "feeCurrency",
  ).length;
}
export const cabinSort = (a: Cabin, b: Cabin) =>
  CABIN_ORDER.indexOf(a) - CABIN_ORDER.indexOf(b);
