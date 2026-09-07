import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractFrontierFlightData,
  frontierBookingUrl,
  frontierSearch,
  parseFrontier,
} from "../frontier";
import single from "../fixtures/frontier-single.json";
import party from "../fixtures/frontier-party.json";
import { pointsForParty } from "../value";
const q = { ...single.query, minCabin: "Y" as const };
const html = (data: unknown) =>
  `<script>FlightData = '${JSON.stringify(data).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")}';</script><p>${single.evidence.scope}</p>`;
const copy = () => structuredClone(single.flightData);
describe("Frontier anonymous award flight list", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("preserves all 25 itineraries, connections, dates, exact points and cash", () => {
    const rows = parseFrontier(single.flightData, q, single.observedAt);
    expect(rows).toHaveLength(25);
    expect(rows.reduce((n, r) => n + r.segments.length, 0)).toBe(45);
    const direct = rows[0];
    expect(direct.segments[0]).toMatchObject({
      flightNumber: "F92349",
      origin: "DEN",
      destination: "LAS",
      departure: "2026-10-05T07:30:00",
      arrival: "2026-10-05T08:28:00",
      cabin: "Y",
    });
    expect(direct.duration).toBe(118);
    expect(rows.filter((r) => r.prices.Y?.seats === 1)).toHaveLength(3);
    expect(direct.prices.Y).toMatchObject({
      points: 7500,
      cash: 5.6,
      currency: "USD",
      quotedPassengers: 1,
      seats: null,
    });
    expect(direct.prices.Y?.partyPoints).toBeUndefined();
    expect(rows.at(-1)?.segments.at(-1)?.arrival).toBe("2026-10-06T07:33:00");
    expect(
      rows.every(
        (r) => r.freshness === "live" && r.observedAt === single.observedAt,
      ),
    ).toBe(true);
  });
  it("retains seven explicit fare/payment alternatives and unconfirmed Business seating", () => {
    const [row] = parseFrontier(single.flightData, q);
    const sourceBindings = Object.values(single.evidence.sourceBindings).join(
      "\n",
    );
    expect(sourceBindings).toContain("baseMilesFare + calculatedMilesFare");
    for (const field of [
      "milesBundleFareEcob",
      "milesBundleFarePrem",
      "milesBundleFareBusi",
    ])
      expect(sourceBindings).toContain(
        `self.getFormattedMilesFare(Math.ceil(standardFare), segment.${field}`,
      );
    expect(row.fares).toHaveLength(7);
    expect(row.fares?.map((p) => [p.fareId, p.points, p.cash])).toEqual([
      ["basic", 7500, 5.6],
      ["economy-cash", 7500, 40.6],
      ["economy-miles", 9500, 5.6],
      ["premium-cash", 7500, 70.6],
      ["premium-miles", 11500, 5.6],
      ["business-cash", 7500, 130.6],
      ["business-miles", 15500, 5.6],
    ]);
    expect(
      row.fares
        ?.filter((p) => p.fareId?.startsWith("business"))
        .every(
          (p) =>
            p.cabinUnconfirmed && p.segmentCabins?.every((c) => c === null),
        ),
    ).toBe(true);
    expect(row.prices.Y?.fareId).toBe("basic");
    expect(Object.keys(row.prices)).toEqual(["Y"]);
  });
  it("does not divide per-person quotes by two or reuse single-passenger bundle prices", () => {
    const [row] = parseFrontier(party.flightData, { ...q, pax: 2 });
    expect(row.prices.Y).toMatchObject({
      points: 7500,
      quotedPassengers: 2,
      cash: 5.6,
    });
    expect(pointsForParty(row.prices.Y!, 2)).toBe(15000);
    expect(row.fares?.find((p) => p.fareId === "business-cash")?.cash).toBe(
      140.6,
    );
  });
  it("rejects stale queries, cash responses, wrong pax, international currency and broken itinerary data", () => {
    expect(() =>
      parseFrontier(single.flightData, { ...q, departDate: "2026-10-06" }),
    ).toThrow("different route");
    expect(() => parseFrontier(single.flightData, { ...q, pax: 2 })).toThrow(
      "passenger count",
    );
    const cash = copy();
    cash.includeMonetary = true;
    expect(() => parseFrontier(cash, q)).toThrow("award inventory");
    const international = copy();
    international.journeys[0].isInternational = true;
    expect(() => parseFrontier(international, q)).toThrow("currency");
    const broken = copy();
    broken.journeys[0].flights[5].legs.pop();
    expect(() => parseFrontier(broken, q)).toThrow("complete connecting");
    const missing = copy();
    missing.journeys[0].flights[0].economyFare = NaN;
    expect(() => parseFrontier(missing, q)).toThrow("award price");
    const duplicated = copy();
    duplicated.journeys[0].flights.push(duplicated.journeys[0].flights[0]);
    expect(() => parseFrontier(duplicated, q)).toThrow("duplicate itinerary");
  });
  it("omits fares with explicit insufficient seats but rejects unverified numeric-zero semantics", () => {
    const data = structuredClone(party.flightData);
    const flight = data.journeys[0].flights[0] as Record<string, unknown>;
    flight.milesFareFareSeatsRemaining = "1 Seat Left!";
    expect(parseFrontier(data, { ...q, pax: 2 })).toHaveLength(24);
    flight.milesFareFareSeatsRemaining = "0 Seats Left!";
    expect(parseFrontier(data, { ...q, pax: 2 })).toHaveLength(24);
    flight.milesFareFareSeatsRemaining = 0;
    expect(() => parseFrontier(data, { ...q, pax: 2 })).toThrow(
      "unrecognized award seat count",
    );
  });
  it("extracts encoded JSON without running JS and rejects denial pages", () => {
    expect(extractFrontierFlightData(html(single.flightData))).toEqual(
      single.flightData,
    );
    expect(() =>
      extractFrontierFlightData("<html>Access Denied</html>"),
    ).toThrow("complete award flight list");
    expect(() =>
      extractFrontierFlightData("<script>FlightData = 'alert(1)';</script>"),
    ).toThrow("unreadable");
  });
  it("creates a fresh parameterized one-way handoff without session or fare tokens", () => {
    const url = new URL(frontierBookingUrl({ ...q, pax: 2 }));
    expect(url.origin).toBe("https://booking.flyfrontier.com");
    expect(url.searchParams.get("dd1")).toBe("Oct 05 2026");
    expect(url.searchParams.get("ADT")).toBe("2");
    expect(url.searchParams.get("loy")).toBe("true");
    expect(url.searchParams.get("ftype")).toBe("Miles");
    expect(() => frontierBookingUrl({ ...q, origin: "DEN&mon=true" })).toThrow(
      "valid route",
    );
    expect(() =>
      frontierBookingUrl({ ...q, departDate: "2026-02-30" }),
    ).toThrow("valid route");
  });
  it("uses isolated anonymous cookies and follows only the official select redirect", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("home", {
          headers: {
            "set-cookie": "public=home; Domain=.flyfrontier.com; Path=/",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "/Flight/Select",
            "set-cookie": "anon=search; Path=/Flight",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(html(single.flightData)));
    vi.stubGlobal("fetch", fetch);
    expect(await frontierSearch(q, new AbortController().signal)).toHaveLength(
      25,
    );
    expect(fetch.mock.calls[0][1].headers.Cookie).toBeUndefined();
    expect(fetch.mock.calls[1][1].headers.Cookie).toBe("public=home");
    expect(fetch.mock.calls[2][1].headers.Cookie).toBe(
      "public=home; anon=search",
    );
    expect(fetch.mock.calls[1][1].redirect).toBe("manual");
  });
  it("stops on denial or unexpected redirects without sending cookies offsite", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("home"))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example/Flight/Select" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      frontierSearch(q, new AbortController().signal),
    ).rejects.toThrow("anonymous award search");
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch
      .mockReset()
      .mockResolvedValueOnce(new Response("home"))
      .mockResolvedValueOnce(new Response("denied", { status: 403 }));
    await expect(
      frontierSearch(q, new AbortController().signal),
    ).rejects.toThrow("HTTP 403");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
