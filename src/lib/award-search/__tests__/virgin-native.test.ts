import { describe, expect, it } from "vitest";
import one from "../fixtures/virgin-native-jfk-lhr-one.json";
import two from "../fixtures/virgin-native-jfk-lhr-two.json";
import connecting from "../fixtures/virgin-native-jfk-del-one.json";
import partner from "../fixtures/virgin-native-jfk-lhr-partner.json";
import deltaPartner from "../fixtures/virgin-native-lax-aus-partner.json";
import {
  parseVirginNative,
  virginPayloadSchema,
  virginBookingUrl,
} from "../virgin-native";
const observedAt = "2026-09-06T21:35:00Z";
const q = {
  origin: "JFK",
  dest: "LHR",
  departDate: "2026-10-07",
  pax: 1,
  minCabin: "Y" as const,
};
describe("native Flying Club flight awards", () => {
  it("keeps Delta's nonstop Main Cabin award and identifies domestic First separately from Business", () => {
    const query = {
      ...q,
      origin: "LAX",
      dest: "AUS",
      departDate: "2026-10-05",
    };
    const rows = parseVirginNative(deltaPartner, query, observedAt);
    expect(rows).toHaveLength(4);
    const nonstop = rows.find((r) => r.segments.length === 1)!;
    expect(nonstop.segments[0].flightNumber).toBe("DL692");
    expect(nonstop.prices.Y).toMatchObject({
      fareName: "Main Cabin",
      points: 16500,
      cash: 5.6,
    });
    const first = parseVirginNative(
      deltaPartner,
      { ...query, minCabin: "F" },
      observedAt,
    );
    expect(first).toHaveLength(1);
    expect(first[0].prices.F).toMatchObject({
      fareName: "First Class",
      cabin: "F",
      points: 101000,
      cash: 11.2,
      segmentCabins: ["F", "F"],
    });
    expect(first[0].prices.J).toBeUndefined();
  });
  it("retains the Air France partner connection and its actual Economy Standard fare", () => {
    const rows = parseVirginNative(partner, q, observedAt);
    expect(rows).toHaveLength(7);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(19);
    const af = rows.find((r) => r.segments[0].flightNumber === "AF11")!;
    expect(af.segments.map((s) => s.flightNumber)).toEqual(["AF11", "AF1280"]);
    expect(af.prices.Y).toMatchObject({
      fareName: "Economy Standard",
      cabin: "Y",
      points: 12000,
      cash: 184,
      currency: "USD",
      segmentCabins: ["Y", "Y"],
      bookingClasses: ["X", "X"],
    });
  });
  it("preserves all six flights and all 18 priced cabins with exact source fees", () => {
    const rows = parseVirginNative(one, q, observedAt);
    expect(rows).toHaveLength(6);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(18);
    expect(rows[0].prices.Y).toMatchObject({
      points: 125000,
      cash: 164.1,
      currency: "USD",
      seats: null,
    });
    expect(rows[0].prices.W?.cash).toBe(299.2);
    expect(rows[0].prices.J?.cash).toBe(704.5);
    expect(
      rows.every(
        (r) =>
          r.kind === "flight" &&
          r.fares!.every(
            (f) => f.eligibility?.type === "account" && !f.cashFare,
          ),
      ),
    ).toBe(true);
  });
  it("converts party totals to per-person prices and excludes the sold-out Upper Class fare", () => {
    const rows = parseVirginNative(
      two,
      { ...q, pax: 2, departDate: "2026-10-08" },
      observedAt,
    );
    expect(rows).toHaveLength(6);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(17);
    expect(rows[0].prices.Y).toMatchObject({
      points: 70000,
      partyPoints: 140000,
      quotedPassengers: 2,
      cash: 164.1,
    });
    expect(
      rows.find((r) => r.segments[0].flightNumber === "VS154")!.prices.J,
    ).toBeUndefined();
    expect(
      rows
        .flatMap((r) => r.fares!)
        .every((f) => f.points > 0 && f.partyPoints === f.points * 2),
    ).toBe(true);
  });
  it("keeps every connecting itinerary, local arrival date, exact fees and segment cabins", () => {
    const rows = parseVirginNative(
      connecting,
      { ...q, dest: "DEL" },
      observedAt,
    );
    expect(rows).toHaveLength(6);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(17);
    expect(rows[0].segments.map((s) => s.flightNumber)).toEqual([
      "VS154",
      "VS302",
    ]);
    expect(rows[0].segments[1].arrival).toBe("2026-10-09T00:05:00");
    expect(rows[0].duration).toBe(1080);
    expect(rows[0].prices.J).toMatchObject({
      points: 700000,
      cash: 1143.7,
      segmentCabins: ["J", "J"],
    });
    expect(rows[0].prices.W).toBeUndefined();
  });
  it("retains a short-leg cabin downgrade without changing the dominant cabin", () => {
    const p = virginPayloadSchema.parse(structuredClone(connecting));
    p.result.slice.flightsAndFares[0].fares[2].fareSegments![0].cabinName =
      "Economy Classic";
    const r = parseVirginNative(
      p,
      { ...q, dest: "DEL", minCabin: "J" },
      observedAt,
    )[0];
    expect(r.prices.J).toMatchObject({
      mixedCabin: true,
      segmentCabins: ["Y", "J"],
    });
    expect(r.prices.Y).toBeUndefined();
  });
  it.each([
    "route",
    "party",
    "date",
    "restricted",
    "missing-segment",
    "duration",
    "duplicate",
    "missing-price",
    "unverified-empty",
    "unknown-cabin",
    "technical-stop",
  ])(
    "rejects %s rather than returning a misleading partial success",
    (kind) => {
      const p = virginPayloadSchema.parse(structuredClone(one));
      const f = p.result.slice.flightsAndFares[0];
      if (kind === "route") p.result.criteria.destination.code = "MAN";
      if (kind === "party") p.request.customerDetails.push({ ptc: "ADT" });
      if (kind === "date") p.result.criteria.departing = "2026-10-08";
      if (kind === "restricted")
        Object.assign(p.request.flightSearchRequest, { nonStopOnly: true });
      if (kind === "missing-segment") f.flight.segments = [];
      if (kind === "duration") f.flight.duration = "PT7H";
      if (kind === "duplicate")
        p.result.slice.flightsAndFares.push(structuredClone(f));
      if (kind === "missing-price") f.fares[0].price = null;
      if (kind === "unverified-empty") p.result.slice.flightsAndFares = [];
      if (kind === "unknown-cabin")
        Object.assign(f.fares[0], { fareFamilyType: "UNRECOGNIZED" });
      if (kind === "technical-stop")
        Object.assign(f.flight.segments[0], { stopCount: 1 });
      expect(() => parseVirginNative(p, q, observedAt)).toThrow();
    },
  );
  it("strips basket, customer and fare-selection identifiers at the capture boundary", () => {
    const raw = structuredClone(one);
    Object.assign(raw.result, { basketId: "private-value" });
    Object.assign(raw.request.customerDetails[0], {
      custId: "private-value",
      email: "private-value",
    });
    Object.assign(raw.result.slice.flightsAndFares[0].fares[0], {
      fareId: "private-value",
      id: "private-value",
    });
    expect(JSON.stringify(virginPayloadSchema.parse(raw))).not.toContain(
      "private-value",
    );
  });
  it("uses the airline's public search handoff with the requested route, date and party", () => {
    const u = new URL(virginBookingUrl({ ...q, pax: 2 }));
    expect(u.hostname).toBe("www.virginatlantic.com");
    expect(u.searchParams.get("passengers")).toBe("a2t0c0i0");
    expect(u.searchParams.get("awardSearch")).toBe("true");
    expect(u.searchParams.get("departing")).toBe(q.departDate);
  });
});
