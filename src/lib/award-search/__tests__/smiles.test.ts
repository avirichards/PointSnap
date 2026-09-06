import { describe, expect, it } from "vitest";
import source from "./fixtures/smiles.json";
import partners from "./fixtures/smiles-partners.json";
import american from "./fixtures/smiles-american.json";
import {
  parseSmiles,
  smilesPayloadSchema,
  smilesObservationCounts,
} from "../smiles";

const query = { ...source.query, minCabin: "Y" as const };
const fixture = () => smilesPayloadSchema.parse(structuredClone(source));

describe("complete anonymous Smiles inventory", () => {
  it("retains every exact-airport US itinerary when Smiles also includes Ontario departures", () => {
    const q = { ...american.query, minCabin: "Y" as const };
    const rows = parseSmiles(american, q);
    expect(smilesObservationCounts(american)).toEqual({
      listed: 40,
      withdrawn: 3,
      otherAirports: 15,
    });
    expect(rows).toHaveLength(22);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(168);
    expect(
      rows.every(
        (r) =>
          r.segments[0].origin === "LAX" &&
          r.segments.at(-1)!.destination === "AUS",
      ),
    ).toBe(true);
    expect(
      rows
        .filter((r) => r.segments.length === 1)
        .map((r) => r.segments[0].flightNumber),
    ).toEqual(["AA2118", "AA4945", "AA6443"]);
    expect(rows[0].fares![0]).toMatchObject({
      points: 26000,
      cash: 91.76,
      currency: "BRL",
      quotedPassengers: 1,
    });
    expect(rows[0].fares).toHaveLength(7);
  });
  it("still rejects inconsistent legs, changed dates and invalid quotes on other-airport offers", () => {
    const q = { ...american.query, minCabin: "Y" as const };
    const cases = Array.from({ length: 3 }, () =>
      smilesPayloadSchema.parse(american),
    );
    cases[0].response.requestedFlightSegmentList[0].flightList[9].legList[0].departure.airport.code =
      "LAX";
    cases[1].response.requestedFlightSegmentList[0].flightList[9].departure.date =
      "2026-10-06T00:00:00";
    cases[2].extensions[9].tax!.totals.totalBoardingTax.money++;
    for (const p of cases) expect(() => parseSmiles(p, q)).toThrow();
  });
  it("retains verified flights when Smiles explicitly withdraws a listed offer on its seat recheck", () => {
    const p = fixture();
    p.extensions[2].tax = undefined;
    p.extensions[2].unavailable = { code: "113", reason: "seats-unavailable" };
    const rows = parseSmiles(p, query);
    expect(rows).toHaveLength(4);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(35);
    const conflicting = fixture();
    conflicting.extensions[0].unavailable = {
      code: "113",
      reason: "seats-unavailable",
    };
    expect(() => parseSmiles(conflicting, query)).toThrow();
    p.extensions[2].unavailable = undefined;
    expect(() => parseSmiles(p, query)).toThrow();
  });
  it("preserves all five flights and all 42 regular cash/miles and baggage choices", () => {
    const rows = parseSmiles(fixture(), query);
    expect(rows).toHaveLength(5);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(42);
    expect(rows[0].duration).toBe(70);
    expect(rows[0].segments[0].flightNumber).toBe("G31382");
    expect(rows[0].fares).toHaveLength(14);
    expect(rows[0].fares!.at(-1)).toMatchObject({
      fareName: "Smiles & Money · Classic",
      points: 18400,
      cash: 185.75,
      currency: "BRL",
    });
    expect(rows[0].fares!.at(-1)?.bookingNotes).toContain(
      "Includes one checked bag up to 23 kg.",
    );
    expect(
      rows.every(
        (r) => r.programId === "G3_GOL_SMILES" && r.freshness === "live",
      ),
    ).toBe(true);
    expect(
      rows
        .flatMap((r) => r.fares!)
        .some((f) => /club|tier/i.test(f.fareName || "")),
    ).toBe(false);
  });
  it("keeps fees per person, party miles exact, and club/cash-only prices out of normal awards", () => {
    const row = parseSmiles(fixture(), query)[0];
    expect(row.fares![0]).toMatchObject({
      fareName: "Smiles award · Light",
      points: 20700,
      partyPoints: 41400,
      quotedPassengers: 2,
      cash: 35.75,
      currency: "BRL",
      seats: 7,
    });
    expect(row.fares![0].refundable).toBe(true);
    expect(row.fares![0].bookingNotes).toContain(
      "Cancellation fee: 450 BRL per traveler.",
    );
    expect(row.prices.Y).toMatchObject({
      points: 3800,
      partyPoints: 7600,
      cash: 355.75,
    });
    expect(
      row.fares!.some(
        (f) => f.points === 19000 || f.points === 3420 || f.points === 0,
      ),
    ).toBe(false);
    // The source cash-only quote is for a different fare family, so no invented cents/point.
    expect(row.fares!.every((f) => !f.cashFare)).toBe(true);
  });
  it("retains all 40 partner itineraries and 280 choices, including airline surcharges", () => {
    const q = { ...partners.query, minCabin: "Y" as const };
    const rows = parseSmiles(partners, q);
    expect(rows).toHaveLength(40);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(280);
    expect(rows[0].segments.map((s) => s.flightNumber)).toEqual([
      "G31558",
      "AF415",
    ]);
    expect(rows[0].duration).toBe(1830);
    expect(rows[0].fares![0]).toMatchObject({
      points: 200000,
      cash: 290.99,
      currency: "BRL",
    });
    expect(rows[0].fares![1]).toMatchObject({ points: 100000, cash: 2080.99 });
    expect(
      new Set(rows.flatMap((r) => r.segments.map((s) => s.airline))),
    ).toEqual(new Set(["G3", "AF", "KL", "UX", "IB"]));
  });
  it("rejects missing pages, fare checks, payment choices and end markers", () => {
    const cases = [fixture(), fixture(), fixture(), fixture(), fixture()];
    cases[0].displayedFlightCount--;
    cases[1].extensions.pop();
    cases[2].extensions[0].upsells.pop();
    cases[3].extensions[0].money.fareList.splice(2, 1);
    cases[4].extensions[4].flightIndex = 0;
    for (const p of cases)
      expect(() => parseSmiles(p, query)).toThrow(
        "Complete availability could not be confirmed",
      );
    expect(() =>
      parseSmiles({ ...fixture(), endOfResults: false }, query),
    ).toThrow();
  });
  it("rejects a different query, traveler count, quote or changed fare", () => {
    for (const change of [
      { origin: "CGH" },
      { dest: "SDU" },
      { departDate: "2026-10-06" },
      { pax: 1 },
    ])
      expect(() =>
        parseSmiles({ ...fixture(), query: { ...query, ...change } }, query),
      ).toThrow("different search");
    const cases = [fixture(), fixture(), fixture(), fixture()];
    cases[0].extensions[0].tax!.totals.passenger = 1;
    cases[1].extensions[0].tax!.flightList[0].legList[0].flightNumber = "9999";
    cases[2].extensions[0].tax!.totals.totalFare.miles++;
    cases[3].extensions[0].tax!.flightList[0].legList[0].arrival.date =
      "2026-10-05T20:15:00";
    for (const p of cases) expect(() => parseSmiles(p, query)).toThrow();
  });
  it("refuses incomplete or inconsistent taxes on the base or alternative fare", () => {
    const cases = [fixture(), fixture(), fixture()];
    cases[0].extensions[0].tax!.totals.totalBoardingTax.money = 0;
    cases[1].extensions[0].upsells[0].fareList[0].g3!.costTax = 55;
    delete cases[2].extensions[0].upsells[0].fareList[0].g3!.costTax;
    for (const p of cases) expect(() => parseSmiles(p, query)).toThrow();
    expect(() =>
      parseSmiles({ ...fixture(), extensions: [{ error: "no quote" }] }, query),
    ).toThrow();
  });
  it("honors cabin and party availability and does not mislabel undocumented technical stops", () => {
    expect(parseSmiles(fixture(), { ...query, minCabin: "J" })).toEqual([]);
    const p = fixture();
    p.extensions[0].tax!.flightList[0].availableSeats = 1;
    expect(parseSmiles(p, query)).toHaveLength(4);
    const stop = fixture();
    stop.response.requestedFlightSegmentList[0].flightList[0].stops = 1;
    expect(parseSmiles(stop, query)[0].stopDetailsUnconfirmed).toBe(true);
    const invalid = fixture();
    invalid.response.requestedFlightSegmentList[0].flightList[0].legList[0].arrival.date =
      "2026-02-30T20:05:00";
    expect(() => parseSmiles(invalid, query)).toThrow();
  });
  it("strips shopping identifiers and unrelated account data from saved observations", () => {
    const p = fixture();
    const raw = {
      ...p,
      account: { memberNumber: "private-test" },
      token: "private-test",
    };
    Object.assign(raw.response.requestedFlightSegmentList[0].flightList[0], {
      uid: "private-test",
    });
    Object.assign(raw.extensions[0].money.fareList[0], {
      uid: "private-test",
      uidupsell: "private-test",
    });
    expect(JSON.stringify(smilesPayloadSchema.parse(raw))).not.toContain(
      "private-test",
    );
  });
});
