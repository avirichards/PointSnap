import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  direct: vi.fn(),
  seats: vi.fn(),
  batch: vi.fn(),
  browser: vi.fn(),
  browserIds: vi.fn(),
}));
vi.mock("../direct", () => ({
  directSearch: mock.direct,
  DIRECT_PROGRAMS: ["AS_MILEAGEPLAN", "B6_TRUEBLUE", "VS_FLYING_CLUB"],
}));
vi.mock("../seats", () => ({
  seatsSearch: mock.seats,
  SEATS_SOURCES: { AS_MILEAGEPLAN: "alaska", UA_MP: "united" },
}));
vi.mock("../awardtool", () => ({
  awardToolSearch: mock.batch,
  awardToolPrograms: () => ["UA_MP"],
}));
vi.mock("../browser", () => ({
  browserSearch: mock.browser,
  browserPrograms: mock.browserIds,
}));
import { providerCoverage, runSearch } from "../engine";
import { ProviderError, type AwardEvent } from "../types";
const q = {
  origin: "SEA",
  dest: "SFO",
  departDate: "2026-10-05",
  pax: 1,
  minCabin: "Y" as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SEATS_AERO_API_KEY", "");
  vi.stubEnv("AWARDTOOL_API_KEY", "");
  mock.direct.mockResolvedValue([]);
  mock.browserIds.mockReturnValue([]);
});
afterEach(() => vi.unstubAllEnvs());
async function run(ids: string[]) {
  const events: AwardEvent[] = [];
  await runSearch(ids, {
    query: q,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
  });
  return events;
}
describe("multi-program orchestration", () => {
  it("routes an enabled Delta search to its own browser adapter", async () => {
    mock.browserIds.mockReturnValue(["DL_SKYMILES"]);
    mock.browser.mockResolvedValue([]);
    const events = await run(["DL_SKYMILES"]);
    expect(mock.browser).toHaveBeenCalledWith(
      q,
      expect.any(AbortSignal),
      "DL_SKYMILES",
    );
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: {
        programId: "DL_SKYMILES",
        state: "empty",
        source: "Delta · airline browser",
      },
    });
    expect(mock.direct).not.toHaveBeenCalled();
  });
  it("distinguishes a failed source from an empty result and an unconnected source", async () => {
    mock.direct.mockRejectedValueOnce(new ProviderError("Temporarily blocked"));
    const events = await run(["AS_MILEAGEPLAN", "B6_TRUEBLUE", "UA_MP"]);
    expect(events).toContainEqual({
      type: "coverage",
      coverage: {
        programId: "AS_MILEAGEPLAN",
        state: "error",
        message: "Temporarily blocked",
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "coverage",
        coverage: expect.objectContaining({
          programId: "B6_TRUEBLUE",
          state: "empty",
          source: "Direct airline",
          inventory: "flights",
        }),
      }),
    );
    expect(
      events.filter(
        (e) => e.type === "coverage" && e.coverage.state === "unavailable",
      ),
    ).toHaveLength(1);
    expect(events.some((e) => e.type === "results")).toBe(false);
  });
  it("uses a configured commercial fallback after a direct source fails", async () => {
    vi.stubEnv("SEATS_AERO_API_KEY", "test");
    mock.direct.mockRejectedValue(new Error());
    mock.seats.mockResolvedValue([]);
    const events = await run(["AS_MILEAGEPLAN"]);
    expect(mock.seats).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: { state: "empty", source: "Seats.aero" },
    });
  });
  it("never starts work on a cancelled request", async () => {
    const c = new AbortController();
    c.abort();
    await runSearch(["AS_MILEAGEPLAN"], {
      query: q,
      signal: c.signal,
      emit: () => {},
    });
    expect(mock.direct).not.toHaveBeenCalled();
  });
  it("runs only an explicitly enabled American browser transport", async () => {
    expect(providerCoverage()).not.toContain("AA_AADVANTAGE");
    mock.browserIds.mockReturnValue(["AA_AADVANTAGE"]);
    mock.browser.mockResolvedValue([]);
    expect(providerCoverage()).toContain("AA_AADVANTAGE");
    const events = await run(["AA_AADVANTAGE"]);
    expect(mock.browser).toHaveBeenCalledWith(
      q,
      expect.any(AbortSignal),
      "AA_AADVANTAGE",
    );
    expect(mock.direct).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: {
        programId: "AA_AADVANTAGE",
        state: "empty",
        source: "American · browser pilot",
      },
    });
  });
  it("preserves browser verification as a source error", async () => {
    mock.browserIds.mockReturnValue(["AA_AADVANTAGE"]);
    mock.browser.mockRejectedValue(
      new ProviderError("American requested browser verification.", 503),
    );
    const events = await run(["AA_AADVANTAGE"]);
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: {
        state: "error",
        message: "American requested browser verification.",
      },
    });
    expect(events.some((e) => e.type === "results")).toBe(false);
  });
});
