import { it, expect } from "vitest";
import { TRANSFER_RULES, transferEstimate } from "../transfer-planner";
import { flightSnapshot, savedFlightSchema } from "../trips";
import type { AwardResult, AwardPrice } from "../award-search/types";
const now = Date.parse("2026-09-06T12:00:00Z");
it("rounds shortfalls to transfer blocks and preserves excess points", () => {
  const rule = TRANSFER_RULES.find(
    (r) => r.bank === "CHASE_UR" && r.program === "UA_MP",
  )!;
  expect(transferEstimate(rule, 55100, 1000, 60000, now)).toMatchObject({
    transfer: 55000,
    received: 55000,
    leftover: 900,
    shortfall: 0,
  });
  expect(transferEstimate(rule, 55000, 55000, 0, now)?.transfer).toBe(0);
  expect(transferEstimate(rule, 55000, 1000, 50000, now)?.shortfall).toBe(4000);
});
it("handles non-one-to-one transfers, fees, limits and invalid or stale inputs", () => {
  const rule = TRANSFER_RULES.find(
    (r) => r.bank === "AMEX_MR" && r.program === "B6_TRUEBLUE",
  )!;
  expect(transferEstimate(rule, 220, 0, 300, now)).toMatchObject({
    transfer: 300,
    received: 240,
    leftover: 20,
    fee: 0.18,
  });
  expect(transferEstimate(rule, 2000000, 0, 3000000, now)?.fee).toBe(99);
  expect(transferEstimate(rule, 220, -1, 300, now)).toBeNull();
  expect(transferEstimate(rule, 220, 0, 300, now + 31 * 86400000)).toBeNull();
  expect(
    TRANSFER_RULES.some(
      (r) =>
        r.bank === "AMEX_MR" &&
        ["AS_MILEAGEPLAN", "AA_AADVANTAGE", "EY_GUEST"].includes(r.program),
    ),
  ).toBe(false);
});
it("saves the selected fare's party quote and retains material restrictions", () => {
  const p: AwardPrice = {
    cabin: "J",
    points: 12000,
    partyPoints: 35000,
    quotedPassengers: 3,
    cash: 5.6,
    currency: "USD",
    seats: 3,
    mixedCabin: true,
    fareId: "f",
    eligibility: {
      type: "account",
      label: "Member price",
      description: "For eligible accounts only",
    },
    bookingNotes: ["Check restrictions"],
  };
  const row: AwardResult = {
    id: "flight",
    programId: "UA_MP",
    origin: "JFK",
    destination: "LHR",
    date: "2026-10-06",
    kind: "flight",
    prices: { J: p },
    source: "Native",
    freshness: "live",
    observedAt: "2026-09-06T12:00:00Z",
    bookingUrl: "https://www.united.com/",
    duration: 400,
    segments: [
      {
        origin: "JFK",
        destination: "LHR",
        departure: null,
        arrival: null,
        airline: "UA",
        flightNumber: "UA1",
      },
    ],
  };
  const saved = flightSnapshot(row, p, 3);
  expect(saved.partyPoints).toBe(35000);
  expect(saved.price.eligibility?.description).toBe(
    "For eligible accounts only",
  );
  expect(saved.price.notes).toEqual(["Check restrictions"]);
  expect(
    savedFlightSchema.safeParse({ ...saved, bookingUrl: "javascript:alert(1)" })
      .success,
  ).toBe(false);
});
