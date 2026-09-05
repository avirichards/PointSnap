export type TimeFormat = "12h" | "24h";

/** Preserve the airport-local clock; never shift a flight into the viewer's zone. */
export function formatLocalTime(
  value: string | null | undefined,
  format: TimeFormat = "12h",
): string {
  const match = value?.match(/(?:^|T)(\d{2}):(\d{2})/);
  if (!match) return "—";
  const hour = Number(match[1]),
    minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "—";
  if (format === "24h") return `${match[1]}:${match[2]}`;
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}
