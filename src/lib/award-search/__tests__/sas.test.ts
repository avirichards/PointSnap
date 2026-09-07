import { describe, it, expect } from "vitest";
import arn from "./fixtures/sas-arn.json";
import jfk from "./fixtures/sas-jfk.json";
import { parseSas, sasPayloadSchema, sasObservationCounts } from "../sas";
import { sasBookingUrl } from "../../bookingHandoff";
const q = {
  origin: "CPH",
  dest: "ARN",
  departDate: "2026-10-05",
  pax: 2,
  minCabin: "Y" as const,
};
const copy = () => sasPayloadSchema.parse(structuredClone(arn));
describe("SAS anonymous award inventory", () => {
  it("retains all 20 flights and 72 Bonus and regular fare choices", () => {
    const rows = parseSas(arn, q);
    expect(rows).toHaveLength(20);
    expect(sasObservationCounts(arn.response)).toEqual({
      itineraries: 20,
      fares: 72,
    });
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(72);
    expect(rows.filter((r) => r.segments.length === 1)).toHaveLength(14);
    const f = rows.find((r) => r.segments[0].flightNumber === "SK402")!;
    expect(f.prices.Y).toMatchObject({
      points: 10000,
      partyPoints: 20000,
      cash: 38.01,
      currency: "EUR",
      quotedPassengers: 2,
    });
    expect(f.prices.J).toMatchObject({
      points: 20000,
      partyPoints: 40000,
      cash: 38.01,
    });
    expect(f.duration).toBe(75);
  });
  it("does not add the regular offer's cash reference price to award taxes", () => {
    const f = parseSas(arn, q).find(
      (r) => r.segments[0].flightNumber === "SK1416",
    )!;
    expect(f.fares).toHaveLength(3);
    expect(f.prices.J).toMatchObject({
      points: 53350,
      partyPoints: 106700,
      cash: 38.01,
      cabin: "J",
      segmentCabins: ["J"],
      refundable: null,
    });
    expect(f.prices.J?.cashFare).toBeUndefined();
    expect(f.fares?.find((x) => x.fareName === "BUSINESS FLEX")?.points).toBe(
      64375,
    );
  });
  it("keeps all transatlantic flights, Premium fares and unconfirmed connection cabins", () => {
    const rows = parseSas(jfk, { ...q, dest: "JFK" });
    expect(rows).toHaveLength(7);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(14);
    expect(
      rows.find((r) => r.segments.length === 1)?.prices.W?.segmentCabins,
    ).toEqual(["W"]);
    expect(rows.find((r) => r.segments.length === 2)?.prices.W).toMatchObject({
      cabinUnconfirmed: true,
      segmentCabins: [null, null],
    });
    expect(rows[0].segments.at(-1)?.arrival).toContain("-04:00");
  });
  it.each(["from", "to", "outDate", "adt"] as const)(
    "rejects a changed %s query",
    (field) => {
      const p = copy();
      p.request[field] = "wrong";
      expect(() => parseSas(p, q)).toThrow();
    },
  );
  it("rejects wrong party prices, taxes and segment availability", () => {
    for (const alter of [
      (p: ReturnType<typeof copy>) => {
        p.response.outboundFlights.F1.cabins.ECONOMY[
          "ECONOMY BONUS"
        ].products.O_1.price.points = 10000;
      },
      (p: ReturnType<typeof copy>) => {
        p.response.outboundFlights.F1.cabins.ECONOMY[
          "ECONOMY BONUS"
        ].products.O_1.price.totalTax = 38.01;
      },
      (p: ReturnType<typeof copy>) => {
        p.response.outboundFlights.F1.cabins.ECONOMY[
          "ECONOMY BONUS"
        ].products.O_1.fares[0].avlSeats = 1;
      },
    ]) {
      const p = copy();
      alter(p);
      expect(() => parseSas(p, q)).toThrow();
    }
  });
  it("rejects incomplete cabins, flight segments and unverified empty lists", () => {
    const a = copy();
    a.response.outboundFlights.F1.cabins.UNKNOWN =
      a.response.outboundFlights.F1.cabins.ECONOMY;
    expect(() => parseSas(a, q)).toThrow("unknown cabin");
    const b = copy();
    b.response.outboundFlights.F1.segments[0].arrivalDateTimeInGmt =
      "2026-10-05T07:15:00Z";
    expect(() => parseSas(b, q)).toThrow("segment times");
    const c = copy();
    c.response.outboundFlights = {};
    expect(() => parseSas(c, q)).toThrow("empty response");
  });
  it("does not persist account metadata or checkout identifiers", () => {
    const p = {
      ...arn,
      token: "SECRET",
      response: {
        ...arn.response,
        offerId: "SECRET",
        account: { email: "SECRET" },
      },
    };
    expect(JSON.stringify(sasPayloadSchema.parse(p))).not.toContain("SECRET");
  });
  it("prefills the actual points route, date and party without a selected-fare token", () => {
    const u = new URL(sasBookingUrl(q));
    expect(u.origin).toBe("https://www.flysas.com");
    expect(u.searchParams.get("search")).toBe("OW_CPH-ARN-20261005_a2c0i0y0");
    expect(u.searchParams.get("bookingFlow")).toBe("points");
  });
});
