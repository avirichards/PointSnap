import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createBrowserWorker } from "./server";
import { americanPayload, type AmericanBrowserResult } from "./american";
import type { SearchQuery } from "../src/lib/types";
const token = "worker-test-token-".repeat(3);
const q = {
  origin: "LAX",
  dest: "AUS",
  departDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  pax: 1,
  minCabin: "Y",
};
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function start(
  search = vi.fn<
    (q: SearchQuery, signal: AbortSignal) => Promise<AmericanBrowserResult>
  >(),
  options = {},
) {
  const worker = createBrowserWorker(
    { search, close: async () => {} },
    { token, ...options },
  );
  await new Promise<void>((resolve) =>
    worker.server.listen(0, "127.0.0.1", resolve),
  );
  cleanups.push(worker.close);
  return {
    search,
    url: `http://127.0.0.1:${(worker.server.address() as AddressInfo).port}/v1/search/american`,
  };
}

describe("background browser request boundary", () => {
  it("dispatches Delta only when its runner is explicitly configured", async () => {
    const first = await start();
    expect(
      (
        await fetch(first.url.replace("american", "delta"), {
          method: "POST",
          headers,
          body: JSON.stringify(q),
        })
      ).status,
    ).toBe(404);
    const delta = vi
      .fn()
      .mockResolvedValue({
        programId: "DL_SKYMILES",
        query: q,
        complete: true,
        observedAt: new Date().toISOString(),
        payload: {},
        itineraryCount: 0,
        fareCount: 0,
        stages: [],
      });
    const second = await start(undefined, {
      deltaRunner: { search: delta, close: async () => {} },
    });
    const result = await fetch(second.url.replace("american", "delta"), {
      method: "POST",
      headers,
      body: JSON.stringify(q),
    });
    expect(result.status).toBe(200);
    expect((await result.json()).programId).toBe("DL_SKYMILES");
    expect(delta).toHaveBeenCalledOnce();
    expect(second.search).not.toHaveBeenCalled();
  });
  it("does not launch browsers for unauthenticated or invalid searches", async () => {
    const { url, search } = await start();
    expect(
      (await fetch(url, { method: "POST", body: JSON.stringify(q) })).status,
    ).toBe(401);
    for (const body of [
      { ...q, origin: "https://example.com" },
      { ...q, pax: 10 },
      { ...q, url: "https://example.com" },
      { ...q, dest: "LAX" },
    ]) {
      expect(
        (
          await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
    }
    expect(search).not.toHaveBeenCalled();
  });
  it("aborts the browser when the client cancels the request", async () => {
    let started!: () => void, cancelled!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    const stopped = new Promise<void>((r) => {
      cancelled = r;
    });
    const search = vi.fn(
      (_q: SearchQuery, signal: AbortSignal) =>
        new Promise<AmericanBrowserResult>((_resolve, reject) => {
          started();
          signal.addEventListener(
            "abort",
            () => {
              cancelled();
              reject(new Error("cancelled"));
            },
            { once: true },
          );
        }),
    );
    const { url } = await start(search);
    const controller = new AbortController();
    const result = fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(q),
      signal: controller.signal,
    }).catch(() => null);
    await ready;
    controller.abort();
    await stopped;
    await result;
    expect(search.mock.calls[0][1].aborted).toBe(true);
  });
  it("bounds active browser work and cancels queued searches", async () => {
    let started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    const search = vi.fn(
      (_q: SearchQuery, signal: AbortSignal) =>
        new Promise<AmericanBrowserResult>((_resolve, reject) => {
          started();
          signal.addEventListener(
            "abort",
            () => reject(new Error("timed out")),
            { once: true },
          );
        }),
    );
    const { url } = await start(search, { concurrency: 1, timeoutMs: 100 });
    const first = fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(q),
    });
    await ready;
    const cancel = new AbortController();
    const second = fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(q),
      signal: cancel.signal,
    }).catch(() => null);
    cancel.abort();
    expect((await first).status).toBe(504);
    await second;
    expect(search).toHaveBeenCalledOnce();
  });
  it("extracts only itinerary data and preserves pagination indicators", () => {
    const payload = americanPayload({
      account: { secret: "private" },
      SearchData: {
        session: "private",
        itineraryResult: {
          slices: [],
          responseMetadata: {
            sessionId: "private",
            cached: false,
            totalCount: 40,
          },
          hasMore: true,
          utag: { id: "private" },
        },
      },
    });
    expect(payload).toEqual({
      slices: [],
      responseMetadata: { cached: false, totalCount: 40 },
      hasMore: true,
    });
    expect(() => americanPayload({ SearchData: {} })).toThrow("did not supply");
  });
  it("hands a completed slot to the next queued search", async () => {
    const release: (() => void)[] = [];
    const search = vi.fn(
      (query: SearchQuery) =>
        new Promise<AmericanBrowserResult>((resolve) => {
          release.push(() =>
            resolve({
              programId: "AA_AADVANTAGE",
              query,
              complete: true,
              observedAt: new Date().toISOString(),
              payload: {},
              itineraryCount: 0,
              fareCount: 0,
              stages: [],
            }),
          );
        }),
    );
    const { url } = await start(search, { concurrency: 1 });
    const first = fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(q),
    });
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const second = fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(q),
    });
    await vi.waitFor(async () => {
      const health = await fetch(new URL("/health", url), { headers });
      expect(await health.json()).toMatchObject({ active: 1, queued: 1 });
    });
    release[0]();
    expect((await first).status).toBe(200);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    release[1]();
    expect((await second).status).toBe(200);
    const health = await fetch(new URL("/health", url), { headers });
    expect(await health.json()).toMatchObject({ active: 0, queued: 0 });
  });
});
