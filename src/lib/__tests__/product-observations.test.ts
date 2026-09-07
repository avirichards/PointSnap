import { expect, it } from "vitest";
import { observedFlightGroups } from "../search-observations";
import { availableWalletBalance } from "../wallet";
import { flexibilityInsight } from "../award-search/flexibility";
import { groupFlights } from "../award-search/comparison";
import type { AwardResult, AwardPrice } from "../award-search/types";
const fare = (points: number, extra: Partial<AwardPrice> = {}): AwardPrice => ({
  cabin: "J",
  points,
  cash: 50,
  currency: "USD",
  seats: null,
  mixedCabin: false,
  ...extra,
});
const row = (
  id: string,
  points: number,
  extra: Partial<AwardResult> = {},
): AwardResult => ({
  id,
  programId: "BA_AVIOS",
  origin: "JFK",
  destination: "LHR",
  date: "2026-10-06",
  kind: "flight",
  duration: 430,
  segments: [
    {
      origin: "JFK",
      destination: "LHR",
      airline: "BA",
      flightNumber: "BA178",
      departure: "2026-10-06T18:30:00",
      arrival: "2026-10-07T06:40:00",
    },
  ],
  prices: { J: fare(points) },
  source: "test",
  freshness: "live",
  observedAt: "2026-09-06T12:00:00Z",
  bookingUrl: "https://www.britishairways.com/",
  ...extra,
});
it("replaces older program observations, preserves every current fare, and separates party quotes", () => {
  const current = row("new-id", 65000, {
    fares: [fare(65000), fare(80000, { fareName: "Flexible" })],
  });
  const history = [
    {
      params: "pax=2",
      checkedAt: "2026-09-06T13:00:00Z",
      rows: [row("two", 66000)],
    },
    { params: "pax=1", checkedAt: "2026-09-06T12:00:01Z", rows: [current] },
    {
      params: "pax=1&minCabin=J",
      checkedAt: "2026-09-05T12:00:01Z",
      rows: [row("old-id", 45000, { observedAt: "2026-09-05T12:00:00Z" })],
    },
  ];
  const groups = observedFlightGroups(history);
  expect(groups).toHaveLength(2);
  expect(
    groups.flatMap((g) => g.offers.map((o) => o.price.points)).sort(),
  ).toEqual([65000, 66000, 80000]);
  expect(groups.map((g) => g.offers[0].price.quotedPassengers).sort()).toEqual([
    1, 2,
  ]);
  expect(new Set(groups.map((g) => g.id)).size).toBe(2);
});
it("uses native party counts when supplied instead of the search fallback", () => {
  const groups = observedFlightGroups([
    {
      params: "pax=1",
      checkedAt: "2026-09-06T12:00:00Z",
      rows: [
        row("party", 22000, {
          prices: {
            J: fare(22000, { quotedPassengers: 3, partyPoints: 65000 }),
          },
        }),
      ],
    },
  ]);
  expect(groups[0].offers[0].price).toMatchObject({
    quotedPassengers: 3,
    partyPoints: 65000,
  });
});
it("does not use expired wallet entries for booking or transfer eligibility", () => {
  const wallet = {
    entries: [
      {
        asset_id: "CHASE_UR",
        kind: "currency" as const,
        balance: 80000,
        expires_on: "2026-09-05",
      },
    ],
    cards: [],
  };
  expect(availableWalletBalance(wallet, "CHASE_UR", "2026-09-06")).toBe(0);
  expect(availableWalletBalance(wallet, "CHASE_UR", "2026-09-05")).toBe(80000);
  expect(
    availableWalletBalance(wallet, "BA_AVIOS", "2026-09-06"),
  ).toBeUndefined();
});
it("only describes flexible-date savings in comparable program, cabin and eligibility scopes", () => {
  const base = row("base", 70000);
  const next = (id: string, points: number, extra: Partial<AwardResult> = {}) =>
    row(id, points, { date: "2026-10-07", segments: [], ...extra });
  const incompatible = [
    next("other-program", 10000, { programId: "UA_MP" }),
    next("mixed", 12000, { prices: { J: fare(12000, { mixedCabin: true }) } }),
    next("conditional", 15000, {
      prices: {
        J: fare(15000, {
          eligibility: {
            type: "account",
            label: "Cardholder",
            description: "Card required",
          },
        }),
      },
    }),
  ];
  expect(
    flexibilityInsight(
      groupFlights([base, ...incompatible]),
      base.date,
      1,
      false,
    ),
  ).toBeNull();
  const result = flexibilityInsight(
    groupFlights([base, ...incompatible, next("compatible", 55000)]),
    base.date,
    1,
    false,
  );
  expect(result?.saved).toBe(15000);
  expect(result?.alternative.row.id).toBe("compatible");
  expect(
    flexibilityInsight(
      groupFlights([base, next("compatible", 55000)]),
      base.date,
      2,
      true,
    )?.saved,
  ).toBe(30000);
});
