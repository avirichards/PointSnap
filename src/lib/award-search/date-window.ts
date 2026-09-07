import { airportPairs } from "@/lib/search-places";
import type { Coverage } from "./types";
export const MAX_DATE_FLEX_DAYS = 14;
export interface DaySearch {
  date: string;
  state: "queued" | "searching" | "complete" | "error" | "cancelled";
  coverage: Coverage[];
  message?: string;
}
export function searchDates(
  date: string,
  flex: number,
  now = new Date(),
  min?: string,
  max?: string,
): string[] {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isInteger(flex) ||
    flex < 0 ||
    flex > MAX_DATE_FLEX_DAYS
  )
    throw new Error("Invalid date window");
  const t = Date.parse(date + "T12:00:00Z");
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== date)
    throw new Error("Invalid date");
  const earliestAllowed = new Date(now.getTime() - 86400000)
      .toISOString()
      .slice(0, 10),
    latestAllowed = new Date(now.getTime() + 366 * 86400000)
      .toISOString()
      .slice(0, 10);
  const earliest = min && min > earliestAllowed ? min : earliestAllowed,
    latest = max && max < latestAllowed ? max : latestAllowed;
  return Array.from({ length: 2 * flex + 1 }, (_, i) =>
    new Date(t + (i - flex) * 86400000).toISOString().slice(0, 10),
  ).filter((d) => d >= earliest && d <= latest);
}
export function summarizeCoverage(days: DaySearch[]): Coverage[] {
  const ids = [
    ...new Set(days.flatMap((d) => d.coverage.map((c) => c.programId))),
  ];
  return ids.map((programId) => {
    const entries = days.flatMap((d) =>
      d.coverage.filter((c) => c.programId === programId),
    );
    const known = entries.filter(
      (c) => c.state === "success" || c.state === "empty",
    );
    const waiting = days.some(
      (d) => d.state === "queued" || d.state === "searching",
    );
    const failed = days.filter(
      (d) =>
        d.state !== "queued" &&
        d.state !== "searching" &&
        !d.coverage.some(
          (c) =>
            c.programId === programId &&
            (c.state === "success" || c.state === "empty"),
        ),
    ).length;
    const exemplar = known[0] ?? entries[0];
    if (days.length === 1)
      return {
        ...exemplar,
        state:
          exemplar.state === "pending" && !waiting ? "error" : exemplar.state,
      };
    const state: Coverage["state"] = waiting
      ? "pending"
      : known.length && failed
        ? "partial"
        : known.length
          ? entries.some((c) => c.state === "success")
            ? "success"
            : "empty"
          : entries.every((c) => c.state === "unavailable")
            ? "unavailable"
            : "error";
    return {
      ...exemplar,
      programId,
      state,
      message: `${known.length} of ${days.length} ${days.some((d) => "origin" in d) ? "airport/date checks" : "dates"} checked${failed ? `; ${failed} incomplete` : ""}.${exemplar?.message ? " " + exemplar.message : ""}`,
    };
  });
}

export interface SearchTask extends DaySearch {
  id: string;
  origin: string;
  destination: string;
}
export function buildSearchTasks(
  origin: string,
  destination: string,
  central: string,
  flex: number,
  now = new Date(),
  min?: string,
  max?: string,
): SearchTask[] {
  const pairs = airportPairs(origin, destination);
  if (!pairs.length) throw new Error("Choose different airports.");
  return searchDates(central, flex, now, min, max).flatMap((date) =>
    pairs.map((pair) => ({
      id: `${date}:${pair.origin}:${pair.destination}`,
      date,
      ...pair,
      state: "queued" as const,
      coverage: [],
    })),
  );
}
export function aggregateSearchDays(tasks: SearchTask[]): DaySearch[] {
  return [...new Set(tasks.map((t) => t.date))].sort().map((date) => {
    const matches = tasks.filter((t) => t.date === date);
    const waiting = matches.some(
      (t) => t.state === "queued" || t.state === "searching",
    );
    const coverage = summarizeCoverage(matches);
    const incomplete = matches.some(
      (t) =>
        t.state === "error" ||
        t.state === "cancelled" ||
        t.coverage.some((c) => c.state !== "success" && c.state !== "empty"),
    );
    const checked = matches.filter(
      (t) => t.state === "complete" || t.state === "error",
    ).length;
    return {
      date,
      state: waiting ? "searching" : incomplete ? "error" : "complete",
      coverage,
      message: `${checked} of ${matches.length} airport pairs finished${incomplete ? "; some sources incomplete" : ""}.`,
    };
  });
}
