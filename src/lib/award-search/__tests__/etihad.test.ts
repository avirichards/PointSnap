import { describe, expect, it } from "vitest";
import london from "./fixtures/etihad-london.json";
import fixture from "./fixtures/etihad.json";
import { etihadPayloadSchema, etihadBookingUrl, parseEtihad } from "../etihad";
import { validateEtihadRequest } from "../../../../browser-worker/etihad";

const q = { ...fixture.query, minCabin: "Y" as const };
const fresh = () => etihadPayloadSchema.parse(structuredClone(fixture.payload));
describe("native Etihad award inventory", () => {
  it("retains First fares in GBP and explicitly describes rail connections and station transfers", () => {
    const rows = parseEtihad(london.payload, {
      ...london.query,
      minCabin: "Y",
    });
    expect(rows).toHaveLength(7);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(76);
    expect(
      rows.find((r) => r.segments[0].flightNumber === "EY66")?.prices.F,
    ).toMatchObject({
      points: 120000,
      partyPoints: 240000,
      cash: 514.19,
      currency: "GBP",
    });
    const rail = rows.find((r) => r.segments[0].flightNumber === "EY8756")!;
    expect(rail.segments[0]).toMatchObject({
      operatingAirline: null,
      operatedBy: "AVANTI WEST COAST FOR ACCESRAIL INC",
      aircraft: "TRAIN",
    });
    expect(rail.segments[0].technicalStops?.map((s) => s.airport)).toEqual([
      "QQU",
      "XVC",
    ]);
    expect(rail.fares![0].bookingNotes?.join(" ")).toContain(
      "Transfer between QQM and MAN is required; check the airline's transfer arrangements.",
    );
    expect(
      rows
        .find((r) => r.segments[0].flightNumber === "EY68")!
        .fares![0].bookingNotes?.some((n) => n.startsWith("Includes ")),
    ).toBe(false);
  });
  it("replaces earlier cabin fares when booking classes change in the later search", () => {
    const p = fresh();
    const g = p.searches[1].response.data.airBoundGroups.find((g) =>
      g.boundDetails.segments.some((s) => s.flightId.startsWith("SEG-EY2-")),
    )!;
    g.airBounds.find(
      (f) => f.fareFamilyCode === "JVALUE",
    )!.availabilityDetails[0].bookingClass = "D";
    const row = parseEtihad(p, q).find(
      (r) => r.segments[0].flightNumber === "EY2",
    )!;
    expect(
      row.fares!.filter(
        (f) => f.fareName === "Value · Pay with miles" && f.cabin === "J",
      ),
    ).toHaveLength(1);
    expect(row.prices.J?.bookingClasses).toEqual(["D"]);
  });
  it("retains all 38 available fares across six itineraries and both cabin searches", () => {
    const rows = parseEtihad(fresh(), q);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.fares!.length)).toEqual([1, 9, 9, 7, 6, 6]);
    const direct = rows.find((r) => r.segments[0].flightNumber === "EY2")!;
    expect(direct).toMatchObject({
      duration: 760,
      programId: "EY_GUEST",
      freshness: "live",
    });
    expect(direct.prices.Y).toMatchObject({
      points: 60000,
      partyPoints: 120000,
      cash: 224.9,
      currency: "USD",
      quotedPassengers: 2,
      refundable: false,
    });
    expect(direct.prices.J).toMatchObject({
      points: 540375,
      partyPoints: 1080750,
      cash: 579.9,
    });
    expect(direct.fares!.filter((f) => f.cabin === "J")).toHaveLength(3);
    expect(
      direct.fares!.find((f) => f.fareName === "Comfort · GuestSeat"),
    ).toMatchObject({ points: 73200, refundable: true });
  });
  it("uses miles for the base fare plus exact full cash taxes, not the alternate tax conversion", () => {
    const row = parseEtihad(fresh(), q).find(
      (r) => r.segments[0].flightNumber === "AA236",
    )!;
    expect(row.prices.Y).toMatchObject({ points: 85000, cash: 249.6 });
    expect(row.prices.J).toBeUndefined(); // priced, but zero seats on AA236
    expect(row.segments.map((s) => s.flightNumber)).toEqual(["AA236", "EY86"]);
  });
  it("keeps codeshare operators and mixed segment cabins", () => {
    const row = parseEtihad(fresh(), q).find(
      (r) => r.segments[0].flightNumber === "EY8304",
    )!;
    expect(row.segments[0]).toMatchObject({
      airline: "EY",
      operatingAirline: "B6",
      origin: "JFK",
      destination: "BOS",
    });
    expect(row.prices.J).toMatchObject({
      mixedCabin: true,
      segmentCabins: ["Y", "J"],
    });
  });
  it("rejects wrong route, date or party rather than reusing an unrelated observation", () => {
    for (const changed of [
      { origin: "EWR" },
      { dest: "DXB" },
      { pax: 1 },
      { departDate: "2026-10-06" },
    ])
      expect(() => parseEtihad(fresh(), { ...q, ...changed })).toThrow();
  });
  it("rejects missing cabins, source caps, missing segment data and malformed available fares", () => {
    const missing = fresh();
    missing.searches.pop();
    const cap = fresh();
    cap.searches[0].limit = 6;
    const segment = fresh();
    delete segment.searches[0].response.dictionaries.flight[
      Object.keys(segment.searches[0].response.dictionaries.flight)[0]
    ];
    const price = fresh();
    price.searches[0].response.data.airBoundGroups[1].airBounds[0].prices
      .totalPrices[0].totalTaxes++;
    const travelers = fresh();
    travelers.searches[0].response.data.airBoundGroups[1].airBounds[0].prices.unitPrices[0].travelerIds =
      ["ADT-1", "ADT-1"];
    for (const p of [missing, cap, segment, price, travelers])
      expect(() => parseEtihad(p, q)).toThrow();
  });
  it("does not silently keep an older quote when the later cabin search withdraws a fare", () => {
    const p = fresh();
    const group = p.searches[1].response.data.airBoundGroups.find((g) =>
      g.boundDetails.segments.some((s) => s.flightId.startsWith("SEG-EY2-")),
    )!;
    const f = group.airBounds.find((f) => f.fareFamilyCode === "JVALUE")!;
    f.availabilityDetails[0].quota = 0;
    const direct = parseEtihad(p, q).find(
      (r) => r.segments[0].flightNumber === "EY2",
    )!;
    expect(direct.prices.J?.fareName).toBe("Comfort · Pay with miles");
  });
  it("strips session identifiers and account metadata from the transport payload", () => {
    const p = structuredClone(fixture.payload) as unknown as Record<
      string,
      unknown
    >;
    p.frequentFlyer = { cardNumber: "not-a-real-account" };
    const text = JSON.stringify(etihadPayloadSchema.parse(p));
    expect(text).not.toMatch(
      /cardNumber|airBoundId|officeId|corporateCode|authorization/i,
    );
  });
  it("creates a normal one-way miles URL with every adult and validates the actual airline request", () => {
    const url = new URL(etihadBookingUrl(q, "B"));
    expect(url.searchParams.get("TRAVELERS")).toBe("ADT,ADT");
    expect(url.searchParams.get("FLOW")).toBe("AWARD");
    expect(
      new URL(etihadBookingUrl({ ...q, minCabin: "F" })).searchParams.get(
        "CABIN",
      ),
    ).toBe("B");
    const req = {
      commercialFareFamilies: ["BUSINESS", "FIRST"],
      itineraries: [
        {
          originLocationCode: q.origin,
          destinationLocationCode: q.dest,
          departureDateTime: q.departDate + "T00:00:00.000",
          isRequestedBound: true,
        },
      ],
      travelers: [{ passengerTypeCode: "ADT" }, { passengerTypeCode: "ADT" }],
      searchPreferences: {
        showMilesPrice: true,
        showSoldOut: true,
        maxFlightCombinationsPerBound: 25,
      },
    };
    expect(validateEtihadRequest(req, q, ["BUSINESS", "FIRST"])).toBe(25);
    expect(() =>
      validateEtihadRequest(
        { ...req, travelers: req.travelers.slice(0, 1) },
        q,
        ["BUSINESS", "FIRST"],
      ),
    ).toThrow();
    expect(() =>
      validateEtihadRequest(
        {
          ...req,
          searchPreferences: {
            ...req.searchPreferences,
            showMilesPrice: false,
          },
        },
        q,
        ["BUSINESS", "FIRST"],
      ),
    ).toThrow();
  });
});
