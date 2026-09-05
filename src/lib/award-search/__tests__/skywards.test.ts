import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSkywards, skywardsSearch } from "../skywards";
import { pointsForParty } from "../value";
import { skywardsPartnerUrl } from "@/lib/bookingHandoff";
import fixture from "../fixtures/skywards.json";
const q = { ...fixture.single.query, minCabin: "Y" as const };
describe("Skywards easyJet and Jet2 partner awards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it("reads all six easyJet schedules and actual server-rendered miles", () => {
    const rows = parseSkywards(fixture.single.html, q, fixture.single.metadata);
    expect(rows).toHaveLength(6);
    const early = rows.find((r) => r.segments[0].flightNumber === "U28672")!;
    expect(early.prices.Y).toMatchObject({
      points: 5759,
      partyPoints: 5759,
      cash: 0,
      currency: null,
      feesIncludedInPoints: true,
    });
    expect(early.segments[0]).toMatchObject({
      departure: "2026-10-05T06:00:00",
      arrival: "2026-10-05T08:20:00",
      cabin: "Y",
    });
    expect(early.duration).toBe(80);
    expect(early.bookingUrl).not.toContain("results/");
  });
  it("preserves exact two-adult totals instead of multiplying a rounded single fare", () => {
    const rows = parseSkywards(
      fixture.party.html,
      { ...q, pax: 2 },
      fixture.party.metadata,
    );
    const price = rows.find((r) => r.segments[0].flightNumber === "U28672")!
      .prices.Y!;
    expect(price.points).toBe(5758.5);
    expect(pointsForParty(price, 2)).toBe(11517);
    const url = new URL(skywardsPartnerUrl({ ...q, pax: 2 }));
    expect(url.searchParams.getAll("passengerAge[]")).toEqual(["18", "18"]);
    expect(url.searchParams.get("numPassengers")).toBe("2");
  });
  it("fails if a requested flight was omitted or the date/cabin format changed", () => {
    expect(() =>
      parseSkywards(fixture.single.html, q, {
        ...fixture.single.metadata,
        ffff: fixture.single.metadata["0001"],
      }),
    ).toThrow("every requested");
    expect(() =>
      parseSkywards(
        fixture.single.html,
        { ...q, departDate: "2026-10-06" },
        fixture.single.metadata,
      ),
    ).toThrow("different route or date");
    expect(() =>
      parseSkywards(
        fixture.single.html.replaceAll("Economy", "Unknown"),
        q,
        fixture.single.metadata,
      ),
    ).toThrow("cabin");
  });
  it("accumulates terminal poll results and never treats raw cash costs as award fees", async () => {
    vi.useFakeTimers();
    const entries = Object.entries(fixture.jet2.metadata);
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "/results/aaaa",
            "set-cookie": "session=ephemeral; Secure; HttpOnly",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<div class="bf_flow bf_results"></div>'),
      )
      .mockResolvedValueOnce(Response.json({ status: 1 }))
      .mockResolvedValueOnce(
        Response.json({
          status: 1,
          results: Object.fromEntries(entries.slice(0, 2)),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: 10,
          success: false,
          results: Object.fromEntries(entries.slice(2)),
        }),
      )
      .mockResolvedValueOnce(new Response(fixture.jet2.html));
    vi.stubGlobal("fetch", mock);
    const promise = skywardsSearch(
      { ...fixture.jet2.query, minCabin: "Y" },
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    const rows = await promise;
    expect(rows).toHaveLength(entries.length);
    expect(rows.filter((r) => r.segments[0].airline === "LS")).toHaveLength(2);
    expect(
      rows.find((r) => r.segments[0].flightNumber === "LS881")?.prices.Y
        ?.points,
    ).toBe(7200);
    expect(new Headers(mock.mock.calls[1][1].headers).get("Cookie")).toBe(
      "session=ephemeral",
    );
  });
  it("accepts a confirmed empty result without trying to render an expired page", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/results/aaaa" },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<div class="bf_flow bf_results"></div>'),
      )
      .mockResolvedValueOnce(
        Response.json({ status: 2, success: false, results: [] }),
      );
    vi.stubGlobal("fetch", mock);
    expect(await skywardsSearch(q, new AbortController().signal)).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it("rejects cross-origin result redirects without sending cookies", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://other.test/results/aaaa",
            "set-cookie": "session=ephemeral",
          },
        }),
      );
    vi.stubGlobal("fetch", mock);
    await expect(
      skywardsSearch(q, new AbortController().signal),
    ).rejects.toThrow("unexpected search location");
    expect(mock).toHaveBeenCalledOnce();
  });
});
