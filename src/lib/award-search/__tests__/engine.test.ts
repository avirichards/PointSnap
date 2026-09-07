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
  DIRECT_PROGRAMS: ["AS_MILEAGEPLAN", "B6_TRUEBLUE", "VS_FLYING_CLUB", "QF_FF"],
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
  it("keeps native Qantas distinct from its cached finder and never falls back silently", async () => {
    mock.browserIds.mockReturnValue(["QF_FF"]);
    mock.browser.mockResolvedValue([]);
    const events = await run(["QF_FF"]);
    expect(mock.direct).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: {
        source: "Qantas Frequent Flyer · airline browser",
        message: expect.stringContaining("Anonymous native Qantas"),
      },
    });
    mock.browser.mockRejectedValue(
      new ProviderError("Native inventory unavailable"),
    );
    expect((await run(["QF_FF"])).at(-1)).toMatchObject({
      type: "coverage",
      coverage: { state: "error", message: "Native inventory unavailable" },
    });
    expect(mock.direct).not.toHaveBeenCalled();
    mock.browserIds.mockReturnValue([]);
    expect((await run(["QF_FF"])).at(-1)).toMatchObject({
      type: "coverage",
      coverage: { message: expect.stringContaining("Cached Classic Reward") },
    });
    expect(mock.direct).toHaveBeenCalledOnce();
  });

  it("lets a fast Southwest result arrive while other browser sources are still pending", async () => {
    const ids = [
      "AA_AADVANTAGE",
      "DL_SKYMILES",
      "G3_GOL_SMILES",
      "EY_GUEST",
      "WN_RAPID_REWARDS",
    ];
    mock.browserIds.mockReturnValue(ids);
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.browser.mockImplementation(async (_q, _signal, id) => {
      if (id !== "WN_RAPID_REWARDS") await slow;
      return [];
    });
    const events: AwardEvent[] = [];
    const pending = runSearch(ids, {
      query: q,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });
    try {
      await vi.waitFor(() =>
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "coverage",
            coverage: expect.objectContaining({
              programId: "WN_RAPID_REWARDS",
            }),
          }),
        ),
      );
      expect(events.filter((e) => e.type === "coverage")).toHaveLength(1);
    } finally {
      release();
      await pending;
    }
    expect(events.filter((e) => e.type === "coverage")).toHaveLength(5);
  });
  it("keeps Smiles withdrawal notices in source coverage even when no quoted offer remains", async () => {
    mock.browserIds.mockReturnValue(["G3_GOL_SMILES"]);
    mock.browser.mockImplementation(async (_q, _signal, _id, notice) => {
      notice("Smiles withdrew 1 listed offer after its live seat recheck.");
      return [];
    });
    const events = await run(["G3_GOL_SMILES"]);
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: {
        programId: "G3_GOL_SMILES",
        state: "empty",
        message: expect.stringContaining("withdrew 1 listed offer"),
      },
    });
  });
  it("routes an enabled Delta search to its own browser adapter", async () => {
    mock.browserIds.mockReturnValue(["DL_SKYMILES"]);
    mock.browser.mockResolvedValue([]);
    const events = await run(["DL_SKYMILES"]);
    expect(mock.browser).toHaveBeenCalledWith(
      q,
      expect.any(AbortSignal),
      "DL_SKYMILES",
      expect.any(Function),
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
      expect.any(Function),
    );
    expect(mock.direct).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: {
        programId: "AA_AADVANTAGE",
        state: "empty",
        source: "American AAdvantage · direct airline",
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
  it("identifies Qatar's native source correctly in coverage", async () => {
    mock.browserIds.mockReturnValue(["QR_PRIVILEGE"]);
    mock.browser.mockResolvedValue([]);
    const events = await run(["QR_PRIVILEGE"]);
    expect(events.at(-1)).toMatchObject({
      type: "coverage",
      coverage: {
        programId: "QR_PRIVILEGE",
        state: "empty",
        source: "Qatar Privilege Club · member airline browser",
      },
    });
  });
});
