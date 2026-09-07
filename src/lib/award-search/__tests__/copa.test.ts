import { describe, it, expect } from "vitest";
import one from "./fixtures/copa-lax-one.json";
import two from "./fixtures/copa-lax-two.json";
import jfk from "./fixtures/copa-jfk-two.json";
import { copaPayloadSchema, copaObservationCounts, parseCopa } from "../copa";
const q = {
  origin: "LAX",
  dest: "PTY",
  departDate: "2026-10-05",
  pax: 2,
  minCabin: "Y" as const,
};
const copy = () => copaPayloadSchema.parse(structuredClone(two));
describe("Copa native anonymous award inventory", () => {
  it("preserves every matching flight and fare, separately accounting for nearby departures", () => {
    const rows = parseCopa(two, q);
    expect(copaObservationCounts(two.response, q)).toEqual({
      itineraries: 49,
      fares: 63,
      exactItineraries: 46,
      exactFares: 60,
      otherAirportItineraries: 3,
    });
    expect(rows).toHaveLength(46);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(60);
    expect(
      rows.every((r) => r.origin === "LAX" && r.destination === "PTY"),
    ).toBe(true);
    expect(rows.filter((r) => r.segments.length === 1)).toHaveLength(3);
  });
  it("distinguishes per-person prices from selected-cart party totals", () => {
    for (const [fixture, pax] of [
      [one, 1],
      [two, 2],
    ] as const) {
      const row = parseCopa(fixture, { ...q, pax }).find(
        (r) => r.segments[0].flightNumber === "CM306",
      )!;
      expect(row.prices.Y).toMatchObject({
        points: 40000,
        partyPoints: 40000 * pax,
        cash: 33.6,
        currency: "USD",
        quotedPassengers: pax,
        segmentCabins: ["Y"],
        seats: null,
        refundable: null,
      });
      expect(row.prices.Y?.cashFare).toBeUndefined();
      expect(row.prices.Y?.bookingNotes?.join(" ")).toContain(
        "final cost may differ",
      );
      expect(row.duration).toBe(393);
      expect(row.segments[0].departure).toBe("2026-10-05T02:22:00");
    }
    expect(
      parseCopa(one, { ...q, pax: 1 }).flatMap((r) => r.fares!),
    ).toHaveLength(65);
  });
  it("retains Saver and Standard choices without guessing connecting cabins or operator codes", () => {
    const rows = parseCopa(jfk, {
      ...q,
      origin: "JFK",
      departDate: "2026-10-06",
    });
    expect(rows).toHaveLength(8);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(17);
    expect(
      copaObservationCounts(jfk.response, { origin: "JFK", dest: "PTY" })
        .otherAirportItineraries,
    ).toBe(37);
    const connected = rows.find((r) => r.segments.length > 1)!;
    expect(
      connected.fares!.every(
        (f) => f.cabinUnconfirmed && f.segmentCabins?.every((c) => c === null),
      ),
    ).toBe(true);
    const branded = rows.find((r) => r.segments[0].flightNumber === "CM807")!;
    expect(branded.prices.Y?.cabin).toBe("Y");
    expect(branded.prices.J?.cabin).toBe("J");
    expect(
      new Set(rows.flatMap((r) => r.fares!.map((f) => f.fareName))),
    ).toEqual(
      new Set(["Economy Standard", "Business Standard", "Business Saver"]),
    );
  });
  it("keeps intermediate stops on the same flight distinct from connections", () => {
    const row = parseCopa(two, q).find((r) =>
      r.segments.some((s) => s.flightNumber === "CM392"),
    )!;
    expect(row.segments).toHaveLength(2);
    expect(row.segments[1].technicalStops).toEqual([
      {
        airport: "SJO",
        arrival: "2026-10-06T08:07:00",
        departure: "2026-10-06T08:45:00",
        duration: 38,
      },
    ]);
    expect(row.segments[1].flightNumber).toBe("CM392");
  });
  it.each([
    "departureAirport1",
    "arrivalAirport1",
    "departureDate1",
    "adults",
  ] as const)("rejects a mismatched actual request: %s", (field) => {
    const p = copy();
    Object.assign(p.request, { [field]: field === "adults" ? 1 : "wrong" });
    expect(() => parseCopa(p, q)).toThrow();
  });
  it("rejects inconsistent cash, party, discounted prices and missing fare classes", () => {
    const mutations = [
      (p: ReturnType<typeof copy>) => {
        p.response[0].solutions[0].offers[0].totalPrice.taxes = 33.6;
      },
      (p: ReturnType<typeof copy>) => {
        p.response[0].solutions[0].offers[0].totalPrice.miles = 40000;
      },
      (p: ReturnType<typeof copy>) => {
        p.response[0].solutions[0].offers[0].originalPricePerAdult = 50000;
      },
      (p: ReturnType<typeof copy>) => {
        p.response[0].solutions[0].offers[0].classOfService = [];
      },
    ];
    for (const mutate of mutations) {
      const p = copy();
      mutate(p);
      expect(() => parseCopa(p, q)).toThrow();
    }
  });
  it("rejects member promotions, empty responses and malformed segment data", () => {
    const a = copy();
    Object.assign(a.response[0], { discountType: "MEMBER" });
    expect(() => parseCopa(a, q)).toThrow();
    const b = copy();
    b.response[0].solutions = [];
    expect(() => parseCopa(b, q)).toThrow(/empty response/);
    const c = copy();
    c.response[0].solutions[0].flights[0].thruFlights = 1;
    expect(() => parseCopa(c, q)).toThrow(/stop details/);
    const d = copy();
    d.response[0].solutions[3].flights[1].departure.airportCode = "LHR";
    expect(() => parseCopa(d, q)).toThrow(/connecting airports/);
    const e = copy();
    e.response[0].solutions.push(e.response[0].solutions[0]);
    expect(() => parseCopa(e, q)).toThrow(/duplicate physical/);
  });
  it("does not preserve session, offer references or account metadata in fixtures", () => {
    const p = copy();
    Object.assign(p, { token: "private" });
    Object.assign(p.response[0], { sessionId: "private" });
    Object.assign(p.response[0].solutions[0], { key: "private" });
    Object.assign(p.response[0].solutions[0].offers[0], {
      id: "private",
      fareRefKey: ["private"],
    });
    expect(JSON.stringify(copaPayloadSchema.parse(p))).not.toContain("private");
  });
});
