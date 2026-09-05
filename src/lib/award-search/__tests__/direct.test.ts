import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseAlaska,
  parseJetBlue,
  parseVirgin,
  normalizeLiteral,
  directSearch,
} from "../direct";
import { parseQuery } from "../query";
import { filterResults } from "../engine";
import virgin from "../fixtures/virgin.json";
import alaska from "../fixtures/alaska.json";
import jetblue from "../fixtures/jetblue.json";
const q = {
  origin: "SEA",
  dest: "SFO",
  departDate: "2026-10-05",
  pax: 1,
  minCabin: "Y" as const,
};
const html = `<script>__sveltekit_new.resolve(2, () => [{entry:{label:'no flights'}}])</script><script>__sveltekit_new.resolve(1, () => ${JSON.stringify(alaska)})</script>`;
describe("direct airline results", () => {
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
  it("represents daily prices without an invented schedule", () => {
    const r = parseJetBlue(jetblue, { ...q, origin: "JFK", dest: "LAX" })[0];
    expect(r.kind).toBe("calendar");
    expect(r.segments).toEqual([]);
    expect(r.duration).toBeNull();
    expect(r.prices.Y?.cash).toBe(5.6);
    expect(r.prices.Y?.points).toBe(28800);
  });
  it("honors passenger availability and minimum cabin", () => {
    expect(
      parseJetBlue(jetblue, { ...q, origin: "JFK", dest: "LAX", pax: 9 }),
    ).toEqual([]);
    expect(
      filterResults(
        parseJetBlue(jetblue, { ...q, origin: "JFK", dest: "LAX" }),
        { query: { ...q, origin: "JFK", dest: "LAX", minCabin: "J" } },
      ),
    ).toEqual([]);
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
    const mock = vi
      .fn()
      .mockResolvedValue(
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
