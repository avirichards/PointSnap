import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachJetBlueCash,
  jetbluePublicKey,
  jetblueRequest,
  jetblueSearch,
  parseJetBlueFlights,
} from "../jetblue";
import { filterResults } from "../engine";
import { centsPerPoint, pointsForParty } from "../value";
import flights from "../fixtures/jetblue-flights.json";
import cash from "../fixtures/jetblue-cash.json";
import transatlantic from "../fixtures/jetblue-transatlantic.json";

const q = {
  origin: "JFK",
  dest: "LAX",
  departDate: "2026-10-05",
  pax: 2,
  minCabin: "Y" as const,
};
const at = "2026-09-05T05:50:00Z";
const bootstrap =
  '<script id="rwb-config">window.__ENV_CONFIG_RWB={crystalBlueSubscriptionKey:"public-test-application-marker"}</script>';
afterEach(() => vi.unstubAllGlobals());

describe("JetBlue full-flight inventory", () => {
  it("preserves all 16 itineraries, 22 segments and 119 eligible fare options, beyond the first ten cards", () => {
    const rows = parseJetBlueFlights(flights, q, at);
    expect(rows).toHaveLength(16);
    expect(rows.flatMap((row) => row.segments)).toHaveLength(22);
    expect(rows.flatMap((row) => row.fares ?? [])).toHaveLength(119);
    expect(rows.filter((row) => row.segments.length === 2)).toHaveLength(6);
    expect(
      rows.every(
        (row) =>
          row.kind === "flight" &&
          row.freshness === "live" &&
          row.observedAt === at,
      ),
    ).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(16);
    expect(
      rows.every(
        (row) =>
          new Set(row.fares?.map((f) => f.fareId)).size === row.fares?.length,
      ),
    ).toBe(true);
    // The final connecting flight is cheaper than the date-strip minimum.
    expect(rows.at(-1)?.prices.Y).toMatchObject({ points: 22000, cash: 11.2 });
  });
  it("keeps Base, regular and Flex offers distinct and prices per adult", () => {
    const row = parseJetBlueFlights(flights, q)[0];
    expect(row.fares?.map((f) => f.fareName)).toEqual([
      "Main Base",
      "Main",
      "Main Flex",
      "EvenMore Base",
      "EvenMore",
      "EvenMore Flex",
      "Mint",
      "Mint Flex",
    ]);
    expect(row.prices.Y).toMatchObject({
      points: 24200,
      cash: 5.6,
      seats: 9,
      refundable: false,
    });
    expect(pointsForParty(row.prices.Y!, 2)).toBe(48400);
    expect(row.fares?.find((f) => f.fareName === "Main Flex")?.refundable).toBe(
      true,
    );
    expect(
      row.fares
        ?.filter((f) => f.fareName?.startsWith("EvenMore"))
        .every((f) => f.cabin === "Y"),
    ).toBe(true);
  });
  it("uses fare-specific references for mixed Mint connections instead of the itinerary's economy reference cabin", () => {
    const rows = parseJetBlueFlights(flights, q);
    const mixed = rows[10];
    expect(mixed.segments.map((s) => s.flightNumber)).toEqual([
      "B62718",
      "B61487",
    ]);
    expect(mixed.prices.J).toMatchObject({
      cabin: "J",
      mixedCabin: true,
      segmentCabins: ["Y", "J"],
      points: 157200,
    });
    const filtered = filterResults(rows, { query: { ...q, minCabin: "J" } });
    expect(filtered).toHaveLength(16);
    expect(
      filtered.every((row) => row.fares?.every((f) => f.cabin === "J")),
    ).toBe(true);
    expect(filtered[10].prices.J?.mixedCabin).toBe(true);
  });
  it("imports all four transatlantic itineraries and 28 fares, including connections", () => {
    const rows = parseJetBlueFlights(transatlantic, {
      ...q,
      dest: "LHR",
      pax: 1,
    });
    expect(rows).toHaveLength(4);
    expect(rows.flatMap((row) => row.fares ?? [])).toHaveLength(28);
    expect(rows.filter((row) => row.segments.length === 2)).toHaveLength(2);
  });
  it("does not advertise sold-out or insufficient-seat fares", () => {
    const changed = structuredClone(flights);
    changed.data.searchResults[0].productOffers[0].offers[0].soldOut = true;
    changed.data.searchResults[0].productOffers[0].offers[1].seatsRemaining.count = 1;
    const rows = parseJetBlueFlights(changed, q);
    expect(rows.flatMap((row) => row.fares ?? [])).toHaveLength(117);
    expect(rows[0].prices.Y?.points).toBe(33200);
  });
  it("rejects partial status, missing fares, mismatched routes, unresolved references and unexpected pagination", () => {
    const badStatus = structuredClone(flights);
    badStatus.status.transactionStatus = "partial-success";
    expect(() => parseJetBlueFlights(badStatus, q)).toThrow(/partial/);
    expect(() => parseJetBlueFlights(flights, { ...q, dest: "SFO" })).toThrow(
      /route/,
    );
    const missing = structuredClone(flights);
    Object.assign(missing.data.searchResults[0].productOffers[0], {
      offers: undefined,
    });
    expect(() => parseJetBlueFlights(missing, q)).toThrow(/incomplete/);
    const ref = structuredClone(flights);
    ref.data.searchResults[0].productOffers[0].offers[0].offerSegmentInfo[0].ref.flightSegment.$ref =
      "#/other/flight";
    expect(() => parseJetBlueFlights(ref, q)).toThrow(/reference/);
    const paged = structuredClone(flights);
    Object.assign(paged.data.searchResults[0], { hasMore: true });
    expect(() => parseJetBlueFlights(paged, q)).toThrow(/unfinished/);
  });
  it("accepts an explicitly successful empty result without treating a failed request as no seats", () => {
    const empty = structuredClone(flights);
    empty.data.searchResults[0].productOffers = [];
    expect(parseJetBlueFlights(empty, q)).toEqual([]);
    expect(() =>
      parseJetBlueFlights({ status: { transactionStatus: "error" } }, q),
    ).toThrow();
    expect(() => parseJetBlueFlights(cash, q)).toThrow(/payment/);
  });
});

