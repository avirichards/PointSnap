import { AIRPORTS } from "@/db/seed/airports";

const zones = new Map(AIRPORTS.map((a) => [a.iata, a.tzOlson]));
const formatters = new Map<string, Intl.DateTimeFormat>();
const resolved = new Map<string, string | null>();

/** Compare exact instants across providers that supply local clocks or offsets. */
export function flightTimeStamp(
  value: string | null,
  airport: string,
): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? `utc:${t}` : null;
  }
  const local = value.length === 16 ? value + ":00" : value.slice(0, 19);
  const zone = zones.get(airport);
  if (!zone) return `local:${local}`;
  const key = `${zone}:${local}`;
  if (resolved.has(key)) return resolved.get(key)!;
  const wall = Date.parse(local + "Z");
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 19) !== local
  )
    return null;
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  const clockAt = (instant: number) => {
    const p = Object.fromEntries(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
  };
  const candidates = new Set<number>();
  // Probe both sides of a possible daylight-saving transition. A repeated or
  // nonexistent wall time is ambiguous and must not be merged with an instant.
  for (const delta of [-36, 0, 36]) {
    const probe = wall + delta * 3600000;
    const candidate = wall - (clockAt(probe) - probe);
    if (clockAt(candidate) === wall) candidates.add(candidate);
  }
  const result = candidates.size === 1 ? `utc:${[...candidates][0]}` : null;
  if (resolved.size >= 10000) resolved.clear();
  resolved.set(key, result);
  return result;
}
