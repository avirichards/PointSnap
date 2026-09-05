import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseAlaska,
  parseVirgin,
  normalizeLiteral,
  directSearch,
} from "../direct";
import { parseQuery } from "../query";
import { filterResults } from "../engine";
import virgin from "../fixtures/virgin.json";
import alaska from "../fixtures/alaska.json";
import alaskaFull from "../fixtures/alaska-full.json";
const q = {
  origin: "SEA",
  dest: "SFO",
  departDate: "2026-10-05",
  pax: 1,
  minCabin: "Y" as const,
};
const html = `<script>__sveltekit_new.resolve(2, () => [{entry:{label:'no flights'}}])</script><script>__sveltekit_new.resolve(1, () => ${JSON.stringify(alaska)})</script>`;
describe("direct airline results", () => {
  it("preserves every supplied itinerary and award fare, including a lower-cabin first leg", () => {
    const rows = parseAlaska(
      `<script>__sveltekit_app.resolve(1, () => ${JSON.stringify(alaskaFull)})</script>`,
      q,
    );
    expect(rows).toHaveLength(35);
    expect(rows.flatMap((r) => r.fares ?? [])).toHaveLength(68);
    expect(rows.filter((r) => r.segments.length === 2)).toHaveLength(26);
    const mixed = rows.find(
      (r) =>
        r.segments.map((s) => s.flightNumber).join("/") === "AS1390/AA2673",
    )!;
    expect(mixed.prices.F).toMatchObject({
      points: 20000,
      cash: 25.6,
      mixedCabin: true,
      segmentCabins: ["Y", "F"],
      fareId: "REFUNDABLE_FIRST",
    });
    expect(mixed.prices.Y).toMatchObject({
      points: 12500,
      cash: 25.6,
      mixedCabin: false,
    });
    const premium = filterResults([mixed], {
      query: { ...q, minCabin: "F" },
    })[0];
    expect(premium.fares).toHaveLength(1);
    expect(premium.prices.Y).toBeUndefined();
  });
  it("retains multiple fare families in the same cabin", () => {
    const fixture = structuredClone(alaskaFull);
    const sol = fixture[0].rows[0].solutions;
    Object.assign(sol, {
      MAIN_ALTERNATIVE: { ...sol.REFUNDABLE_MAIN, atmosPoints: 22000 },
    });
    const rows = parseAlaska(
      `<script>__sveltekit_app.resolve(1, () => ${JSON.stringify(fixture)})</script>`,
      q,
    );
    expect(rows[0].fares?.filter((p) => p.cabin === "Y")).toHaveLength(2);
    expect(rows[0].prices.Y?.points).toBe(20000);
  });
  it("finds flight data independent of SvelteKit promise ID", () => {
    const rows = parseAlaska(html, q);
    expect(rows).toHaveLength(2);
    expect(rows[0].segments[0].flightNumber).toBe("AS725");
    expect(rows[0].prices.Y?.cash).toBe(5.6);
    expect(rows[0].prices.F?.points).toBe(42500);
  });
  it("does not call a blocked or changed page zero availability", () =>
    expect(() => parseAlaska("<html>Access denied</html>", q)).toThrow());
  it("does not evaluate airline JavaScript", () => {
    expect(() =>
      parseAlaska(
        '<script>__sveltekit_a.resolve(1, () => [{departureStation:"SEA",rows:process.exit()}])</script>',
        q,
      ),
    ).toThrow();
  });
  it("normalizes undefined without modifying quoted data", () =>
    expect(
      normalizeLiteral('{a:void 0,b:"void 0 undefined",c:undefined}'),
    ).toBe('{a:null,b:"void 0 undefined",c:null}'));
  it("does not return a different route or date", () => {
    expect(parseAlaska(html, { ...q, departDate: "2026-10-06" })).toEqual([]);
    expect(() => parseAlaska(html, { ...q, dest: "NRT" })).toThrow();
  });
  it("keeps unknown Virgin taxes unknown, not a made-up exchange rate", () => {
    const r = parseVirgin(
      [
        {
          pointsDays: [
            {
              date: q.departDate,
              minPrice: 500,
              seats: {
                awardBusiness: {
                  cabinPointsValue: 75000,
                  cabinClassSeatCount: 2,
                },
              },
            },
          ],
        },
      ],
      q,
    )[0];
    expect(r.prices.J?.cash).toBeNull();
    expect(r.segments).toEqual([]);
  });
});
describe("search validation", () => {
  const now = new Date("2026-09-05");
  const params = (extra = {}) =>
    new URLSearchParams({
      origin: "sea",
      dest: "SFO",
      departDate: q.departDate,
      pax: "1",
      minCabin: "Y",
      ...extra,
    });
  it("normalizes airport codes", () =>
    expect(parseQuery(params(), now).origin).toBe("SEA"));
  for (const extra of [
    { origin: "SFO" },
    { pax: "NaN" },
    { pax: "1.5" },
    { pax: "10" },
    { departDate: "2026-02-30" },
    { departDate: "2020-01-01" },
    { returnDate: "2026-09-01" },
    { minCabin: "Z" },
  ])
    it(`rejects ${JSON.stringify(extra)}`, () =>
      expect(() => parseQuery(params(extra), now)).toThrow());
});

describe("Virgin live session", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("carries session cookies to the same-origin result without storing them", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: {
            location: "/travelplus/reward-seat-checker-api/result/",
            "set-cookie": "session=transient; Secure; HttpOnly",
          },
        }),
      )
      .mockResolvedValueOnce(Response.json(virgin));
    vi.stubGlobal("fetch", mock);
    const rows = await directSearch(
      "VS_FLYING_CLUB",
      { ...q, origin: "JFK", dest: "LHR" },
      new AbortController().signal,
    );
    expect(rows[0].prices.Y?.points).toBe(39000);
    expect(rows[0].prices.J?.points).toBe(255000);
    expect(mock.mock.calls[1][1].headers.Cookie).toBe("session=transient");
    expect(mock.mock.calls[1][1].redirect).toBe("error");
  });
  it("rejects redirects that would leak session cookies", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 303,
        headers: {
          location: "https://other.test/result",
          "set-cookie": "session=private",
        },
      }),
    );
    vi.stubGlobal("fetch", mock);
    await expect(
      directSearch("VS_FLYING_CLUB", q, new AbortController().signal),
    ).rejects.toThrow("unexpected search location");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("reports an empty HTTP response as a provider failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(
      directSearch("VS_FLYING_CLUB", q, new AbortController().signal),
    ).rejects.toThrow("did not return award data");
  });
});
