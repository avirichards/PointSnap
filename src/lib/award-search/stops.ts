import type { AwardResult } from "./types";

export function stopAirports(row: AwardResult): string[] {
  return row.segments.flatMap((segment, index) => [
    ...(segment.technicalStops ?? []).map((stop) => stop.airport),
    ...(index < row.segments.length - 1 ? [segment.destination] : []),
  ]);
}

export function stopCount(row: AwardResult): number {
  return (
    Math.max(0, row.segments.length - 1) +
    row.segments.reduce(
      (n, segment) => n + (segment.technicalStops?.length ?? 0),
      0,
    )
  );
}

export function stopSummary(row: AwardResult): string {
  const airports = stopAirports(row).join(" · ");
  if (row.stopDetailsUnconfirmed)
    return airports ? `${airports} · check stops` : "Direct · check stops";
  return airports || "Nonstop";
}
