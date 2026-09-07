import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchQuery } from "@/lib/types";
import { bookingUrl } from "@/lib/bookingHandoff";
import { ethiopianSearch, parseEthiopian } from "../ethiopian";
import { defaultFilters, filterGroups, groupFlights } from "../comparison";
import { stopAirports, stopCount } from "../stops";
import economy from "../fixtures/ethiopian-economy.json";
import party from "../fixtures/ethiopian-party.json";
import business from "../fixtures/ethiopian-business.json";
import connecting from "../fixtures/ethiopian-connecting.json";

const q: SearchQuery = {
  origin: "ADD",
  dest: "NBO",
  departDate: "2026-10-07",
  pax: 1,
  minCabin: "Y",
};
afterEach(() => vi.unstubAllGlobals());

describe("Ethiopian anonymous ShebaMiles inventory", () => {
  it("matches all four native exact-date itineraries, resolving shared segments without calendar duplicates", () => {
    const rows = parseEthiopian(economy, q, "2026-09-05T12:00:00Z");
    expect(rows).toHaveLength(4);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(4);
    expect(rows.map((r) => r.prices.Y!.points)).toEqual([
      11000, 33000, 48000, 48000,
    ]);
    expect(rows[0].segments[0]).toMatchObject({
      flightNumber: "ET318",
      departure: "2026-10-07T10:45:00+03:00",
      arrival: "2026-10-07T13:10:00+03:00",
    });
    expect(rows[2].segments.map((s) => s.flightNumber)).toEqual([
      "ET881",
      "ET21",
      "ET50",
    ]);
    expect(
      rows.every(
        (r) =>
          r.date === q.departDate && r.observedAt === "2026-09-05T12:00:00Z",
      ),
    ).toBe(true);
    expect(rows[0].prices.Y).toMatchObject({
      cash: null,
      currency: null,
      seats: 3,
      mixedCabin: false,
      refundable: null,
    });
    expect(
      rows.every(
        (r) => !r.prices.Y!.feesIncludedInPoints && !r.prices.Y!.cashFare,
      ),
    ).toBe(true);
  });

  it("normalizes actual two-person Economy and Business totals and preserves fewer available itineraries", () => {
    const rows = parseEthiopian(party, { ...q, pax: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0].prices.Y).toMatchObject({
      points: 11000,
      partyPoints: 22000,
      quotedPassengers: 2,
    });
    const premium = parseEthiopian(business, { ...q, pax: 2 });
    expect(premium).toHaveLength(3);
    expect(premium.map((r) => r.prices.J!.points)).toEqual([
      54000, 76500, 76500,
    ]);
    expect(premium[0].prices.J).toMatchObject({
      partyPoints: 108000,
      segmentCabins: ["J", "J"],
      bookingClasses: ["I", "I"],
      seats: 2,
    });
    expect(premium.every((r) => !r.prices.Y)).toBe(true);
  });

  it("keeps international overnight connections and source UTC offsets", () => {
    const rows = parseEthiopian(connecting, {
      ...q,
      origin: "LHR",
      departDate: "2026-10-05",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].duration).toBe(1600);
    expect(rows[0].segments.map((s) => s.flightNumber)).toEqual([
      "ET701",
      "ET308",
    ]);
    expect(rows[0].prices.Y!.points).toBe(35500);
    expect(rows[0].segments.at(-1)!.arrival).toMatch(/^2026-10-07/);
  });

  it("counts stops on the same flight in Nonstop, maximum-stops and avoid-airport filters", () => {
    const rows = parseEthiopian(economy, q),
      last = rows[3];
    expect(stopCount(last)).toBe(3);
    expect(stopAirports(last)).toEqual(["DAR", "BLZ", "LLW"]);
    expect(last.segments[1].technicalStops).toEqual([
      {
        airport: "BLZ",
        arrival: "2026-10-07T08:40:00",
        departure: "2026-10-07T09:10:00",
        duration: 30,
      },
    ]);
    const groups = groupFlights(rows);
    expect(
      filterGroups(groups, { ...defaultFilters(), maxStops: "2" }, 1),
    ).toHaveLength(3);
    expect(
      filterGroups(groups, { ...defaultFilters(), avoid: "BLZ" }, 1),
    ).toHaveLength(2);
    const throughFlight = { ...last, segments: [last.segments[1]] };
    expect(stopCount(throughFlight)).toBe(1);
    expect(
      filterGroups(
        groupFlights([throughFlight]),
        { ...defaultFilters(), maxStops: "0" },
        1,
      ),
    ).toHaveLength(0);
  });

  it("retains each points-plus-cash alternative and divides both components by the requested party", () => {
    const data = structuredClone(party);
    data.unbundledOffers[0][0].total.alternatives.push([
      { amount: 20000, currency: "FFCURRENCY" },
      { amount: 80, currency: "USD" },
    ]);
    const rows = parseEthiopian(data, { ...q, pax: 2 });
    expect(rows[0].fares).toHaveLength(2);
    expect(rows[0].prices.Y).toMatchObject({
      points: 10000,
      partyPoints: 20000,
      cash: 40,
      currency: "USD",
    });
  });

  it("rejects missing references, wrong dates, warnings, cash-only fares and inconsistent durations", () => {
    expect(() =>
      parseEthiopian(economy, { ...q, departDate: "2026-10-08" }),
    ).toThrow(/different/);
    expect(() =>
      parseEthiopian({ ...economy, warnings: [{ code: "PARTIAL" }] }, q),
    ).toThrow(/completeness/);
    const broken = structuredClone(economy);
    const referenced = broken.unbundledOffers[0][2].itineraryPart[0]
      .segments[2] as { "@ref": string };
    referenced["@ref"] = "missing";
    expect(() => parseEthiopian(broken, q)).toThrow(/referenced/);
    const cash = structuredClone(economy);
    cash.unbundledOffers[0][0].total.alternatives[0][0].currency = "USD";
    expect(() => parseEthiopian(cash, q)).toThrow(/omitted award miles/);
    const duration = structuredClone(economy);
    duration.unbundledOffers[0][0].itineraryPart[0].totalDuration += 1;
    expect(() => parseEthiopian(duration, q)).toThrow(/inconsistent/);
    expect(() => parseEthiopian({}, q)).toThrow();
    expect(() => parseEthiopian(economy, { ...q, pax: 0 })).toThrow(/valid/);
  });

  it("queries both native cabins with its own fresh, path-scoped anonymous session", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/dx/ETDX/")) {
          const headers = new Headers();
          headers.append("set-cookie", "session=fresh; Path=/; Secure");
          headers.append("set-cookie", "onlyHome=value; Path=/dx; Secure");
          headers.append("set-cookie", "expired=old; Max-Age=0; Path=/");
          headers.append(
            "set-cookie",
            "foreign=value; Domain=example.com; Path=/",
          );
          return new Response(
            "sabre['cid'] = 'public-correlation'; sabre['appId'] = 'public-app';",
            { headers },
          );
        }
        const body = JSON.parse(String(init?.body));
        const originalResponse =
          body.operationName === "init"
            ? ""
            : body.variables.airSearchInput.cabinClass === "Economy"
              ? party
              : business;
        return Response.json(
          {
            data: { [body.operationName]: { originalResponse } },
            extensions: {},
          },
          { headers: { execution: "fresh-execution" } },
        );
      }),
    );
    const early = vi.fn();
    const rows = await ethiopianSearch(
      { ...q, pax: 2 },
      new AbortController().signal,
      early,
    );
    expect(rows).toHaveLength(4);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(5);
    expect(early).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(4);
    for (const call of calls.slice(1)) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get("Cookie")).toBe("session=fresh");
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.get("User-Agent")).toContain("Mozilla");
      expect(call.init?.redirect).toBe("error");
    }
    const searches = calls
      .slice(2)
      .map((c) => JSON.parse(String(c.init?.body)).variables.airSearchInput);
    expect(searches.map((s) => s.cabinClass)).toEqual(["Economy", "Business"]);
    expect(
      searches.every(
        (s) =>
          s.awardBooking === true &&
          s.passengers.ADT === 2 &&
          s.itineraryParts[0].when.date === q.departDate,
      ),
    ).toBe(true);
    expect(new Headers(calls[2].init?.headers).get("execution")).toBe(
      "fresh-execution",
    );
    expect(bookingUrl("ET_SHEBAMILES", q)).toContain("date=10-07-2026");
    expect(bookingUrl("ET_SHEBAMILES", q)).not.toMatch(
      /execution|token|correlation/,
    );
  });

  it("reports denied access and GraphQL errors instead of no availability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Denied", { status: 403 })),
    );
    await expect(
      ethiopianSearch(q, new AbortController().signal),
    ).rejects.toThrow("HTTP 403");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        String(url).endsWith("/dx/ETDX/")
          ? new Response("sabre['cid']='public-correlation';")
          : Response.json({ errors: [{ message: "Rejected" }] }),
      ),
    );
    await expect(
      ethiopianSearch(q, new AbortController().signal),
    ).rejects.toThrow(/could not complete/);
  });
});
