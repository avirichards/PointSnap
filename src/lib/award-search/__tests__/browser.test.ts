import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserPrograms, browserSearch } from "../browser";
import { americanFixture } from "./fixtures/american";
import etihadFixture from "./fixtures/etihad.json";
import sasFixture from "./fixtures/sas-arn.json";
import qantasFixture from "./fixtures/qantas-native-domestic-two.json";
import unitedFixture from "../fixtures/united-lax-aus.json";
import flyingBlueFixture from "../fixtures/flying-blue-native-jfk-ams-two.json";
import virginFixture from "../fixtures/virgin-native-jfk-lhr-two.json";
import qatarFixture from "../fixtures/qatar-native-doh-lhr-two.json";
import { sourceInfo } from "../source-info";
import { parseQantasNative } from "../qantas-native";
import copaFixture from "./fixtures/copa-lax-two.json";
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
  vi.stubEnv("POINTSNAP_BROWSER_COPA", "0");
  vi.stubEnv("POINTSNAP_BROWSER_QANTAS", "0");
  vi.stubEnv("POINTSNAP_BROWSER_UNITED", "0");
  vi.stubEnv("POINTSNAP_BROWSER_VIRGIN", "0");
  vi.stubEnv("POINTSNAP_BROWSER_FLYING_BLUE", "0");
  vi.stubEnv("POINTSNAP_BROWSER_QATAR", "0");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("browser search bridge", () => {
  it("dispatches Qatar with whole-party conversion and explicit unknown fees", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_QATAR", "1");
    expect(browserPrograms()).toEqual(["QR_PRIVILEGE"]);
    const query = {
      origin: "DOH",
      dest: "LHR",
      departDate: "2026-10-05",
      pax: 2,
      minCabin: "Y" as const,
    };
    const body = {
      ...response(),
      programId: "QR_PRIVILEGE",
      query,
      payload: qatarFixture,
      itineraryCount: 7,
      fareCount: 8,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const notice = vi.fn();
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "QR_PRIVILEGE",
      notice,
    );
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/qatar",
    );
    expect(rows).toHaveLength(7);
    expect(
      rows.every((r) =>
        r.fares!.every((f) => f.cash === null && f.currency === null),
      ),
    ).toBe(true);
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining("not supplied"),
    );
    expect(sourceInfo("QR_PRIVILEGE", true)?.inventory).toBe("flights");
    fetch.mockResolvedValue(Response.json({ ...body, fareCount: 7 }));
    await expect(
      browserSearch(query, new AbortController().signal, "QR_PRIVILEGE"),
    ).rejects.toThrow("incomplete flight or fare counts");
  });
  it("dispatches Flying Blue and rejects an incomplete cabin response", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_FLYING_BLUE", "1");
    expect(browserPrograms()).toEqual(["AF_FLYINGBLUE"]);
    const query = {
      origin: "JFK",
      dest: "AMS",
      departDate: "2026-10-08",
      pax: 2,
      minCabin: "Y" as const,
    };
    const body = {
      ...response(),
      programId: "AF_FLYINGBLUE",
      query,
      payload: flyingBlueFixture,
      itineraryCount: 13,
      fareCount: 32,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "AF_FLYINGBLUE",
    );
    expect(rows).toHaveLength(13);
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/flying-blue",
    );
    expect(sourceInfo("AF_FLYINGBLUE", true)?.inventory).toBe("flights");
    fetch.mockResolvedValue(Response.json({ ...body, fareCount: 31 }));
    await expect(
      browserSearch(query, new AbortController().signal, "AF_FLYINGBLUE"),
    ).rejects.toThrow("incomplete flight or fare counts");
  });

  it("dispatches Virgin native flights independently from its calendar and verifies available fare totals", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_VIRGIN", "1");
    expect(browserPrograms()).toEqual(["VS_FLYING_CLUB"]);
    const query = {
      origin: "JFK",
      dest: "LHR",
      departDate: "2026-10-08",
      pax: 2,
      minCabin: "Y" as const,
    };
    const body = {
      ...response(),
      programId: "VS_FLYING_CLUB",
      query,
      payload: virginFixture,
      itineraryCount: 6,
      fareCount: 17,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "VS_FLYING_CLUB",
    );
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/virgin",
    );
    expect(rows).toHaveLength(6);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(17);
    expect(rows[0].prices.Y?.cash).toBe(164.1);
    expect(sourceInfo("VS_FLYING_CLUB", true)?.inventory).toBe("flights");
    expect(sourceInfo("VS_FLYING_CLUB", false)?.inventory).toBe("calendar");
    fetch.mockResolvedValueOnce(Response.json({ ...body, fareCount: 18 }));
    await expect(
      browserSearch(query, new AbortController().signal, "VS_FLYING_CLUB"),
    ).rejects.toThrow("incomplete flight or fare counts");
  });
  it("dispatches native United inventory with visible account eligibility and complete distinct fare counts", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_UNITED", "1");
    expect(browserPrograms()).toEqual(["UA_MP"]);
    const query = { ...unitedFixture.query, minCabin: "Y" as const };
    const body = {
      ...response(),
      programId: "UA_MP",
      query,
      payload: unitedFixture,
      itineraryCount: 38,
      fareCount: 100,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const notice = vi.fn();
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "UA_MP",
      notice,
    );
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/united",
    );
    expect(rows).toHaveLength(38);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(100);
    expect(
      rows.every((r) =>
        r.fares!.every((p) => p.eligibility?.type === "account"),
      ),
    ).toBe(true);
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining("may depend on elite status"),
    );
    fetch.mockResolvedValueOnce(Response.json({ ...body, fareCount: 76 }));
    await expect(
      browserSearch(query, new AbortController().signal, "UA_MP"),
    ).rejects.toThrow("incomplete flight or fare counts");
  });
  it("dispatches Qantas's native quotes and reconciles cabin-filtered fare counts", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_QANTAS", "1");
    expect(browserPrograms()).toEqual(["QF_FF"]);
    const query = {
      origin: "SYD",
      dest: "MEL",
      departDate: "2026-10-05",
      pax: 2,
      minCabin: "Y" as const,
    };
    const body = {
      ...response(),
      programId: "QF_FF",
      query,
      payload: qantasFixture,
      itineraryCount: 37,
      fareCount: 62,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const notice = vi.fn();
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "QF_FF",
      notice,
    );
    expect(rows).toHaveLength(37);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(62);
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/qantas",
    );
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining("exact per-person fees"),
    );
    const business = { ...query, minCabin: "J" as const },
      premium = parseQantasNative(qantasFixture, business);
    fetch.mockResolvedValue(
      Response.json({
        ...body,
        query: business,
        itineraryCount: premium.length,
        fareCount: premium.flatMap((r) => r.fares!).length,
      }),
    );
    expect(
      await browserSearch(business, new AbortController().signal, "QF_FF"),
    ).toHaveLength(premium.length);
    fetch.mockResolvedValue(Response.json({ ...body, fareCount: 61 }));
    await expect(
      browserSearch(query, new AbortController().signal, "QF_FF"),
    ).rejects.toThrow(/incomplete flight or fare counts/);
    vi.stubEnv("POINTSNAP_BROWSER_QANTAS", "0");
    vi.stubEnv("POINTSNAP_BROWSER_UNITED", "0");
    await expect(
      browserSearch(query, new AbortController().signal, "QF_FF"),
    ).rejects.toThrow(/not enabled/);
  });

  it("dispatches native Copa, reconciles exact-airport counts and discloses member pricing", async () => {
    vi.stubEnv("POINTSNAP_BROWSER_AMERICAN", "0");
    vi.stubEnv("POINTSNAP_BROWSER_COPA", "1");
    expect(browserPrograms()).toEqual(["CM_CONNECTMILES"]);
    const query = {
      origin: "LAX",
      dest: "PTY",
      departDate: "2026-10-05",
      pax: 2,
      minCabin: "Y" as const,
    };
    const body = {
      ...response(),
      programId: "CM_CONNECTMILES",
      query,
      payload: copaFixture,
      itineraryCount: 46,
      fareCount: 60,
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const notice = vi.fn();
    const rows = await browserSearch(
      query,
      new AbortController().signal,
      "CM_CONNECTMILES",
      notice,
    );
    expect(rows).toHaveLength(46);
    expect(rows[0].fares?.[0].bookingNotes?.join(" ")).toContain(
      "final cost may differ",
    );
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3002/v1/search/copa",
    );
    expect(notice.mock.calls[0][0]).toContain(
      "3 itineraries for nearby airports",
    );
    fetch.mockResolvedValue(
      Response.json({ ...body, itineraryCount: 49, fareCount: 63 }),
    );
    await expect(
      browserSearch(query, new AbortController().signal, "CM_CONNECTMILES"),
    ).rejects.toThrow(/incomplete flight or fare counts/);
    vi.stubEnv("POINTSNAP_BROWSER_COPA", "0");
    vi.stubEnv("POINTSNAP_BROWSER_QANTAS", "0");
    vi.stubEnv("POINTSNAP_BROWSER_UNITED", "0");
    await expect(
      browserSearch(query, new AbortController().signal, "CM_CONNECTMILES"),
    ).rejects.toThrow(/not enabled/);
  });
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
