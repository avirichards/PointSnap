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
