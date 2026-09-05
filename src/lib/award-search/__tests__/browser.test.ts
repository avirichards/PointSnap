import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserPrograms, browserSearch } from "../browser";
import { americanFixture } from "./fixtures/american";
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
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("browser search bridge", () => {
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
