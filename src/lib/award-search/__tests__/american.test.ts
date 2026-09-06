import { describe, expect, it } from "vitest";
import { parseAmerican } from "../american";
import { DIRECT_PROGRAMS } from "../direct";
import { americanFixture } from "./fixtures/american";
import type { SearchQuery } from "@/lib/types";

const q: SearchQuery = {
  origin: "LAX",
  dest: "AUS",
  departDate: "2026-09-07",
  pax: 1,
  minCabin: "Y",
};

describe("American native response candidate", () => {
  function cabinSearches() {
    const all = americanFixture(),
      premium = americanFixture();
    all.slices = all.slices.slice(0, 2);
    premium.slices = premium.slices.slice(1, 3);
    for (const row of premium.slices)
      row.pricingDetail = row.pricingDetail.filter(
        (fare) => fare.productType === "FIRST",
      );
    return {
      type: "american-cabin-searches",
      searches: [
        { cabin: "all", payload: all },
        { cabin: "premium", payload: premium },
      ],
    };
  }

  it("adds premium-search itineraries without duplicating flights or keeping superseded prices", () => {
    const payload = cabinSearches();
    payload.searches[1].payload.slices[0].pricingDetail[0].perPassengerAwardPoints = 77777;
    const rows = parseAmerican(payload, q);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows[1].prices.Y?.points).toBe(32000);
    expect(rows[1].prices.F?.points).toBe(77777);
    expect(rows[1].fares?.filter((fare) => fare.cabin === "F")).toHaveLength(1);
    expect(rows[2].prices.F).toBeDefined();
    expect(rows[2].prices.Y).toBeUndefined();
  });

  it("removes an earlier First quote when the later same-itinerary premium search only supplies Business", () => {
    const payload = cabinSearches(),
      premium = payload.searches[1].payload.slices[0];
    premium.pricingDetail[0].productType = "BUSINESS";
    for (const segment of premium.segments)
      for (const leg of segment.legs)
        for (const product of leg.productDetails)
          if (product.productType === "FIRST") {
            product.productType = "BUSINESS";
            product.cabinType = "BUSINESS";
          }
    const row = parseAmerican(payload, q)[1];
    expect(row.prices.F).toBeUndefined();
    expect(row.fares?.some((fare) => fare.cabin === "F")).toBe(false);
    expect(row.prices.J?.points).toBe(39000);
    expect(row.prices.Y?.points).toBe(32000);
  });

  it("requires both distinct complete cabin responses and validates their query independently", () => {
    for (const mutate of [
      (p: ReturnType<typeof cabinSearches>) => {
        p.searches.pop();
      },
      (p: ReturnType<typeof cabinSearches>) => {
        p.searches[1].cabin = "all";
      },
      (p: ReturnType<typeof cabinSearches>) => {
        p.searches[1].payload.responseMetadata.destination.code = "JFK";
      },
      (p: ReturnType<typeof cabinSearches>) => {
        Object.assign(p.searches[1].payload, { hasMore: true });
      },
      (p: ReturnType<typeof cabinSearches>) => {
        p.searches[1].payload.slices[0].pricingDetail[0].allPassengerTaxesAndFees.amount = 999;
      },
    ]) {
      const payload = cabinSearches();
      mutate(payload);
      expect(() => parseAmerican(payload, q)).toThrow();
    }
  });

  it("rejects an all-cabin result mislabeled as a premium search", () => {
    const payload = cabinSearches();
    payload.searches[1].payload = americanFixture();
    expect(() => parseAmerican(payload, q)).toThrow("different cabin search");
  });

  it("retains all 40 source itineraries and 69 available fares, including partners and the final overnight result", () => {
    const rows = parseAmerican(americanFixture(), q);
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((row) => row.id)).size).toBe(40);
    expect(rows.reduce((n, row) => n + row.fares!.length, 0)).toBe(69);
    expect(rows.filter((row) => row.segments.length === 1)).toHaveLength(2);
    expect(rows[1].prices.Y).toMatchObject({
      points: 32000,
      cash: 5.6,
      currency: "USD",
      seats: null,
    });
    expect(rows[1].prices.F).toMatchObject({
      points: 39000,
      seats: 3,
      cabin: "F",
      bookingClasses: ["J"],
    });
    expect(rows[7]).toMatchObject({
      programId: "AA_AADVANTAGE",
      segments: [{ airline: "AS" }, { airline: "AS" }],
    });
    expect(rows[21].prices.Y?.bookingClasses).toEqual(["T", "S"]);
    expect(rows[39].segments.at(-1)?.arrival).toBe(
      "2026-09-08T11:22:00.000-05:00",
    );
    expect(rows[39].prices.F?.points).toBe(150000);
    expect(rows[0].segments[0].operatedBy).toBe(
      "SkyWest Airlines as American Eagle",
    );
    expect(rows[0].segments[0].operatingAirline).toBeUndefined();
  });

  it("cannot turn a valid fixture into an enabled live connection", () => {
    expect(DIRECT_PROGRAMS).not.toContain("AA_AADVANTAGE");
  });

  it("rejects errors, partial lists, wrong routes, wrong dates and revenue/cached responses", () => {
    for (const modify of [
      (p: ReturnType<typeof americanFixture>) => {
        p.error = "ERROR-309";
      },
      (p: ReturnType<typeof americanFixture>) => {
        Object.assign(p, { hasMore: true });
      },
      (p: ReturnType<typeof americanFixture>) => {
        Object.assign(p, { totalCount: 41 });
      },
      (p: ReturnType<typeof americanFixture>) => {
        p.responseMetadata.destination.code = "JFK";
      },
      (p: ReturnType<typeof americanFixture>) => {
        p.responseMetadata.departureDate = "2026-09-08";
      },
      (p: ReturnType<typeof americanFixture>) => {
        p.responseMetadata.searchType = "Revenue";
      },
      (p: ReturnType<typeof americanFixture>) => {
        p.responseMetadata.cached = true;
      },
    ]) {
      const payload = americanFixture();
      modify(payload);
      expect(() => parseAmerican(payload, q)).toThrow(
        "Complete availability could not be confirmed",
      );
    }
  });

  it("rejects a bad row at the end instead of silently truncating or skipping it", () => {
    const payload = americanFixture();
    payload.slices[39].segments[1].legs[0].origin.code = "DFW";
    expect(() => parseAmerican(payload, q)).toThrow("disconnected itinerary");
    const duplicate = americanFixture();
    duplicate.slices.push(duplicate.slices[0]);
    expect(() => parseAmerican(duplicate, q)).toThrow("duplicate itinerary");
  });

  it("preserves mixed cabins and additional fare choices in the same cabin", () => {
    const payload = americanFixture();
    const row = payload.slices[2];
    row.segments[1].legs[0].productDetails[1].cabinType = "COACH";
    const extra = structuredClone(row.pricingDetail[0]);
    extra.perPassengerAwardPoints = 55000;
    row.pricingDetail[0].refundableProducts.push(extra);
    const parsed = parseAmerican(payload, q)[2];
    expect(parsed.fares).toHaveLength(3);
    expect(parsed.prices.Y?.points).toBe(52000);
    expect(parsed.prices.F).toMatchObject({
      mixedCabin: true,
      segmentCabins: ["F", "Y"],
    });
    row.segments[1].legs[0].productDetails[1].cabinType = "UNKNOWN";
    expect(() => parseAmerican(payload, q)).toThrow("unknown cabin");
  });

  it("keeps zero warnings as unknown seats, preserves decimals and checks party totals", () => {
    expect(() => parseAmerican(americanFixture(), { ...q, pax: 2 })).toThrow(
      "passenger total",
    );
    const payload = americanFixture();
    payload.slices = payload.slices.slice(0, 1);
    for (const fare of payload.slices[0].pricingDetail)
      fare.allPassengerTaxesAndFees.amount *= 2;
    const row = parseAmerican(payload, { ...q, pax: 2 })[0];
    expect(row.prices.Y).toMatchObject({
      cash: 5.6,
      seats: null,
      points: 76500,
      partyPoints: 153000,
      quotedPassengers: 2,
    });
    expect(row.prices.F?.seats).toBe(2);
    payload.slices[0].pricingDetail[1].seatsRemaining = 1;
    expect(() => parseAmerican(payload, { ...q, pax: 2 })).toThrow(
      "too few seats",
    );
  });
});
