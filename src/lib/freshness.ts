export type FreshnessBucket = "fresh" | "stale" | "stale-critical";

export function freshnessBucket(
  lastSeenAt: string | Date,
  now: Date = new Date(),
): FreshnessBucket {
  const ts = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  const ageMs = now.getTime() - ts.getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin <= 5) return "fresh";
  if (ageMin <= 60) return "stale";
  return "stale-critical";
}

/** Compact relative time: "4m", "1h", "2d". */
export function relativeAge(
  lastSeenAt: string | Date,
  now: Date = new Date(),
): string {
  const ts = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  const sec = Math.max(0, Math.round((now.getTime() - ts.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.round(day / 30);
  return `${mo}mo`;
}
