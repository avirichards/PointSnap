import { z } from "zod";
import type { SearchQuery } from "@/lib/types";
import { parseAmerican } from "./american";
import { ProviderError } from "./types";

function configuration() {
  const endpoint = process.env.POINTSNAP_BROWSER_WORKER_URL,
    token = process.env.POINTSNAP_BROWSER_WORKER_TOKEN;
  if (!endpoint || !token || token.length < 32) return null;
  try {
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
    )
      return null;
    return { url, token };
  } catch {
    return null;
  }
}

/** Explicit opt-in for the experimental native browser transport. */
export function browserPrograms(): string[] {
  return process.env.POINTSNAP_BROWSER_AMERICAN === "1" && configuration()
    ? ["AA_AADVANTAGE"]
    : [];
}
const envelope = z.object({
  programId: z.literal("AA_AADVANTAGE"),
  query: z.object({
    origin: z.string(),
    dest: z.string(),
    departDate: z.string(),
    pax: z.number(),
  }),
  complete: z.literal(true),
  observedAt: z.iso.datetime(),
  itineraryCount: z.number().int().nonnegative(),
  fareCount: z.number().int().nonnegative(),
  payload: z.unknown(),
});

export async function browserSearch(q: SearchQuery, signal: AbortSignal) {
  const config = configuration();
  if (!config || !browserPrograms().includes("AA_AADVANTAGE"))
    throw new ProviderError("American's browser connection is not enabled.");
  signal.throwIfAborted();
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(new URL("/v1/search/american", config.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        origin: q.origin,
        dest: q.dest,
        departDate: q.departDate,
        pax: q.pax,
        minCabin: q.minCabin,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(100000)]),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    signal.throwIfAborted();
    throw new ProviderError(
      "American's browser service could not be reached or timed out.",
    );
  }
  if (!response.ok) {
    const issue = await response.json().catch(() => null);
    const message =
      typeof issue?.message === "string" && issue.message.length <= 250
        ? issue.message
        : "American's browser search could not complete.";
    throw new ProviderError(message, response.status);
  }
  const decoded = envelope.safeParse(await response.json());
  if (!decoded.success)
    throw new ProviderError(
      "American's browser service returned an incomplete response.",
    );
  const data = decoded.data;
  if (
    data.query.origin !== q.origin ||
    data.query.dest !== q.dest ||
    data.query.departDate !== q.departDate ||
    data.query.pax !== q.pax
  )
    throw new ProviderError(
      "American's browser response belongs to a different search.",
    );
  const observed = Date.parse(data.observedAt);
  if (observed < started - 30000 || observed > Date.now() + 30000)
    throw new ProviderError(
      "American's browser response is not a fresh observation.",
    );
  const rows = parseAmerican(data.payload, q, data.observedAt);
  if (
    rows.length !== data.itineraryCount ||
    rows.reduce((n, row) => n + (row.fares?.length ?? 0), 0) !== data.fareCount
  )
    throw new ProviderError(
      "American's browser response has incomplete flight or fare counts.",
    );
  return rows;
}
