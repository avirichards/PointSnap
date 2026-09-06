import { describe, expect, it } from "vitest";
import {
  qantasDisplayedPrice,
  validateQantasPage,
  qantasBlockingNavigation,
} from "./qantas";
import domestic from "../src/lib/award-search/__tests__/fixtures/qantas-native-domestic-two.json";
import displayed from "../src/lib/award-search/__tests__/fixtures/qantas-domestic-page.json";

const query = {
  origin: "SYD",
  dest: "MEL",
  departDate: "2026-10-05",
  pax: 2,
  minCabin: "Y" as const,
};
describe("Qantas airline-page reconciliation", () => {
  it("distinguishes a denied booking navigation from unrelated resource failures", () => {
    expect(
      qantasBlockingNavigation(
        "https://book.qantas.com/qf-booking/dyn/air/tripflow.redirect",
        403,
        "document",
      ),
    ).toBe(true);
    expect(
      qantasBlockingNavigation(
        "https://book.qantas.com/qf-booking/dyn/air/tripflow.redirect",
        200,
        "document",
      ),
    ).toBe(false);
    expect(
      qantasBlockingNavigation(
        "https://book.qantas.com/analytics",
        403,
        "fetch",
      ),
    ).toBe(false);
    expect(
      qantasBlockingNavigation("https://unrelated.example/", 403, "document"),
    ).toBe(false);
  });
  it("matches every observed domestic flight and fare with rounded display fees", () => {
    expect(
      validateQantasPage(domestic, query, displayed, "domestic"),
    ).toMatchObject({ itineraries: 37, fares: 62, displayedFares: 62 });
    expect(
      qantasDisplayedPrice("Classic Plus\n18,000PTS+ $61\nSeats nearly gone"),
    ).toEqual({ points: 18000, fees: 61, plus: true });
    expect(qantasDisplayedPrice("No reward seats")).toBeNull();
  });
  it("rejects a missing result, a missing fare and a swapped itinerary identity", () => {
    expect(() =>
      validateQantasPage(domestic, query, displayed.slice(1), "domestic"),
    ).toThrow(/every source itinerary/);
    const missing = structuredClone(displayed);
    missing[0].fares.pop();
    expect(() =>
      validateQantasPage(domestic, query, missing, "domestic"),
    ).toThrow(/award choices/);
    const changed = structuredClone(displayed);
    changed[0].text = changed[0].text.replace("QF401", "QF999");
    expect(() =>
      validateQantasPage(domestic, query, changed, "domestic"),
    ).toThrow(/flight numbers/);
  });
  it.each([
    ["18,000", "18,001"],
    ["$61", "$60"],
    ["Classic Plus", "Classic"],
  ])(
    "rejects a changed displayed price or reward family: %s",
    (old, replacement) => {
      const changed = structuredClone(displayed);
      changed[0].fares[0].text = changed[0].fares[0].text.replace(
        old,
        replacement,
      );
      expect(() =>
        validateQantasPage(domestic, query, changed, "domestic"),
      ).toThrow(/points, rounded fees or Classic/);
    },
  );
});
