import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  limit: vi.fn(),
  paid: vi.fn(),
  run: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ currentUser: mocks.user }));
vi.mock("@/lib/award-search/limit", () => ({ allowSearch: mocks.limit }));
vi.mock("@/lib/award-search/engine", () => ({
  hasPaidProvider: mocks.paid,
  runSearch: mocks.run,
}));
import { GET } from "../route";
const request = (params = {}, signal?: AbortSignal) =>
  new NextRequest(
    "http://localhost/api/search?" +
      new URLSearchParams({
        origin: "SEA",
        dest: "SFO",
        departDate: new Date(Date.now() + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
        pax: "1",
        minCabin: "Y",
        ...params,
      }),
    { signal },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(null);
  mocks.limit.mockResolvedValue(true);
  mocks.paid.mockReturnValue(false);
  mocks.run.mockImplementation(async (ids, ctx) => {
    ctx.emit({ type: "meta", programs: ids });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("search endpoint", () => {
  it.each(["UA_MP", "G3_GOL_SMILES", "CM_CONNECTMILES", "QF_FF"])(
    "delivers a completed %s inventory after the short-source deadline",
    async (program) => {
      vi.useFakeTimers();
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      });
      mocks.run.mockImplementation(async (ids, ctx) => {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            ctx.emit({
              type: "coverage",
              coverage: { programId: ids[0], state: "success" },
            });
            resolve();
          }, 126000);
          ctx.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      });
      const res = await GET(request({ programs: program }));
      const body = res.text();
      await vi.advanceTimersByTimeAsync(126001);
      const text = await body;
      expect(text).toContain('"state":"success"');
      expect(text).toContain('"type":"complete"');
    },
  );
  it("rejects malformed inputs before any provider work", async () => {
    expect((await GET(request({ pax: "10" }))).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("requires verified identity before spending commercial quota", async () => {
    mocks.paid.mockReturnValue(true);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("blocks rate-limited requests and unavailable quota protection", async () => {
    mocks.limit.mockResolvedValue(false);
    expect((await GET(request())).status).toBe(429);
    mocks.limit.mockRejectedValue(new Error());
    expect((await GET(request())).status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("streams explicit completion with private cache headers", async () => {
    const res = await GET(request({ programs: "AS_MILEAGEPLAN" }));
    expect(res.headers.get("cache-control")).toContain("no-store");
    const text = await res.text();
    expect(text).toContain('"programs":["AS_MILEAGEPLAN"]');
    expect(text).toContain('"type":"complete"');
  });
  it("keeps partial events and sanitizes an unexpected upstream failure", async () => {
    mocks.run.mockImplementation(async (ids, ctx) => {
      ctx.emit({
        type: "coverage",
        coverage: { programId: ids[0], state: "empty" },
      });
      throw new Error("private-provider-token");
    });
    const text = await (await GET(request())).text();
    expect(text).toContain('"state":"empty"');
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain("private-provider-token");
  });
  it("cancels provider work when the response reader disconnects", async () => {
    let signal: AbortSignal | undefined;
    mocks.run.mockImplementation(async (ids, ctx) => {
      signal = ctx.signal;
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
    const res = await GET(request());
    await res.body!.cancel();
    expect(signal?.aborted).toBe(true);
  });
});
