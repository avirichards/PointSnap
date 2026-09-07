import { afterEach, describe, expect, it, vi } from "vitest";
import { searchRetryAt, waitForSearchCooldown } from "../search-cooldown";
afterEach(() => vi.useRealTimers());
describe("wide-search quota recovery", () => {
  it("honors seconds and HTTP dates, falling back to the server quota window", () => {
    const now = Date.parse("2026-09-06T12:00:00Z");
    expect(searchRetryAt("60", now)).toBe(now + 60_000);
    expect(searchRetryAt("Sun, 06 Sep 2026 12:02:00 GMT", now)).toBe(
      now + 120_000,
    );
    expect(searchRetryAt(null, now)).toBe(now + 600_000);
    expect(searchRetryAt("invalid", now)).toBe(now + 600_000);
    expect(searchRetryAt("0", now)).toBe(now + 1000);
  });
  it("holds both queue workers until the shared deadline, including extensions", async () => {
    vi.useFakeTimers();
    let until = Date.now() + 10_000;
    const finished = vi.fn();
    const signal = new AbortController().signal;
    const workers = [0, 1].map(() =>
      waitForSearchCooldown(() => until, signal).then(finished),
    );
    await vi.advanceTimersByTimeAsync(9000);
    expect(finished).not.toHaveBeenCalled();
    until += 5000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(workers);
    expect(finished).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels pending waits immediately when a search is stopped or replaced", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForSearchCooldown(
      () => Date.now() + 600_000,
      controller.signal,
    );
    const result = expect(waiting).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
