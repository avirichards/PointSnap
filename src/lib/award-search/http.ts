import { ProviderError } from "./types";
export async function providerJson(
  url: string,
  body: unknown,
  signal: AbortSignal,
  headers: Record<string, string> = {},
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    cache: "no-store",
  });
  if (!response.ok)
    throw new ProviderError(
      response.status === 401 || response.status === 403
        ? "The data provider rejected access. Check the API subscription."
        : response.status === 429
          ? "The data provider is busy. Please try again later."
          : `The data provider is unavailable (HTTP ${response.status}).`,
      response.status,
    );
  return response.json() as Promise<unknown>;
}
export function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
