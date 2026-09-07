import { describe, it, expect } from "vitest";
import {
  convertMoney,
  currencyForCountry,
  currencyForLocale,
} from "../../currency";
import { searchDates, summarizeCoverage, type DaySearch } from "../date-window";
const now = new Date("2026-09-05T12:00:00Z");
describe("display currency", () => {
  it("maps country and explicit locale regions without guessing a location from language alone", () => {
    expect(currencyForCountry("us")).toBe("USD");
    expect(currencyForCountry("MX")).toBe("MXN");
    expect(currencyForLocale("en-GB")).toBe("GBP");
    expect(currencyForLocale("en")).toBe(null);
  });
  it("converts via common USD rates and preserves the oldest rate date", () => {
    const rates = {
      USD: { rate: 1, date: "2026-09-05" },
      MXN: { rate: 20, date: "2026-09-04" },
      EUR: { rate: 0.9, date: "2026-09-05" },
    };
    expect(convertMoney(1800, "MXN", "USD", rates, +now)).toEqual({
      amount: 90,
      date: "2026-09-04",
    });
    expect(convertMoney(100, "USD", "EUR", rates, +now)?.amount).toBe(90);
  });
  it("does not fabricate stale, zero or missing conversion rates", () => {
    expect(convertMoney(1800, "MXN", "USD", {}, +now)).toBe(null);
    expect(convertMoney(10, "USD", "USD", {}, +now)).toEqual({
      amount: 10,
      date: null,
    });
    expect(
      convertMoney(
        1,
        "MXN",
        "USD",
        {
          MXN: { rate: 0, date: "2026-09-05" },
          USD: { rate: 1, date: "2026-09-05" },
        },
        +now,
      ),
    ).toBe(null);
    expect(
      convertMoney(
        10,
        "MXN",
        "USD",
        {
          MXN: { rate: 20, date: "2020-01-01" },
          USD: { rate: 1, date: "2026-09-05" },
        },
        +now,
      ),
    ).toBe(null);
  });
});
describe("real flexible date searches", () => {
  it("includes all days across a month boundary and enforces the maximum", () => {
    expect(searchDates("2026-10-01", 1, now)).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
    expect(searchDates("2026-10-05", 7, now)).toHaveLength(15);
    const widest = searchDates("2026-10-05", 14, now);
    expect(widest).toHaveLength(29);
    expect(widest[0]).toBe("2026-09-21");
    expect(widest.at(-1)).toBe("2026-10-19");
    expect(() => searchDates("2026-10-05", 15, now)).toThrow();
  });
  it("clips to valid outbound and return windows", () =>
    expect(
      searchDates("2026-10-05", 3, now, "2026-10-04", "2026-10-06"),
    ).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]));
  it("does not report full coverage when one date fails", () => {
    const days: DaySearch[] = [
      {
        date: "2026-10-04",
        state: "complete",
        coverage: [{ programId: "AA", state: "success" }],
      },
      {
        date: "2026-10-05",
        state: "error",
        coverage: [{ programId: "AA", state: "error" }],
      },
    ];
    expect(summarizeCoverage(days)[0].state).toBe("partial");
    expect(summarizeCoverage(days)[0].message).toContain("1 of 2");
  });
  it("does not classify cancelled or queued dates as sold out", () => {
    const days: DaySearch[] = [
      {
        date: "2026-10-04",
        state: "complete",
        coverage: [{ programId: "AA", state: "empty" }],
      },
      { date: "2026-10-05", state: "queued", coverage: [] },
    ];
    expect(summarizeCoverage(days)[0].state).toBe("pending");
    days[1].state = "cancelled";
    expect(summarizeCoverage(days)[0].state).toBe("partial");
  });
});
