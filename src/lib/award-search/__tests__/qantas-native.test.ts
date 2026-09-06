import { describe, expect, it } from "vitest";
import one from "./fixtures/qantas-native-domestic-one.json";
import two from "./fixtures/qantas-native-domestic-two.json";
import international from "./fixtures/qantas-native-international-two.json";
import {
  parseQantasNative,
  qantasNativeCounts,
  qantasNativeResponseSchema,
} from "../qantas-native";

const q = {
  origin: "SYD",
  dest: "MEL",
  departDate: "2026-10-05",
  pax: 2,
  minCabin: "Y" as const,
};
const copy = () => qantasNativeResponseSchema.parse(structuredClone(two));
describe("Qantas native anonymous Classic and Classic Plus awards", () => {
  it("retains every domestic award and exact per-person and party prices", () => {
    const rows = parseQantasNative(two, q, "2026-09-06T13:00:00Z");
    expect(rows).toHaveLength(37);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(62);
    expect(rows[0].prices.Y).toMatchObject({
      points: 18000,
      partyPoints: 36000,
      cash: 60.05,
      currency: "AUD",
      quotedPassengers: 2,
      fareName: "Economy Classic Plus",
      segmentCabins: ["Y"],
    });
    expect(rows[0].prices.J).toMatchObject({
      points: 33100,
      partyPoints: 66200,
      cash: 85.35,
    });
    expect(
      rows.every(
        (r) =>
          r.freshness === "live" && r.observedAt === "2026-09-06T13:00:00Z",
      ),
    ).toBe(true);
    expect(rows.flatMap((r) => r.fares!).every((f) => !f.cashFare)).toBe(true);
    expect(rows[0].duration).toBe(95);
    expect(rows[0].segments[0].departure).toBe("2026-10-05T06:00:00");
  });
  it("accounts for Avalon without returning it as an exact Melbourne Tullamarine result", () => {
    const query = { ...q, departDate: "2026-10-06", pax: 1 };
    expect(qantasNativeCounts(one, query)).toEqual({
      itineraries: 40,
      fares: 69,
      exactItineraries: 39,
      exactFares: 68,
      otherAirportItineraries: 1,
    });
    const rows = parseQantasNative(one, query);
    expect(rows).toHaveLength(39);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(68);
    expect(rows.every((r) => r.segments.at(-1)!.destination === "MEL")).toBe(
      true,
    );
    expect(rows[0].prices.J?.fareName).toBe("Business Classic Reward");
  });
  it("preserves all international cabins, partners and airport-local dates across the date line", () => {
    const rows = parseQantasNative(international, { ...q, dest: "LAX" });
    expect(rows).toHaveLength(12);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(19);
    const nonstop = rows.find((r) => r.segments[0].flightNumber === "QF11")!;
    expect(Object.keys(nonstop.prices).sort()).toEqual(["F", "J", "W", "Y"]);
    expect(nonstop.prices.Y).toMatchObject({
      points: 48200,
      partyPoints: 96400,
      cash: 247.99,
    });
    expect(nonstop.segments[0]).toMatchObject({
      departure: "2026-10-05T18:50:00",
      arrival: "2026-10-05T14:30:00",
    });
    expect(nonstop.duration).toBe(820);
    expect(rows.some((r) => r.segments.some((s) => s.airline === "EK"))).toBe(
      true,
    );
  });
  it("keeps mixed cabins distinct from the fare's marketed cabin and preserves unknown operator codes", () => {
    const rows = parseQantasNative(international, { ...q, dest: "LAX" });
    const mel = rows.find(
      (r) => r.segments.map((s) => s.flightNumber).join() === "QF405,QF93",
    )!;
    expect(mel.prices.W).toMatchObject({
      mixedCabin: true,
      segmentCabins: ["Y", "W"],
    });
    const partner = rows.find((r) => r.segments[0].flightNumber === "PR212")!;
    expect(partner.prices.W).toMatchObject({
      mixedCabin: true,
      segmentCabins: ["W", "J"],
    });
    const regional = parseQantasNative(two, q).find((r) =>
      r.segments.some((s) => s.operatingAirline === null),
    )!;
    expect(regional).toBeDefined();
    expect(regional.segments.some((s) => !!s.operatedBy)).toBe(true);
  });
  it("does not mistake cash fare point conversions for Classic awards", () => {
    const fares = parseQantasNative(two, q).flatMap((r) => r.fares!);
    expect(fares.every((f) => f.fareName?.includes("Classic"))).toBe(true);
    expect(fares.some((f) => /Red e-Deal|Flex/.test(f.fareName!))).toBe(false);
  });
  it.each([
    { origin: "BNE" },
    { dest: "AVV" },
    { departDate: "2026-10-06" },
    { pax: 1 },
  ])("rejects the wrong actual search identity: %j", (changed) => {
    expect(() => parseQantasNative(two, { ...q, ...changed })).toThrow(
      /different route, date or passenger/,
    );
  });
  it("rejects incomplete flight records, missing prices, incoherent cabin maps and party totals", () => {
    const mutations: ((p: ReturnType<typeof copy>) => void)[] = [
      (p) => {
        delete p.modelInput.availability.bounds[0].flights["0"];
      },
      (p) => {
        p.modelInput.availability.bounds[0].flights[
          "0"
        ].listRecommendation.ACEECO.priceForAll.convertedBaseFare = 18000;
      },
      (p) => {
        p.modelInput.availability.bounds[0].flights[
          "0"
        ].listRecommendation.ACEECO.taxForAll = 60.05;
      },
      (p) => {
        p.modelInput.availability.bounds[0].flights[
          "0"
        ].listRecommendation.ACEECO.cabins = {};
      },
      (p) => {
        p.modelInput.availability.bounds[0].flights[
          "0"
        ].listRecommendation.ACEECO.priceForOne.currency.code = "USD";
      },
      (p) => {
        p.modelInput.availability.bounds[0].flights[
          "0"
        ].listRecommendation.ACEECO.nbLastSeatsAvailable = 1;
      },
    ];
    for (const mutate of mutations) {
      const p = copy();
      mutate(p);
      expect(() => parseQantasNative(p, q)).toThrow();
    }
  });
  it("rejects member restrictions and empty calendar-like responses", () => {
    const restricted = copy();
    restricted.modelInput.availability.bounds[0].flights[
      "0"
    ].listRecommendation.ACEECO.restrictedFare = true;
    expect(() => parseQantasNative(restricted, q)).toThrow(/member-restricted/);
    const empty = copy();
    empty.modelInput.availability.bounds[0].listItineraries.itineraries = [];
    empty.modelInput.availability.bounds[0].flights = {};
    expect(() => parseQantasNative(empty, q)).toThrow(/empty response/);
  });
  it("strips unrelated account and session fields from captured inventory", () => {
    const p = structuredClone(two);
    Object.assign(p.modelInput, {
      sessionToken: "not-inventory",
      loggedInProfiles: [{ email: "unused@example.invalid" }],
    });
    const safe = JSON.stringify(qantasNativeResponseSchema.parse(p));
    expect(safe).not.toMatch(
      /sessionToken|loggedInProfiles|not-inventory|unused@example/,
    );
  });
});
