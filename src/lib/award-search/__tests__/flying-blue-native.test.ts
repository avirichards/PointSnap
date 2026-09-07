import { describe, expect, it } from "vitest";
import one from "../fixtures/flying-blue-native-jfk-ams-one.json";
import fixture from "../fixtures/flying-blue-native-jfk-ams-two.json";
import {
  flyingBlueBookingUrl,
  flyingBluePayloadSchema,
  parseFlyingBlueNative,
} from "../flying-blue-native";
import type { SearchQuery } from "@/lib/types";

const q: SearchQuery = {
  origin: "JFK",
  dest: "AMS",
  departDate: "2026-10-08",
  pax: 2,
  minCabin: "Y",
};
const observed = "2026-09-06T22:56:00Z";
const fresh = () => structuredClone(fixture);
const parse = (input: unknown = fixture, query = q) =>
  parseFlyingBlueNative(input, query, observed);

describe("Flying Blue native member inventory", () => {
  it("validates the independently collected one-passenger date with three direct flights", () => {
    const rows = parse(one, { ...q, departDate: "2026-10-07", pax: 1 });
    expect(rows).toHaveLength(14);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(32);
    expect(rows.filter((r) => r.segments.length === 1)).toHaveLength(3);
    expect(rows[0].prices.Y).toMatchObject({
      points: 29000,
      partyPoints: 29000,
      quotedPassengers: 1,
      cash: 138,
    });
  });

  it("preserves all 13 itineraries and 32 expanded available fares", () => {
    const rows = parse();
    expect(rows).toHaveLength(13);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(32);
    expect(rows.filter((r) => r.segments.length === 1)).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(13);
    expect(
      rows.every(
        (r) => r.observedAt === observed && r.programId === "AF_FLYINGBLUE",
      ),
    ).toBe(true);
  });
  it("uses whole-party points and exact cash fees, not per-person card guesses", () => {
    const row = parse()[0];
    expect(row.prices.Y).toMatchObject({
      points: 29000,
      partyPoints: 58000,
      quotedPassengers: 2,
      cash: 138,
      currency: "USD",
    });
    expect(row.prices.J).toMatchObject({ points: 561000, cash: 347.1 });
    expect(row.segments[0]).toMatchObject({
      flightNumber: "KL642",
      operatingFlightNumber: "KL642",
      departure: "2026-10-08T16:40:00",
      arrival: "2026-10-09T06:00:00",
    });
  });
  it("keeps every independently observed Business itinerary", () => {
    const rows = parse(fixture, { ...q, minCabin: "J" });
    expect(rows).toHaveLength(9);
    expect(rows.flatMap((r) => r.fares!).every((f) => f.cabin === "J")).toBe(
      true,
    );
  });
  it("does not infer connecting cabins or exact seat counts from a cabin heading", () => {
    const rows = parse();
    expect(rows[0].prices.J).toMatchObject({
      segmentCabins: ["J"],
      cabinUnconfirmed: false,
      seats: null,
    });
    expect(rows[2].prices.W).toMatchObject({
      segmentCabins: [null, null],
      cabinUnconfirmed: true,
      seats: null,
    });
    expect(
      rows.every((r) =>
        r.fares!.every((f) => f.eligibility?.type === "account"),
      ),
    ).toBe(true);
    expect(rows[0].prices.J?.bookingNotes).toContain(
      "Refundable at a EUR 70 fee if you cancel before the 1st flight of your trip",
    );
  });
  it.each([
    { origin: "LAX" },
    { dest: "LHR" },
    { departDate: "2026-10-09" },
    { pax: 1 },
    { returnDate: "2026-10-20" },
  ])("rejects inventory belonging to another query: %j", (patch) =>
    expect(() => parse(fixture, { ...q, ...patch })).toThrow(),
  );
  it("rejects a cash, filtered-cabin or incomplete request", () => {
    const f = fresh();
    f.request.bookingFlow = "CASH";
    expect(() => parse(f)).toThrow();
    const g = fresh();
    g.request.availableOfferRequestBody.commercialCabins = ["BUSINESS"];
    expect(() => parse(g)).toThrow();
    const h = fresh();
    h.request.availableOfferRequestBody.withUpsellCabins = false;
    expect(() => parse(h)).toThrow();
  });
  it("fails visibly when a flight or cabin expansion is missing", () => {
    const f = fresh();
    f.expanded.pop();
    expect(() => parse(f)).toThrow(/every available flight/);
    const g = fresh();
    g.expanded[0].upsellRecommendations[0].upsellFlightProducts.pop();
    expect(() => parse(g)).toThrow(/every displayed cabin/);
  });
  it("rejects changed prices, passenger totals and duplicate expansions", () => {
    const f = fresh();
    f.expanded[0].upsellRecommendations[0].upsellFlightProducts[0].activeConnectionUpsell.taxDetails.relevantPrice += 1;
    expect(() => parse(f)).toThrow();
    const g = fresh();
    g.result.offerItineraries[0].upsellCabinProducts[0].connections[0].passengerCount = 1;
    expect(() => parse(g)).toThrow();
    const h = fresh();
    h.expanded.push(h.expanded[0]);
    expect(() => parse(h)).toThrow();
  });
  it("keeps additional fare families in the same cabin", () => {
    const f = fresh(),
      fares = f.expanded[0].upsellRecommendations[0].upsellFlightProducts;
    const extra = structuredClone(fares[0]);
    extra.activeConnectionUpsell.fareFamily.title = "Another offered fare";
    extra.price.relevantPrice += 10000;
    extra.activeConnectionUpsell.price.relevantPrice += 10000;
    fares.push(extra);
    expect(parse(f)[0].fares).toHaveLength(4);
    expect(parse(f)[0].prices.Y?.points).toBe(29000);
  });
  it("rejects unqualified technical stops and inconsistent connection durations", () => {
    const f = fresh();
    (
      f.result.offerItineraries[0].activeConnection.segments[0] as unknown as {
        stopsAt: unknown;
      }
    ).stopsAt = [{ code: "BOS" }];
    expect(() => parse(f)).toThrow();
    const g = fresh();
    g.result.offerItineraries[2].activeConnection.duration++;
    expect(() => parse(g)).toThrow();
  });
  it("does not mistake an unavailable cabin or unverified empty response for a priced flight", () => {
    const f = fresh(),
      unavailable =
        f.result.offerItineraries[6].upsellCabinProducts[2].connections[0];
    expect(unavailable.price.amount).toBeNull();
    expect(parse()[6].prices.J).toBeUndefined();
    unavailable.tax = { amount: 10, currencyCode: "USD" };
    expect(() => parse(f)).toThrow();
    const g = fresh();
    g.result.offerItineraries = [];
    g.expanded = [];
    expect(() => parse(g)).toThrow(/verified flight-result set/);
  });
  it("strips member, traveler and opaque source identifiers at the boundary", () => {
    const f = fresh();
    Object.assign(f.request.availableOfferRequestBody, {
      customer: { selectedTravelCompanions: [{ travelerKey: "private" }] },
    });
    Object.assign(f.request, { searchStateUuid: "private" });
    Object.assign(f.expanded[0].upsellRecommendations[0], {
      _id: "private",
      flyingBlueBenefits: { customer: "private" },
    });
    expect(JSON.stringify(flyingBluePayloadSchema.parse(f))).not.toContain(
      "private",
    );
    expect(JSON.stringify(parse(f))).not.toContain("private");
  });
  it("builds the official dated reward URL without account identifiers", () => {
    const url = new URL(flyingBlueBookingUrl(q));
    expect(url.origin + url.pathname).toBe(
      "https://www.klm.com/search/landing",
    );
    expect(url.searchParams.get("connections")).toBe("JFK:A:20261008>AMS:A");
    expect(url.searchParams.get("pax")).toBe("2:0:0:0:0:0:0:0");
    expect(url.searchParams.get("cabinClass")).toBe("ECONOMY");
  });
});
