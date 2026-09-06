import { describe, expect, it } from "vitest";
import den from "./fixtures/southwest-den.json";
import bwi from "./fixtures/southwest-bwi.json";
import {
  parseSouthwest,
  southwestPayloadSchema,
  southwestObservationCounts,
} from "../southwest";
import { southwestBookingUrl } from "../../bookingHandoff";

const q = {
  origin: "DEN",
  dest: "LAS",
  departDate: "2026-10-05",
  pax: 2,
  minCabin: "Y" as const,
};
const fresh = () => southwestPayloadSchema.parse(structuredClone(den));
const details = (p: ReturnType<typeof fresh>) =>
  p.points.response.data.searchResults.airProducts[0].details;

describe("native Southwest points and cash searches", () => {
  it("preserves all flights and fare families with per-person prices and exact cash matches", () => {
    const rows = parseSouthwest(den, q);
    expect(rows).toHaveLength(26);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(104);
    expect(
      rows.flatMap((r) => r.fares!).every((f) => f.cashFare && f.cabin === "Y"),
    ).toBe(true);
    const row = rows.find((r) => r.segments[0].flightNumber === "WN1629")!;
    expect(row).toMatchObject({
      programId: "WN_RAPID_REWARDS",
      duration: 115,
      freshness: "live",
    });
    expect(row.prices.Y).toMatchObject({
      points: 9500,
      partyPoints: 19000,
      quotedPassengers: 2,
      cash: 5.6,
      currency: "USD",
      seats: null,
      refundable: null,
      cashFare: { amount: 139.4, currency: "USD", fareName: "Basic" },
    });
    expect(row.fares!.map((f) => f.fareName)).toEqual(
      expect.arrayContaining([
        "Basic",
        "Choice",
        "Choice Preferred",
        "Choice Extra",
      ]),
    );
    expect(row.prices.J).toBeUndefined();
    expect(
      ((row.prices.Y!.cashFare!.amount - row.prices.Y!.cash!) /
        row.prices.Y!.points) *
        100,
    ).toBeCloseTo(1.4084, 4);
  });
  it("distinguishes nonstops, connections and stops without changing planes", () => {
    const rows = parseSouthwest(den, q);
    expect(
      rows.filter(
        (r) => r.segments.length === 1 && !r.segments[0].technicalStops?.length,
      ),
    ).toHaveLength(9);
    expect(rows.filter((r) => r.segments.length > 1)).toHaveLength(15);
    const sameFlight = rows.find(
      (r) => r.segments[0].flightNumber === "WN1589",
    )!;
    expect(sameFlight.segments).toHaveLength(1);
    expect(sameFlight.duration).toBe(250);
    expect(sameFlight.segments[0].technicalStops).toEqual([
      expect.objectContaining({ airport: "FAT", duration: 35 }),
    ]);
  });
  it("excludes unavailable families while retaining the international route and full taxes", () => {
    const rows = parseSouthwest(bwi, { ...q, origin: "BWI", dest: "CUN" });
    expect(rows).toHaveLength(16);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(62);
    expect(southwestObservationCounts(bwi.points.response)).toEqual({
      itineraries: 16,
      fares: 62,
      choices: 64,
    });
    expect(
      rows.find((r) => r.segments[0].flightNumber === "WN1609")!.prices.Y,
    ).toMatchObject({
      points: 11500,
      partyPoints: 23000,
      cash: 63.08,
      cashFare: { amount: 237.98 },
    });
    expect(rows.filter((r) => r.fares!.length === 3)).toHaveLength(2);
    expect(
      rows
        .filter((r) => r.fares!.length === 3)
        .every((r) => !r.fares!.some((f) => f.fareName === "Basic")),
    ).toBe(true);
  });
  it("rejects a response for a different route, date or passenger count", () => {
    for (const changed of [
      { origin: "BWI" },
      { dest: "CUN" },
      { departDate: "2026-10-06" },
      { pax: 1 },
    ])
      expect(() => parseSouthwest(den, { ...q, ...changed })).toThrow(
        "different route, date, party or currency",
      );
    const p = fresh();
    p.points.request.adultsCount = "1";
    expect(() => parseSouthwest(p, q)).toThrow();
  });
  it("never treats missing families, unknown availability or changed cabins as a complete list", () => {
    const missing = fresh();
    delete details(missing)[0].fareProducts.ADULT.BUSRED;
    expect(() => parseSouthwest(missing, q)).toThrow(
      "missing or unknown fare family",
    );
    for (const field of [
      { availabilityStatus: "WAITLIST" },
      { cabinInfo: [{ cabin: "BUS" }] },
      { fare: {} },
    ]) {
      const p = fresh();
      Object.assign(details(p)[0].fareProducts.ADULT.WGARED, field);
      expect(() => parseSouthwest(p, q)).toThrow();
    }
  });
  it("rejects mismatched segments, durations and stops instead of showing misleading flights", () => {
    for (const modify of [
      (p: ReturnType<typeof fresh>) => {
        details(p)[0].totalDuration++;
      },
      (p: ReturnType<typeof fresh>) => {
        details(p)[0].segments[0].numberOfStops++;
      },
      (p: ReturnType<typeof fresh>) => {
        details(p)[0].segments[0].stopsDetails[0].stopDuration++;
      },
      (p: ReturnType<typeof fresh>) => {
        details(p)[0].segments[0].stopsDetails[0].flightNumber = "9999";
      },
    ]) {
      const p = fresh();
      modify(p);
      expect(() => parseSouthwest(p, q)).toThrow();
    }
  });
  it("does not invent cash prices when the cash search or a matching flight is missing", () => {
    const p = fresh();
    delete p.cash;
    const rows = parseSouthwest(p, q);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(104);
    expect(rows.every((r) => r.fares!.every((f) => !f.cashFare))).toBe(true);
    const changed = fresh();
    const removed =
      changed.cash!.response.data.searchResults.airProducts[0].details.shift()!;
    const unmatched = parseSouthwest(changed, q).find(
      (r) =>
        r.segments.map((s) => s.flightNumber).join(",") ===
        removed.flightNumbers.map((n) => "WN" + n).join(","),
    )!;
    expect(unmatched.fares!.every((f) => !f.cashFare)).toBe(true);
  });
  it("does not match an unavailable cash family to another family's cash price", () => {
    const p = fresh(),
      flight = p.cash!.response.data.searchResults.airProducts[0].details[0];
    flight.fareProducts.ADULT.WGA = {
      availabilityStatus: "UNAVAILABLE",
      passengerType: "ADULT",
      cabinInfo: flight.fareProducts.ADULT.WGA.cabinInfo,
    };
    const row = parseSouthwest(p, q)[0];
    expect(
      row.fares!.find((f) => f.fareName === "Basic")!.cashFare,
    ).toBeUndefined();
    expect(row.fares!.filter((f) => f.cashFare)).toHaveLength(3);
  });
  it("rejects incompatible cash units, party sizes and inconsistent amounts", () => {
    const p = fresh();
    p.cash!.request.adultPassengersCount = "1";
    expect(() => parseSouthwest(p, q)).toThrow();
    for (const field of ["currencyCode", "value"]) {
      const p = fresh(),
        f =
          p.cash!.response.data.searchResults.airProducts[0].details[0]
            .fareProducts.ADULT.WGA;
      if (f.availabilityStatus !== "AVAILABLE") throw Error("Fixture changed");
      f.fare.totalFare[field as "value" | "currencyCode"] =
        field === "currencyCode" ? "MXN" : "1.00";
      expect(() => parseSouthwest(p, q)).toThrow();
    }
  });
  it("strips source selection tokens and account metadata from transport evidence", () => {
    const p = fresh();
    Object.assign(p.points.response, { account: "private", token: "private" });
    Object.assign(details(p)[0], { productId: "selection-only" });
    const clean = JSON.stringify(southwestPayloadSchema.parse(p));
    expect(clean).not.toContain("private");
    expect(clean).not.toContain("selection-only");
  });
  it("hands off the exact passenger count and correct points or cash mode", () => {
    for (const currency of ["POINTS", "USD"] as const) {
      const url = new URL(southwestBookingUrl(q, currency));
      expect(url.origin).toBe("https://www.southwest.com");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        originationAirportCode: "DEN",
        destinationAirportCode: "LAS",
        departureDate: "2026-10-05",
        adultPassengersCount: "2",
        adultsCount: "2",
        fareType: currency,
        tripType: "oneway",
      });
    }
  });
});
