import { expect, it } from "vitest";
import { formatLocalTime } from "../../time-format";
it("displays airport-local AM/PM by default, including midnight and noon", () => {
  expect(formatLocalTime("2026-10-05T18:25:00-07:00")).toBe("6:25 PM");
  expect(formatLocalTime("2026-10-05T00:05:00")).toBe("12:05 AM");
  expect(formatLocalTime("12:00")).toBe("12:00 PM");
  expect(formatLocalTime("2026-10-05T09:10:00+09:00", "24h")).toBe("09:10");
  expect(formatLocalTime(null)).toBe("—");
  expect(formatLocalTime("25:00")).toBe("—");
});
