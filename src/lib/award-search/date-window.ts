import type { Coverage } from "./types";
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
    flex > 7
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
    const failed =
      entries.filter((c) => c.state === "error").length +
      days.filter(
        (d) =>
          (d.state === "error" || d.state === "cancelled") &&
          !d.coverage.some((c) => c.programId === programId),
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
      message: `${known.length} of ${days.length} dates checked${failed ? `; ${failed} incomplete` : ""}.${exemplar?.message ? " " + exemplar.message : ""}`,
    };
  });
}