describe("JetBlue cash comparison", () => {
  it("matches every fare by exact itinerary, fare family and segment fare information", () => {
    const rows = attachJetBlueCash(
      parseJetBlueFlights(flights, { ...q, pax: 1 }),
      cash,
      { ...q, pax: 1 },
      at,
    );
    expect(
      rows.flatMap((row) => row.fares ?? []).filter((f) => f.cashFare),
    ).toHaveLength(119);
    expect(rows[0].prices.Y?.cashFare).toMatchObject({
      amount: 326.31,
      currency: "USD",
      fareName: "Main Base",
      observedAt: at,
    });
    expect(centsPerPoint(rows[0].prices.Y)).toBeCloseTo(1.3252479);
    expect(centsPerPoint(rows[10].prices.J)).toBeNull();
    expect(
      new URL(rows[0].prices.Y!.cashFare!.bookingUrl).searchParams.get(
        "usePoints",
      ),
    ).toBe("false");
  });
  it("does not compare different schedules or fare bases", () => {
    const changed = structuredClone(cash);
    changed.data.searchResults[0].productOffers[0].offers[0].offerSegmentInfo[0].fareBasis =
      "DIFFERENT";
    changed.data.searchResults[0].productOffers[1].originAndDestination[0].flightSegments[0].arrival.date =
      "2026-10-05T11:08:00";
    const rows = attachJetBlueCash(parseJetBlueFlights(flights, q), changed, q);
    expect(rows[0].prices.Y?.cashFare).toBeUndefined();
    expect(rows[1].fares?.every((f) => !f.cashFare)).toBe(true);
    expect(rows[2].prices.Y?.cashFare).toBeDefined();
  });
});

describe("JetBlue anonymous request flow", () => {
  it("discovers public configuration without evaluating airline scripts or using a member token", () => {
    expect(jetbluePublicKey(bootstrap)).toBe("public-test-application-marker");
    expect(() => jetbluePublicKey("<title>Client Challenge</title>")).toThrow(
      /configuration/,
    );
    expect(jetblueRequest(q)).toEqual({
      awardBooking: true,
      travelerTypes: [{ type: "ADULT", quantity: 2 }],
      searchComponents: [{ from: "JFK", to: "LAX", date: "2026-10-05" }],
    });
    expect(() => jetblueRequest({ ...q, pax: 0 })).toThrow();
    expect(() => jetblueRequest({ ...q, departDate: "2026-02-30" })).toThrow();
  });
  it("requests unfiltered award and cash inventory and streams awards before optional enrichment", async () => {
    const events: string[] = [];
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      if (!options.body) return new Response(bootstrap);
      const request = JSON.parse(String(options.body));
      events.push(request.awardBooking ? "award request" : "cash request");
      return Response.json(request.awardBooking ? flights : cash, {
        status: 201,
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const rows = await jetblueSearch(
      q,
      new AbortController().signal,
      (partial) => {
        events.push("award rows");
        expect(partial[0].prices.Y?.cashFare).toBeUndefined();
      },
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][0]).toBe("https://www.jetblue.com/booking/");
    for (const [url, options] of fetcher.mock.calls.slice(1)) {
      expect(url).toBe(
        "https://cb-api.jetblue.com/cb-flight-search/v1/search/NGB",
      );
      expect(options.headers).not.toHaveProperty("Authorization");
      expect(options.headers).not.toHaveProperty("Cookie");
      expect(JSON.parse(String(options.body)).travelerTypes).toEqual([
        { type: "ADULT", quantity: 2 },
      ]);
      expect(JSON.parse(String(options.body))).not.toHaveProperty("filter");
    }
    expect(events).toContain("award rows");
    expect(rows[0].prices.Y?.cashFare).toBeDefined();
  });
  it("keeps awards when the independent cash search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) => {
        if (!options.body) return new Response(bootstrap);
        return JSON.parse(String(options.body)).awardBooking
          ? Response.json(flights)
          : new Response("Unavailable", { status: 503 });
      }),
    );
    const rows = await jetblueSearch(q, new AbortController().signal);
    expect(rows).toHaveLength(16);
    expect(rows[0].prices.Y?.cashFare).toBeUndefined();
  });
  it("reports an airline search failure instead of falling back to a misleading daily minimum", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) =>
        options.body
          ? new Response("Denied", { status: 403 })
          : new Response(bootstrap),
      ),
    );
    await expect(
      jetblueSearch(q, new AbortController().signal),
    ).rejects.toThrow(/HTTP 403/);
  });
  it("does not start requests after cancellation", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(jetblueSearch(q, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
