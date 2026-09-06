import { describe, it, expect } from "vitest";
import lax from "../fixtures/united-lax-aus.json";
import ewr from "../fixtures/united-ewr-lhr.json";
import {
  parseUnited,
  unitedPayloadSchema,
  unitedResponseSchema,
} from "../united";
const q = { ...lax.query, minCabin: "Y" as const };
const intl = { ...ewr.query, minCabin: "Y" as const };
describe("United member award inventory", () => {
  it("retains all domestic flights and distinct mixed-cabin choices without repeating identical columns", () => {
    const rows = parseUnited(lax, q);
    expect(rows).toHaveLength(38);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(100);
    const direct = rows.filter((r) => r.segments.length === 1);
    expect(direct).toHaveLength(2);
    for (const r of direct) {
      expect(r.fares).toHaveLength(2);
      expect(r.prices.Y).toMatchObject({
        points: 15000,
        cash: 5.6,
        currency: "USD",
        seats: null,
        quotedPassengers: 1,
      });
      expect(r.prices.F?.points).toBe(30000);
    }
    expect(
      rows.some((r) => r.fares!.filter((p) => p.cabin === "F").length === 2),
    ).toBe(true);
    expect(
      rows.flatMap((r) => r.fares!).filter((p) => p.mixedCabin),
    ).toHaveLength(24);
  });
  it("merges the initial six nonstops and all 63 connecting flights with exact two-adult context", () => {
    const rows = parseUnited(ewr, intl);
    expect(rows).toHaveLength(69);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(175);
    expect(
      rows.every((r) =>
        r.fares!.every(
          (p) =>
            p.quotedPassengers === 2 &&
            p.partyPoints === undefined &&
            p.seats === null,
        ),
      ),
    ).toBe(true);
    const flight = rows.find(
      (r) => r.segments.length === 1 && r.segments[0].flightNumber === "UA122",
    )!;
    expect(flight.prices.Y).toMatchObject({ points: 72100, cash: 5.6 });
    expect(flight.prices.W?.points).toBe(117900);
    expect(flight.prices.J?.points).toBe(200000);
    expect(rows.flatMap((r) => r.fares!).every((p) => p.points > 0)).toBe(true);
  });
  it("preserves airport changes and explicit member-price eligibility, without inventing public fares", () => {
    const rows = parseUnited(ewr, intl),
      changes = rows.filter((r) =>
        r.segments.some(
          (s, i) => i > 0 && r.segments[i - 1].destination !== s.origin,
        ),
      );
    expect(changes).toHaveLength(8);
    expect(
      changes.every((r) =>
        r.fares!.every((p) =>
          p.bookingNotes!.some((n) => n.startsWith("Airport change:")),
        ),
      ),
    ).toBe(true);
    expect(
      rows.every((r) =>
        r.fares!.every(
          (p) =>
            p.eligibility?.type === "account" &&
            p.eligibility.label === "Elite account price" &&
            p.cashFare === undefined,
        ),
      ),
    ).toBe(true);
  });
  it("does not classify domestic First connecting to Polaris as an economy downgrade", () => {
    const rows = parseUnited(ewr, intl);
    const p = rows
      .flatMap((r) => r.fares!)
      .find((p) => p.cabin === "J" && p.segmentCabins?.join() === "F,J")!;
    expect(p).toBeDefined();
    expect(p.mixedCabin).toBe(false);
  });
  it.each([
    "route",
    "date",
    "party",
    "page",
    "counts",
    "conflict",
    "eligibility",
    "unverified-empty",
    "stop",
  ])("rejects %s mismatches", (kind) => {
    const p = unitedPayloadSchema.parse(structuredClone(lax));
    const d = p.responses[0].data,
      t = d.Trips[0];
    if (kind === "route") t.Origin = "JFK";
    if (kind === "date") t.DepartDate = "2026-10-07";
    if (kind === "party") d.TravellerCount = 2;
    if (kind === "page") Object.assign(d, { PageCount: 2 });
    if (kind === "counts") t.FlightCount++;
    if (kind === "conflict") {
      p.responses.push(structuredClone(p.responses[0]));
      p.responses[1].data.Trips[0].Flights[0].Products[0].Prices[0].Amount++;
    }
    if (kind === "eligibility") {
      p.responses.push(structuredClone(p.responses[0]));
      p.responses[1].data.EliteLevel = 0;
    }
    if (kind === "unverified-empty") {
      t.Flights = [];
      t.FlightCount = 0;
    }
    if (kind === "stop")
      Object.assign(t.Flights[0], { StopInfos: [{ Airport: "ORD" }] });
    expect(() => parseUnited(p, q)).toThrow();
  });
  it("strips all account/session fields at every capture boundary", () => {
    const raw = structuredClone(lax.responses[0]);
    Object.assign(raw.data, {
      LOYALTYID: "private",
      CartId: "private",
      Characteristics: [{ Code: "LOYALTYID", Value: "private" }],
    });
    Object.assign(raw.data.Trips[0].Flights[0], { BBXHash: "private" });
    const data = unitedResponseSchema.parse(raw);
    expect(JSON.stringify(data)).not.toContain("private");
  });
  it("coalesces an exact repeated response without dropping a distinct batch", () => {
    const p = structuredClone(ewr);
    p.responses.push(structuredClone(p.responses[0]));
    expect(parseUnited(p, intl)).toHaveLength(69);
  });
});
