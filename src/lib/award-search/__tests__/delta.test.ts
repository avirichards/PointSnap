import { describe, expect, it } from "vitest";
import source from "./fixtures/delta.json";
import partners from "./fixtures/delta-partners.json";
import { parseDelta } from "../delta";
const query = { ...source.query, minCabin: "Y" as const };
const fixture = () => structuredClone(source);

describe("complete Delta browser inventory", () => {
  it("retains all international partner fares using Delta's catalog cabin definitions", () => {
    const q = { ...partners.query, minCabin: "Y" as const };
    const rows = parseDelta(structuredClone(partners), q);
    expect(rows).toHaveLength(17);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(41);
    expect(
      new Set(rows.flatMap((r) => r.segments.map((s) => s.operatingAirline))),
    ).toEqual(new Set(["DL", "KL", "AF"]));
    expect(rows.every((r) => r.programId === "DL_SKYMILES")).toBe(true);
    expect(
      rows.some((r) => r.fares?.some((f) => f.cabin === "W" && f.mixedCabin)),
    ).toBe(true);
    const missing = structuredClone(partners);
    missing.brandDefinitions = [];
    expect(() => parseDelta(missing, q)).toThrow("unrecognized cabin brand");
    const unknown = structuredClone(partners);
    unknown.brandDefinitions[0].parentBrandId = "MYSTERY";
    expect(() => parseDelta(unknown, q)).toThrow(
      "unrecognized or duplicate catalog cabin",
    );
  });
  it("retains all 46 itineraries, 11 nonstops and 167 bookable fares across all three source pages", () => {
    const rows = parseDelta(fixture(), query);
    expect(rows).toHaveLength(46);
    expect(rows.filter((r) => r.segments.length === 1)).toHaveLength(11);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(167);
    expect(rows[0].fares?.map((f) => f.fareName)).toEqual([
      "Delta Main Basic",
      "Delta Main Classic",
      "Delta Comfort Classic",
      "Delta Premium Select Classic",
      "Delta One Classic",
    ]);
    expect(rows[0].fares?.slice(0, 3).map((f) => f.cabin)).toEqual([
      "Y",
      "Y",
      "Y",
    ]);
    expect(rows[0].prices.Y).toMatchObject({
      points: 40200,
      cash: 5.6,
      currency: "USD",
      seats: 9,
      bookingClasses: ["NE"],
    });
    expect(rows[0].prices.W?.cabin).toBe("W");
    expect(rows[0].prices.J?.cabin).toBe("J");
    expect(rows.at(-1)?.segments.map((s) => s.flightNumber)).toEqual([
      "DL390",
      "DL1575",
    ]);
    expect(rows.at(-1)?.fares).toHaveLength(3);
    expect(
      rows.find((r) => r.segments[0].flightNumber === "DL960")?.duration,
    ).toBe(321);
    expect(
      rows.find((r) => r.segments[0].flightNumber === "DL915")?.duration,
    ).toBe(319);
  });
  it("requires all source pages and exact counts, even when partial data has valid fares", () => {
    const missing = fixture();
    missing.pages.pop();
    expect(() => parseDelta(missing, query)).toThrow("unfinished page list");
    const missingRow = fixture();
    missingRow.pages[2].gqlOffersSets.pop();
    expect(() => parseDelta(missingRow, query)).toThrow(
      "incomplete itinerary count",
    );
    const swapped = fixture();
    swapped.pages.reverse();
    expect(() => parseDelta(swapped, query)).toThrow("inconsistent pagination");
    const duplicate = fixture();
    duplicate.pages[2].gqlOffersSets[0] = structuredClone(
      duplicate.pages[0].gqlOffersSets[0],
    );
    expect(() => parseDelta(duplicate, query)).toThrow("duplicate itineraries");
  });
  it("rejects a different route, date, passenger count or cash-search payload", () => {
    for (const change of [
      { origin: "SFO" },
      { dest: "LHR" },
      { departDate: "2026-10-06" },
      { pax: 2 },
    ])
      expect(() =>
        parseDelta(
          { ...fixture(), query: { ...source.query, ...change } },
          query,
        ),
      ).toThrow("different search request");
    expect(() =>
      parseDelta({ ...fixture(), priceType: "CASH" }, query),
    ).toThrow("different search request");
    const wrongTrip = fixture();
    wrongTrip.pages[2].gqlOffersSets[5].trips[0].destinationAirportCode = "EWR";
    expect(() => parseDelta(wrongTrip, query)).toThrow(
      "different route or date",
    );
  });
  it("preserves exact fees and rejects a price when only the rounded display amount remains", () => {
    const payload = fixture();
    const money =
      payload.pages[0].gqlOffersSets[0].offers[0].offerItems[0].retailItems[0]
        .retailItemMetaData.fareInformation[0].farePrice[0].totalFarePrice
        .currencyEquivalentPrice;
    Object.assign(money!, { formattedCurrencyAmt: undefined });
    expect(() => parseDelta(payload, query)).toThrow(
      "unrecognized flight information",
    );
    const unknownCurrency = fixture();
    unknownCurrency.pages[0].pricingOptions = [];
    expect(() => parseDelta(unknownCurrency, query)).toThrow(
      "ambiguous fee currency",
    );
  });
  it("reports mixed cabins and keeps available secondary fare families", () => {
    const payload = fixture(),
      last = payload.pages[2].gqlOffersSets.at(-1)!;
    const first = last.offers.find(
      (o) => o.additionalOfferProperties.dominantSegmentBrandId === "CFIRST",
    )!;
    first.offerItems[0].retailItems[0].retailItemMetaData.fareInformation[0].brandByFlightLegs[0].brandId =
      "CMAIN";
    const row = parseDelta(payload, query).at(-1)!;
    expect(row.prices.F).toMatchObject({
      mixedCabin: true,
      segmentCabins: ["Y", "F"],
    });
    expect(
      parseDelta(fixture(), query)[0].fares?.some(
        (f) => f.fareName === "Delta Main Classic",
      ),
    ).toBe(true);
  });
  it("fails on an unknown available cabin or incomplete leg mapping instead of dropping that fare", () => {
    const payload = fixture();
    payload.pages[0].gqlOffersSets[0].offers[0].additionalOfferProperties.dominantSegmentBrandId =
      "UNKNOWN";
    expect(() => parseDelta(payload, query)).toThrow(
      "unrecognized cabin brand",
    );
    const missing = fixture();
    missing.pages[0].gqlOffersSets[0].offers[0].offerItems[0].retailItems[0].retailItemMetaData.fareInformation[0].brandByFlightLegs =
      [];
    expect(() => parseDelta(missing, query)).toThrow("incomplete cabin list");
  });
});
