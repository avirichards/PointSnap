import { afterEach, describe, it, expect, vi } from "vitest";
import { parseSeats, seatsSearch } from "../seats";
import { parseAwardTool, awardToolSearch } from "../awardtool";
import type { AwardEvent } from "../types";
const q = {
  origin: "JFK",
  dest: "LHR",
  departDate: "2026-12-25",
  pax: 1,
  minCabin: "Y" as const,
};
const trip = {
  ID: "1",
  Cabin: "business",
  MileageCost: 75000,
  TotalTaxes: 9489,
  TaxesCurrency: "AUD",
  RemainingSeats: 0,
  TotalDuration: 420,
  Source: "qantas",
  AvailabilitySegments: [
    {
      FlightNumber: "QF1",
      OriginAirport: "JFK",
      DestinationAirport: "LHR",
      DepartsAt: "2026-12-25T10:00:00Z",
      ArrivesAt: "2026-12-25T17:00:00Z",
    },
  ],
};
const result = {
  id: "r1",
  date: q.departDate,
  program_code: "VS",
  currency: "GBP",
  last_seen: Date.parse("2026-09-05") / 1000,
  cabin_prices: {
    Business: {
      miles: 75000,
      tax: 510.55,
      seats: 2,
      premium_cabin_percentage: 60,
    },
  },
  fare: {
    products: [
      {
        origin: "JFK",
        destination: "LHR",
        departure_time: "2026-12-25T10:00:00Z",
        arrival_time: "2026-12-25T17:00:00Z",
        airline_code: "VS",
        flight_number: "VS1",
      },
    ],
    travel_minutes_total: 420,
  },
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("commercial provider normalization", () => {
  it("preserves currency, minor units, and unknown seat counts", () => {
    const r = parseSeats({ success: true, results: [trip] }, "QF_FF", q)[0];
    expect(r.prices.J).toMatchObject({
      cash: 94.89,
      currency: "AUD",
      seats: null,
      points: 75000,
    });
  });
  it("combines cabins for the same flight while retaining lowest points", () => {
    const rows = parseSeats(
      {
        success: true,
        results: [
          trip,
          { ...trip, ID: "2", Cabin: "economy", MileageCost: 25000 },
          { ...trip, ID: "3", MileageCost: 85000 },
        ],
      },
      "QF_FF",
      q,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prices.J?.points).toBe(75000);
    expect(rows[0].prices.Y?.points).toBe(25000);
  });
  it("never invents missing fees", () => {
    const r = parseSeats(
      { success: true, results: [{ ...trip, Source: "qatar" }] },
      "QR_PRIVILEGE",
      q,
    )[0];
    expect(r.prices.J?.cash).toBeNull();
  });
  it("rejects upstream failure even with HTTP 200", () =>
    expect(() =>
      parseSeats({ success: false, results: [] }, "QF_FF", q),
    ).toThrow());
  it("filters wrong dates and sources", () => {
    expect(parseSeats({ success: true, results: [trip] }, "UA_MP", q)).toEqual(
      [],
    );
    expect(
      parseSeats({ success: true, results: [trip] }, "QF_FF", {
        ...q,
        departDate: "2026-12-24",
      }),
    ).toEqual([]);
  });
  it("requests true live data with seat count and no hidden cache fallback", async () => {
    vi.stubEnv("SEATS_AERO_API_KEY", "test-key");
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ success: true, results: [] }));
    vi.stubGlobal("fetch", fetch);
    await seatsSearch("UA_MP", { ...q, pax: 3 }, new AbortController().signal);
    const options = fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toMatchObject({
      seat_count: 3,
      smart_cache: false,
      show_dynamic_pricing: true,
      source: "united",
    });
    expect(options.headers["Partner-Authorization"]).toBe("test-key");
  });
  it("retains mixed cabin and stale observation evidence", () => {
    const r = parseAwardTool(result, q, "2026-09-06T00:00:00Z")[0];
    expect(r.freshness).toBe("cached");
    expect(r.prices.J).toMatchObject({
      cash: 510.55,
      currency: "GBP",
      mixedCabin: true,
    });
  });
  it("deduplicates repeated polling results and ends completed programs", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AWARDTOOL_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ status: 200, task_id: "task1" }))
        .mockResolvedValueOnce(
          Response.json({
            status: 200,
            result: [result],
            finish: false,
            program_done: [],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            status: 200,
            result: [result],
            finish: true,
            program_done: ["program|VS|JFK|LHR|1:0|20261225"],
          }),
        ),
    );
    const events: AwardEvent[] = [];
    const run = awardToolSearch(["VS_FLYING_CLUB"], {
      query: q,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });
    await vi.runAllTimersAsync();
    await run;
    expect(events.filter((e) => e.type === "results")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: { state: "success" },
    });
  });
});
