/** UTC calendar arithmetic keeps dates stable across time zones and DST. */
export function calendarDate(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
export function moveDate(value: string, days: number): string {
  const date = calendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}
export function moveMonth(value: string, months: number): string {
  const date = calendarDate(value),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return isoDate(date);
}
export function monthDays(month: string): string[][] {
  const start = `${month.slice(0, 7)}-01`;
  const first = moveDate(start, -calendarDate(start).getUTCDay());
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => moveDate(first, week * 7 + day)),
  );
}
export function dateLabel(
  value: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return calendarDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...options,
  });
}
export function clampDate(value: string, min: string, max: string): string {
  return value < min ? min : value > max ? max : value;
}

/** The viewer's calendar date, for local expiry and upcoming-flight displays. */
export function localCalendarDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
