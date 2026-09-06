import { describe, it, expect } from "vitest";
import {
  defaultFilters,
  filterGroups,
  flightKey,
  groupFlights,
  layovers,
  matchesOffer,
  sortGroups,
  lowestFareForDate,
  activeSortCabin,
  type FlightOffer,
} from "../comparison";
import type { AwardResult, AwardPrice } from "../types";
import { stopSummary } from "../stops";
const price = (patch: Partial<AwardPrice> = {}): AwardPrice => ({
  cabin: "Y",
  points: 10000,
  cash: 6,
  currency: "USD",
  seats: 2,
  mixedCabin: false,
  ...patch,
});
const row = (patch: Partial<AwardResult> = {}): AwardResult => ({
  id: "a",
  programId: "AA_AADVANTAGE",
  origin: "JFK",
  destination: "LAX",
  date: "2026-10-05",
  kind: "flight",
  segments: [
    {
      origin: "JFK",
      destination: "LAX",
      departure: "2026-10-05T06:00:00-04:00",
      arrival: "2026-10-05T09:00:00-07:00",
      airline: "AA",
      flightNumber: "AA00171",
      aircraft: "A321",
    },
  ],
  duration: 360,
  prices: { Y: price() },
  source: "Test",
  freshness: "live",
  observedAt: "2026-09-05T00:00:00Z",
  bookingUrl: "https://www.aa.com",
  ...patch,
});
const offer = (r: AwardResult, p = price()): FlightOffer => ({
  id: "o",
  row: r,
  price: p,
});
describe("exact physical itinerary comparisons", () => {
  it("groups the same American flight across local-clock and offset providers without dropping fares", () => {
    const local = row({
      id: "smiles",
      programId: "G3_GOL_SMILES",
      origin: "LAX",
      destination: "AUS",
      segments: [
        {
          origin: "LAX",
          destination: "AUS",
          departure: "2026-10-05T16:46:00",
          arrival: "2026-10-05T21:42:00",
          airline: "AA",
          flightNumber: "AA2118",
        },
      ],
    });
    const offset = row({
      ...local,
      id: "alaska",
      programId: "AS_MILEAGEPLAN",
      segments: local.segments.map((s) => ({
        ...s,
        departure: s.departure + "-07:00",
        arrival: s.arrival + "-05:00",
      })),
    });
    const groups = groupFlights([local, offset]);
    expect(groups).toHaveLength(1);
    expect(groups[0].programs).toEqual(["G3_GOL_SMILES", "AS_MILEAGEPLAN"]);
    expect(groups[0].offers).toHaveLength(2);
    const differentTime = row({
      ...offset,
      id: "different",
      segments: offset.segments.map((s) => ({
        ...s,
        departure: "2026-10-05T16:47:00-07:00",
      })),
    });
    expect(groupFlights([local, differentTime])).toHaveLength(2);
  });
  it("shows confirmed stop details from matching offers instead of an earlier uncertain source", () => {
    const cached = row({
      id: "cached",
      programId: "QF_FF",
      freshness: "cached",
      stopDetailsUnconfirmed: true,
    });
    const live = row({
      id: "live",
      programId: "G3_GOL_SMILES",
      stopDetailsUnconfirmed: false,
    });
    const groups = groupFlights([cached, live]);
    const all = filterGroups(groups, defaultFilters(), 1);
    expect(all[0].offers).toHaveLength(2);
    expect(stopSummary(all[0].row)).toBe("Nonstop");
    const nonstop = filterGroups(
      groups,
      { ...defaultFilters(), maxStops: "0" },
      1,
    );
    expect(nonstop[0].programs).toEqual(["G3_GOL_SMILES"]);
    expect(nonstop[0].row.id).toBe("live");
    expect(stopSummary(nonstop[0].row)).toBe("Nonstop");
    const onlyCached = filterGroups(
      groups,
      { ...defaultFilters(), programs: ["QF_FF"] },
      1,
    );
    expect(onlyCached[0].row.id).toBe("cached");
    expect(stopSummary(onlyCached[0].row)).toBe("Direct · check stops");
  });
  it("keeps date prices and sorting aligned after economy is filtered to business", () => {
    const groups = groupFlights([
      row({ fares: [price(), price({ cabin: "J", points: 60000 })] }),
    ]);
    const business = filterGroups(
      groups,
      { ...defaultFilters(), cabins: ["J"] },
      1,
    );
    expect(lowestFareForDate(business, "2026-10-05")).toEqual({
      points: 60000,
      cabin: "J",
    });
    expect(activeSortCabin(["J"], "Y")).toBe("J");
    expect(lowestFareForDate(business, "2026-10-06")).toBeNull();
  });
  it("uses the cheapest matching offer across selected cabins and preserves party totals", () => {
    const groups = groupFlights([
      row({
        fares: [
          price({ points: 5000 }),
          price({ cabin: "W", points: 30000 }),
          price({ cabin: "J", points: 40000 }),
        ],
      }),
    ]);
    const premium = filterGroups(
      groups,
      { ...defaultFilters(), cabins: ["W", "J"] },
      2,
    );
    expect(lowestFareForDate(premium, "2026-10-05", 2, true)).toEqual({
      points: 60000,
      cabin: "W",
    });
    expect(activeSortCabin(["W", "J"], "Y")).toBeNull();
    expect(activeSortCabin(["W", "J"], "J")).toBe("J");
    expect(
      lowestFareForDate(
        filterGroups(
          groups,
          { ...defaultFilters(), cabins: ["J"], maxPoints: "20000" },
          1,
        ),
        "2026-10-05",
      ),
    ).toBeNull();
  });
  it("groups programs without losing any fare choices", () => {
    const a = row({
        fares: [
          price({ fareId: "Y1" }),
          price({ fareId: "J1", cabin: "J", points: 50000 }),
        ],
      }),
      b = row({
        id: "b",
        programId: "AS_MILEAGEPLAN",
        fares: [price({ fareId: "Y2", points: 12000 })],
      });
    const groups = groupFlights([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].programs).toHaveLength(2);
    expect(groups[0].offers).toHaveLength(3);
  });
  it("normalizes equivalent instants and zero-padded flight numbers", () => {
    const a = row(),
      b = row({
        id: "b",
        segments: [
          {
            ...a.segments[0],
            flightNumber: "AA171",
            departure: "2026-10-05T10:00:00Z",
            arrival: "2026-10-05T16:00:00Z",
          },
        ],
      });
    expect(flightKey(a)).toBe(flightKey(b));
  });
  it("keeps distinct departures, partial schedules and unproven codeshares separate", () => {
    const a = row();
    for (const patch of [
      { departure: "2026-10-05T06:05:00-04:00" },
      { arrival: null },
      { flightNumber: "AS123" },
    ]) {
      expect(
        groupFlights([
          a,
          row({ id: "b", segments: [{ ...a.segments[0], ...patch }] }),
        ]),
      ).toHaveLength(2);
    }
  });
  it("never groups calendar quotes as physical flights", () =>
    expect(
      groupFlights([row(), row({ id: "c", kind: "calendar", segments: [] })]),
    ).toHaveLength(1));
  it("filters the same offer, not a cheap cabin on the same itinerary", () => {
    const r = row({
      fares: [
        price({ fareId: "y" }),
        price({ fareId: "j", cabin: "J", points: 60000 }),
      ],
    });
    const f = {
      ...defaultFilters(),
      cabins: ["J" as const],
      maxPoints: "20000",
    };
    expect(filterGroups(groupFlights([r]), f, 1)).toEqual([]);
  });
  it("a refundable alternative survives even when the cheapest fare is not refundable", () => {
    const r = row({
      fares: [
        price({ fareId: "base", refundable: false }),
        price({ fareId: "flex", points: 15000, refundable: true }),
      ],
    });
    const g = filterGroups(
      groupFlights([r]),
      { ...defaultFilters(), refundable: true },
      1,
    );
    expect(g[0].offers.map((o) => o.price.fareId)).toEqual(["flex"]);
  });
  it("unknown values do not satisfy explicit constraints", () => {
    const p = price({ cash: null, seats: null });
    expect(
      matchesOffer(offer(row(), p), { ...defaultFilters(), maxFees: "100" }, 1),
    ).toBe(false);
    expect(
      matchesOffer(offer(row(), p), { ...defaultFilters(), minSeats: "1" }, 1),
    ).toBe(false);
  });
  it("converts fees before filtering, preserving missing-rate uncertainty", () => {
    const now = Date.parse("2026-09-05T12:00:00Z"),
      rates = {
        USD: { rate: 1, date: "2026-09-05" },
        MXN: { rate: 20, date: "2026-09-05" },
      };
    const p = price({ cash: 1800, currency: "MXN" }),
      f = { ...defaultFilters(), maxFees: "100" };
    expect(matchesOffer(offer(row(), p), f, 1, {}, now, rates)).toBe(true);
    expect(matchesOffer(offer(row(), p), f, 1, {}, now, {})).toBe(false);
  });
  it("supports time windows spanning midnight", () => {
    const r = row();
    r.segments[0].departure = "2026-10-05T01:30:00";
    const f = {
      ...defaultFilters(),
      departAfter: "22:00",
      departBefore: "04:00",
    };
    expect(matchesOffer(offer(r), f, 1)).toBe(true);
    r.segments[0].departure = "2026-10-05T12:30:00";
    expect(matchesOffer(offer(r), f, 1)).toBe(false);
  });
  it("computes overnight layovers from full dates and handles airport changes honestly", () => {
    const r = row();
    r.segments = [
      { ...r.segments[0], destination: "BOS", arrival: "2026-10-05T23:00:00" },
      { ...r.segments[0], origin: "BOS", departure: "2026-10-06T01:00:00" },
    ];
    expect(layovers(r)).toEqual([120]);
    expect(
      matchesOffer(offer(r), { ...defaultFilters(), maxLayover: "90" }, 1),
    ).toBe(false);
    r.segments[1].origin = "JFK";
    expect(layovers(r)).toEqual([null]);
  });
  it("wallet affordability uses the actual party quote", () => {
    const p = price({ partyPoints: 25001, quotedPassengers: 2 });
    expect(
      matchesOffer(
        offer(row(), p),
        { ...defaultFilters(), walletOnly: true },
        2,
        { AA_AADVANTAGE: 25000 },
      ),
    ).toBe(false);
  });
  it("checks every operating airline and selected connection airport", () => {
    const r = row();
    r.segments = [
      { ...r.segments[0], destination: "BOS" },
      { ...r.segments[0], origin: "BOS", airline: "B6", flightNumber: "B6171" },
    ];
    expect(
      matchesOffer(offer(r), { ...defaultFilters(), airlines: ["AA"] }, 1),
    ).toBe(false);
    expect(
      matchesOffer(offer(r), { ...defaultFilters(), via: "BOS, DFW" }, 1),
    ).toBe(true);
    expect(
      matchesOffer(offer(r), { ...defaultFilters(), avoid: "BOS" }, 1),
    ).toBe(false);
  });
  it("sorts both directions with unknown cabin prices last", () => {
    const groups = groupFlights([
      row({ id: "a" }),
      row({
        id: "b",
        segments: [{ ...row().segments[0], flightNumber: "AA2" }],
        prices: { J: price({ cabin: "J", points: 20000 }) },
      }),
      row({
        id: "c",
        segments: [{ ...row().segments[0], flightNumber: "AA3" }],
        prices: { Y: price({ points: 30000 }) },
      }),
    ]);
    expect(
      sortGroups(groups, "points", "USD", false, "Y").map((g) => g.row.id),
    ).toEqual(["a", "c", "b"]);
    expect(
      sortGroups(groups, "points", "USD", true, "Y").map((g) => g.row.id),
    ).toEqual(["c", "a", "b"]);
  });
});
