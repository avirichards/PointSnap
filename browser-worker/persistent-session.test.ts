import { EventEmitter } from "node:events";
import type { BrowserContext } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { PersistentBrowserSession } from "./persistent-session";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fakeContext() {
  const events = new EventEmitter();
  const close = vi.fn(async () => {
    events.emit("close");
  });
  const context = {
    once: events.once.bind(events),
    close,
  } as unknown as BrowserContext;
  return { context, close, disconnect: () => events.emit("close") };
}
const signal = () => new AbortController().signal;

describe("persistent airline session", () => {
  it("reuses one context across searches and closes it only at shutdown", async () => {
    const fake = fakeContext(),
      launch = vi.fn(async () => fake.context);
    const session = new PersistentBrowserSession(launch);
    expect(await session.run(signal(), async (context) => context)).toBe(
      fake.context,
    );
    expect(await session.run(signal(), async (context) => context)).toBe(
      fake.context,
    );
    expect(launch).toHaveBeenCalledOnce();
    expect(fake.close).not.toHaveBeenCalled();
    await session.close();
    await session.close();
    expect(fake.close).toHaveBeenCalledOnce();
    await expect(session.run(signal(), async () => 1)).rejects.toThrow(
      "closed",
    );
  });

  it("cancels a waiting search promptly without closing or overtaking the active search", async () => {
    const fake = fakeContext(),
      release = deferred(),
      started = deferred();
    const session = new PersistentBrowserSession(async () => fake.context);
    const events: string[] = [];
    const first = session.run(signal(), async () => {
      events.push("first-start");
      started.resolve();
      await release.promise;
      events.push("first-end");
    });
    await started.promise;
    const cancelled = new AbortController();
    const secondWork = vi.fn(async () => {
      events.push("cancelled-work");
    });
    const second = session.run(cancelled.signal, secondWork);
    const rejected = expect(second).rejects.toThrow("visitor left");
    const third = session.run(signal(), async () => {
      events.push("third");
    });
    cancelled.abort(new Error("visitor left"));
    await rejected;
    expect(events).toEqual(["first-start"]);
    expect(fake.close).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([first, third]);
    expect(events).toEqual(["first-start", "first-end", "third"]);
    expect(secondWork).not.toHaveBeenCalled();
    await session.close();
  });

  it("retains the profile after a search fails and releases the next search", async () => {
    const fake = fakeContext(),
      launch = vi.fn(async () => fake.context);
    const session = new PersistentBrowserSession(launch);
    await expect(
      session.run(signal(), async () => {
        throw new Error("source failed");
      }),
    ).rejects.toThrow("source failed");
    expect(await session.run(signal(), async () => "next request")).toBe(
      "next request",
    );
    expect(launch).toHaveBeenCalledOnce();
    expect(fake.close).not.toHaveBeenCalled();
    await session.close();
  });

  it("opens a replacement only on a new request after a browser disconnect", async () => {
    const first = fakeContext(),
      second = fakeContext();
    const launch = vi
      .fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(second.context);
    const session = new PersistentBrowserSession(launch);
    await session.run(signal(), async () => undefined);
    first.disconnect();
    expect(launch).toHaveBeenCalledOnce();
    expect(await session.run(signal(), async (context) => context)).toBe(
      second.context,
    );
    expect(launch).toHaveBeenCalledTimes(2);
    await session.close();
  });

  it("does not cache a failed launch forever", async () => {
    const fake = fakeContext();
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error("launch failed"))
      .mockResolvedValue(fake.context);
    const session = new PersistentBrowserSession(launch);
    await expect(session.run(signal(), async () => 1)).rejects.toThrow(
      "launch failed",
    );
    expect(await session.run(signal(), async () => 2)).toBe(2);
    await session.close();
  });

  it("closes an in-flight launch without letting queued searches start during shutdown", async () => {
    const fake = fakeContext(),
      launchResult = deferred<BrowserContext>(),
      starting = deferred();
    const session = new PersistentBrowserSession(async () => {
      starting.resolve();
      return launchResult.promise;
    });
    const visit = vi.fn(async () => 1);
    const first = expect(session.run(signal(), visit)).rejects.toThrow(
      "closed",
    );
    await starting.promise;
    const second = expect(session.run(signal(), visit)).rejects.toThrow(
      "closed",
    );
    const closing = session.close();
    launchResult.resolve(fake.context);
    await Promise.all([first, second, closing]);
    expect(visit).not.toHaveBeenCalled();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("never opens a browser for an already cancelled request", async () => {
    const launch = vi.fn(),
      controller = new AbortController();
    const session = new PersistentBrowserSession(launch);
    controller.abort(new Error("cancelled"));
    await expect(session.run(controller.signal, async () => 1)).rejects.toThrow(
      "cancelled",
    );
    expect(launch).not.toHaveBeenCalled();
    await session.close();
  });

  it("disposes an externally owned browser process once at shutdown", async () => {
    const fake = fakeContext();
    const dispose = vi.fn(async () => {
      fake.disconnect();
    });
    const session = new PersistentBrowserSession(
      async () => fake.context,
      dispose,
    );
    await session.run(signal(), async () => undefined);
    await Promise.all([session.close(), session.close()]);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(fake.context);
    expect(fake.close).not.toHaveBeenCalled();
  });

  it("reaps a disconnected owned process even when no new search follows", async () => {
    const fake = fakeContext(),
      dispose = vi.fn(async () => {});
    const session = new PersistentBrowserSession(
      async () => fake.context,
      dispose,
    );
    await session.run(signal(), async () => undefined);
    fake.disconnect();
    await session.close();
    expect(dispose).toHaveBeenCalledExactlyOnceWith(fake.context);
  });

  it("releases the disconnected profile before launching a replacement", async () => {
    const first = fakeContext(),
      second = fakeContext(),
      released = deferred();
    const launch = vi
      .fn()
      .mockResolvedValueOnce(first.context)
      .mockResolvedValueOnce(second.context);
    const dispose = vi.fn(async (context: BrowserContext) => {
      if (context === first.context) await released.promise;
    });
    const session = new PersistentBrowserSession(launch, dispose);
    await session.run(signal(), async () => undefined);
    first.disconnect();
    const replacement = session.run(signal(), async (context) => context);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledWith(first.context));
    expect(launch).toHaveBeenCalledOnce();
    released.resolve();
    expect(await replacement).toBe(second.context);
    await session.close();
    expect(dispose.mock.calls.map(([context]) => context)).toEqual([
      first.context,
      second.context,
    ]);
  });
});
