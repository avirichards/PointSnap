import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserPrograms, browserSearch } from "../browser";
import { americanFixture } from "./fixtures/american";
import etihadFixture from "./fixtures/etihad.json";
import sasFixture from "./fixtures/sas-arn.json";
import southwestFixture from "./fixtures/southwest-den.json";
import deltaFixture from "./fixtures/delta.json";
import smilesFixture from "./fixtures/smiles.json";
import smilesAmericanFixture from "./fixtures/smiles-american.json";
import { smilesPayloadSchema } from "../smiles";
const q = {
  origin: "LAX",
  dest: "AUS",
  departDate: "2026-09-07",
  pax: 1,
  minCabin: "Y" as const,
};
const response = () => ({
  programId: "AA_AADVANTAGE",
  query: q,
  complete: true,
  observedAt: new Date().toISOString(),
  payload: americanFixture(),
  itineraryCount: 40,
  fareCount: 69,
});
beforeEach(() => {
  vi.stubEnv("POINTSNAP_BROWSER_WORKER_URL", "http://127.0.0.1:3002");
  vi.stubEnv("POINTSNAP_BROWSER_WORKER_TOKEN", "local-test-token-".repeat(3));
  vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "1");
  vi.stubEnv("POINTSNAP_BROWSER_DELTA", "0");
  vi.stubEnv("POINTSNAP_BROWSER_SMILES", "0");
  vi.stubEnv("POINTSNAP_BROWSER_ETIHAD", "0");
  vi.stubEnv("POINTSNAP_BROWSER_SOUTHWEST", "0");
  vi.stubEnv("POINTSNAP_BROWSER_SAS", "0");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("browser search bridge", () => {
  it("dispatches SAS's native fares and rejects incomplete bridge counts", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_SAS", "1");
    expect(browserPrograms()).toEqual(["SK_EUROBONUS"]);
    const query = {
      origin: "CPH",
      dest: "ARN",
      departDate: "2026-10-05",
      pax: 2,
      minCabin: "Y" as const,
    };
    const body = {
      ...response(),
      programId: "SK_EUROBONUS",
      query,
      payload: sasFixture,
      itineraryCount: 20,
      fareCount: 72,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    expect(
      await browserSearch(query, new AbortController().signal, "SK_EUROBONUS"),
    ).toHaveLength(20);
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/sas",
    );
    fetch.mockResolvedValue(Response.json({ ...body, fareCount: 71 }));
    await expect(
      browserSearch(query, new AbortController().signal, "SK_EUROBONUS"),
    ).rejects.toThrow("incomplete flight or fare counts");
  });
  it("dispatches Southwest's complete award list and retains awards without a cash comparison", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_SOUTHWEST", "1");
    expect(browserPrograms()).toEqual(["WN_RAPID_REWARDS"]);
    const query = {
      origin: "DEN",
      dest: "LAS",
      departDate: "2026-10-05",
      pax: 2,
      minCabin: "Y" as const,
    };
    const body = {
      ...response(),
      programId: "WN_RAPID_REWARDS",
      query,
      payload: southwestFixture,
      itineraryCount: 26,
      fareCount: 104,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const notice = vi.fn();
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "WN_RAPID_REWARDS",
      notice,
    );
    expect(rows).toHaveLength(26);
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/southwest",
    );
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining(
        "Cash comparisons match each flight and fare family",
      ),
    );
    fetch.mockResolvedValue(Response.json({ ...body, fareCount: 103 }));
    await expect(
      browserSearch(query, new AbortController().signal, "WN_RAPID_REWARDS"),
    ).rejects.toThrow("incomplete flight or fare counts");
    fetch.mockResolvedValue(
      Response.json({
        ...body,
        payload: {
          type: southwestFixture.type,
          points: southwestFixture.points,
        },
      }),
    );
    const noCash = await browserSearch(
      query,
      new AbortController().signal,
      "WN_RAPID_REWARDS",
      notice,
    );
    expect(noCash.flatMap((r) => r.fares!)).toHaveLength(104);
    expect(noCash.every((r) => r.fares!.every((f) => !f.cashFare))).toBe(true);
    expect(notice).toHaveBeenLastCalledWith(
      expect.stringContaining("missing comparisons do not remove award fares"),
    );
  });
  it("dispatches Etihad with both cabin responses and checks complete fare counts", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_ETIHAD", "1");
    expect(browserPrograms()).toEqual(["EY_GUEST"]);
    const query = { ...etihadFixture.query, minCabin: "Y" as const };
    const body = {
      ...response(),
      programId: "EY_GUEST",
      query,
      payload: etihadFixture.payload,
      itineraryCount: 6,
      fareCount: 38,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const notice = vi.fn();
    expect(
      await browserSearch(
        query,
        new AbortController().signal,
        "EY_GUEST",
        notice,
      ),
    ).toHaveLength(6);
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/etihad",
    );
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining("sold-out choices are excluded"),
    );
    fetch.mockResolvedValue(Response.json({ ...body, fareCount: 45 }));
    await expect(
      browserSearch(query, new AbortController().signal, "EY_GUEST"),
    ).rejects.toThrow("incomplete flight or fare counts");
  });
  it("discloses both seat withdrawals and other-airport exclusions without losing matching Smiles flights", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_SMILES", "1");
    const query = { ...smilesAmericanFixture.query, minCabin: "Y" as const };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...response(),
          programId: "G3_GOL_SMILES",
          query,
          payload: smilesAmericanFixture,
          itineraryCount: 22,
          fareCount: 168,
        }),
      ),
    );
    const notice = vi.fn();
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "G3_GOL_SMILES",
      notice,
    );
    expect(rows).toHaveLength(22);
    expect(notice).toHaveBeenCalledOnce();
    expect(notice.mock.calls[0][0]).toContain("withdrew 3 listed offers");
    expect(notice.mock.calls[0][0]).toContain("15 offers for other airports");
    expect(notice.mock.calls[0][0]).toContain("Only LAX–AUS flights are shown");
  });
  it("reports withdrawn Smiles offers separately from the verified flight set", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_SMILES", "1");
    const payload = smilesPayloadSchema.parse(smilesFixture),
      query = { ...payload.query, minCabin: "Y" as const };
    payload.extensions[2].tax = undefined;
    payload.extensions[2].unavailable = {
      code: "113",
      reason: "seats-unavailable",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...response(),
          programId: "G3_GOL_SMILES",
          payload,
          query,
          itineraryCount: 4,
          fareCount: 35,
        }),
      ),
    );
    const notice = vi.fn();
    expect(
      await browserSearch(
        query,
        new AbortController().signal,
        "G3_GOL_SMILES",
        notice,
      ),
    ).toHaveLength(4);
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining("withdrew 1 listed offer"),
    );
  });
  it("dispatches Smiles with all validated fare choices and rejects incomplete counts", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_SMILES", "1");
    expect(browserPrograms()).toEqual(["G3_GOL_SMILES"]);
    const query = { ...smilesFixture.query, minCabin: "Y" as const };
    const body = {
      ...response(),
      programId: "G3_GOL_SMILES",
      query,
      payload: smilesFixture,
      itineraryCount: 5,
      fareCount: 42,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "G3_GOL_SMILES",
    );
    expect(rows).toHaveLength(5);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(42);
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/smiles",
    );
    fetch.mockResolvedValue(Response.json({ ...body, fareCount: 37 }));
    await expect(
      browserSearch(query, new AbortController().signal, "G3_GOL_SMILES"),
    ).rejects.toThrow("incomplete flight or fare counts");
  });
  it("dispatches Delta independently, validates its program identity and retains every page", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_DELTA", "1");
    expect(browserPrograms()).toEqual(["DL_SKYMILES"]);
    const query = { ...deltaFixture.query, minCabin: "Y" as const };
    const body = {
      ...response(),
      programId: "DL_SKYMILES",
      query,
      payload: deltaFixture,
      itineraryCount: 46,
      fareCount: 167,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "DL_SKYMILES",
    );
    expect(rows).toHaveLength(46);
    expect(rows.reduce((n, r) => n + r.fares!.length, 0)).toBe(167);
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/delta",
    );
    fetch.mockResolvedValue(
      Response.json({ ...body, programId: "AA_AADVANTAGE" }),
    );
    await expect(
      browserSearch(query, new AbortController().signal, "DL_SKYMILES"),
    ).rejects.toThrow("different search");
  });
  it("requires explicit activation and a secure configured worker", () => {
    expect(browserPrograms()).toEqual(["AA_AADVANTAGE"]);
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    expect(browserPrograms()).toEqual([]);
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "1");
    for (const url of [
      "http://remote.example",
      "https://user:password@example.com",
      "https://example.com/?token=key",
      "https://example.com/wrong-path",
    ]) {
      vi.stubEnv("POINTSNAP_BROWSER_WORKER_URL", url);
      expect(browserPrograms()).toEqual([]);
    }
  });
  it("accepts the complete fresh native payload and preserves every fare", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(response()));
    vi.stubGlobal("fetch", fetch);
    const rows = await browserSearch(q, new AbortController().signal);
    expect(rows).toHaveLength(40);
    expect(rows.reduce((n, row) => n + row.fares!.length, 0)).toBe(69);
    expect(rows[39].segments.at(-1)?.destination).toBe("AUS");
    const request = fetch.mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual(q);
    expect(request.redirect).toBe("error");
  });
  it("rejects stale, mismatched and incomplete worker results", async () => {
    const cases = [
      { ...response(), complete: false },
      { ...response(), query: { ...q, pax: 2 } },
      {
        ...response(),
        observedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      { ...response(), fareCount: 68 },
      { ...response(), payload: { ...americanFixture(), hasMore: true } },
      {
        ...response(),
        payload: {
          ...americanFixture(),
          responseMetadata: {
            ...americanFixture().responseMetadata,
            totalCount: 41,
          },
        },
      },
    ];
    for (const body of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
      await expect(
        browserSearch(q, new AbortController().signal),
      ).rejects.toThrow();
    }
  });
  it("reports browser verification as failure, never as an empty flight list", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { message: "American requested browser verification." },
            { status: 503 },
          ),
        ),
    );
    await expect(
      browserSearch(q, new AbortController().signal),
    ).rejects.toThrow("browser verification");
  });
  it("does not start a browser request after cancellation", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const c = new AbortController();
    c.abort();
    await expect(browserSearch(q, c.signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
