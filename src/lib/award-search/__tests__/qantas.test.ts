import { afterEach, describe, expect, it, vi } from "vitest";
import { parseQantas, qantasSearch } from "../qantas";
import { filterResults } from "../engine";
import { defaultFilters, filterGroups, groupFlights } from "../comparison";
import { stopSummary } from "../stops";
import emirates from "../fixtures/qantas-emirates.json";
import party from "../fixtures/qantas-party.json";
import page1 from "../fixtures/qantas-page1.json";
import page2 from "../fixtures/qantas-page2.json";
import through from "../fixtures/qantas-through.json";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("impit", () => ({
  Impit: class {
    fetch = request;
  },
}));
afterEach(() => vi.resetAllMocks());
const q = {
  origin: "SYD",
  dest: "DXB",
  departDate: "2026-10-05",
  pax: 1,
  minCabin: "Y" as const,
};

describe("Qantas public cached Classic Rewards", () => {
  it("keeps all cabins, original currency and source observation instead of claiming live prices", () => {
    const rows = parseQantas(emirates, q, "2026-09-05T20:00:00Z");
    expect(rows).toHaveLength(3);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(5);
    expect(rows[0].prices.Y).toMatchObject({
      points: 53100,
      cash: 339,
      currency: "AUD",
      seats: 6,
      seatCountLabel: "5+ seats reported",
      refundable: null,
    });
    expect(rows[0].prices.F!.bookingNotes?.[0]).toContain("Silver");
    expect(rows[0].observedAt).toBe("2026-09-05T18:25:03.239Z");
    expect(
      rows.every(
        (r) =>
          r.freshness === "cached" && r.retrievedAt === "2026-09-05T20:00:00Z",
      ),
    ).toBe(true);
    expect(rows[0].segments[0].arrival).toBe("2026-10-06T04:30:00");
    expect(JSON.stringify(rows)).not.toContain("verificationToken");
    expect(rows.every((r) => !r.fares!.some((p) => p.cashFare))).toBe(true);
  });

  it("uses the actual two-passenger quote without dividing per-person points or inventing an extra First seat", () => {
    const rows = parseQantas(party, { ...q, pax: 2 });
    expect(rows).toHaveLength(3);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(4);
    expect(rows[0].prices.Y).toMatchObject({
      points: 53100,
      partyPoints: 106200,
      cash: 339,
      quotedPassengers: 2,
    });
    expect(rows.every((r) => !r.prices.F)).toBe(true);
    expect(new URL(rows[0].bookingUrl).searchParams.get("p")).toBe("2");
  });

  it("fetches both real result pages and preserves all 16 itineraries and 21 fare choices", async () => {
    request
      .mockResolvedValueOnce(Response.json(page1))
      .mockResolvedValueOnce(Response.json(page2));
    const query = { ...q, origin: "JFK", dest: "LHR" };
    const early = vi.fn();
    const rows = await qantasSearch(query, new AbortController().signal, early);
    expect(rows).toHaveLength(16);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(21);
    expect(rows.some((r) => r.segments[0].flightNumber === "AA4734")).toBe(
      true,
    );
    expect(early.mock.calls.map(([r]) => r.length)).toEqual([10, 16]);
    expect(
      request.mock.calls.map(([url]) => new URL(url).searchParams.get("pg")),
    ).toEqual(["1", "2"]);
    const mixed = rows.find((r) => r.segments[0].flightNumber === "AA94")!;
    expect(mixed.prices.Y).toMatchObject({
      mixedCabin: true,
      segmentCabins: ["Y", "J"],
      bookingClasses: ["T", "U"],
      currency: "USD",
    });
    expect(
      filterResults(rows, { query: { ...query, minCabin: "W" } }).every(
        (r) => !r.prices.Y,
      ),
    ).toBe(true);
  });

  it("does not mistake QF1's omitted intermediate stop for confirmed nonstop service", () => {
    const rows = parseQantas(through, { ...q, dest: "LHR" });
    const qf1 = rows.find(
      (r) => r.segments.length === 1 && r.segments[0].flightNumber === "QF1",
    )!;
    expect(qf1.duration).toBe(1490);
    expect(stopSummary(qf1)).toBe("Direct · check stops");
    expect(
      filterGroups(groupFlights([qf1]), { ...defaultFilters(), maxStops: "0" }, 1),
    ).toHaveLength(0);
    expect(filterGroups(groupFlights([qf1]), defaultFilters(), 1)).toHaveLength(1);
  });

  it("distinguishes unsupported routes and changed contracts from no available awards", () => {
    expect(() =>
      parseQantas(
        {
          flights: [],
          pagination: { page: 1, pageSize: 10, maxKnownPage: 1 },
          routeDecision: { blocked: true, code: "DOMESTIC_AU_ONLY" },
        },
        q,
      ),
    ).toThrow("domestic");
    expect(() => parseQantas({ flights: [] }, q)).toThrow("incomplete");
    expect(() => parseQantas(emirates, { ...q, dest: "LHR" })).toThrow(
      "different route",
    );
    const bad = structuredClone(emirates);
    bad.flights[0].cabins.Economy!.currency = "$";
    expect(() => parseQantas(bad, q)).toThrow("unidentified currency");
    expect(() =>
      parseQantas(
        {
          ...emirates,
          flights: [{ ...emirates.flights[0], lastSeenAt: "unknown" }],
        },
        q,
      ),
    ).toThrow("observation time");
  });

  it("fails partial pagination honestly while already emitted flights remain usable", async () => {
    request
      .mockResolvedValueOnce(Response.json(page1))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    const early = vi.fn();
    await expect(
      qantasSearch(
        { ...q, origin: "JFK", dest: "LHR" },
        new AbortController().signal,
        early,
      ),
    ).rejects.toThrow("503");
    expect(early.mock.calls[0][0]).toHaveLength(10);
    request
      .mockReset()
      .mockResolvedValueOnce(Response.json(page1))
      .mockResolvedValueOnce(
        Response.json({
          ...page1,
          pagination: { ...page1.pagination, page: 2 },
        }),
      );
    await expect(
      qantasSearch(
        { ...q, origin: "JFK", dest: "LHR" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("repeated");
  });

  it("honors cancellation before starting a network request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(qantasSearch(q, controller.signal)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
