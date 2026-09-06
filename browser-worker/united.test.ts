import { describe, it, expect } from "vitest";
import { reconcileUnitedRows, unitedDisplayedKey } from "./united";
import { unitedFlights } from "../src/lib/award-search/united";
import p from "../src/lib/award-search/fixtures/united-ewr-lhr.json";
const { flights } = unitedFlights(p, { ...p.query, minCabin: "Y" });
const f = flights.find(
  (f) => f.FlightNumber === "122" && !f.Connections.length,
)!;
const actual = {
  text: "Flight Information NONSTOP Departing at 9:35 AM Arriving at 9:25 PM Origin Newark (EWR) Duration 6 hours and 50 minutes Destination London (LHR) Flight Number UA 122.",
  fares: [
    "72.1k miles + $5.60 United Economy (YN) Select fare for Economy",
    "117.9k miles + $5.60 United Premium Plus (ON) Select fare for Premium Economy",
    "200k miles + $5.60 United Polaris business (JN) Select fare for Business (lowest)",
  ],
};
describe("United page reconciliation", () => {
  it("matches real displayed mileage, fees and local clocks to inventory", () => {
    expect(unitedDisplayedKey(actual.text)).toBe("09:35|21:25|410");
    expect(reconcileUnitedRows([actual], [f], true)).toEqual({
      itineraries: 1,
      displayedFares: 3,
    });
  });
  it("does not accept a first batch or a partially rendered price grid as complete", () => {
    expect(() => reconcileUnitedRows([actual], flights, true)).toThrow();
    expect(() =>
      reconcileUnitedRows(
        [{ ...actual, fares: actual.fares.slice(0, 2) }],
        [f],
        true,
      ),
    ).toThrow();
  });
  it("rejects changed prices and duplicate displayed itineraries", () => {
    expect(() =>
      reconcileUnitedRows(
        [
          {
            ...actual,
            fares: actual.fares.map((s) => s.replace("72.1k", "70k")),
          },
        ],
        [f],
        true,
      ),
    ).toThrow();
    expect(() => reconcileUnitedRows([actual, actual], [f], true)).toThrow();
  });
  it("does not use a crossed-out comparison price as the actual award", () => {
    const copy = structuredClone(actual);
    copy.fares[0] =
      "premiers save 3% Was 74.4k miles + $5.60 Now 72.1k miles + $5.60 Select fare for Economy";
    expect(reconcileUnitedRows([copy], [f], true).displayedFares).toBe(3);
  });
});
