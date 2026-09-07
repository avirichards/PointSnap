/** Respect Retry-After; the API's current quota window is ten minutes. */
export function searchRetryAt(header: string | null, now = Date.now()) {
  const seconds = header?.trim() ? Number(header) : NaN;
  const delay =
    Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : header
        ? Date.parse(header) - now
        : NaN;
  return now + (Number.isFinite(delay) ? Math.max(1000, delay) : 600_000);
}

/** Both queue workers share the deadline, including extensions from in-flight requests. */
export async function waitForSearchCooldown(
  retryAt: () => number,
  signal: AbortSignal,
) {
  while (true) {
    signal.throwIfAborted();
    const delay = retryAt() - Date.now();
    if (delay <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, delay);
      function abort() {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}
