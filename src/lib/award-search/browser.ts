import { z } from "zod";
import type { SearchQuery } from "@/lib/types";
import { parseAmerican } from "./american";
import { parseEtihad } from "./etihad";
import { parseDelta } from "./delta";
import { parseSmiles, smilesObservationCounts } from "./smiles";
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
  if (!configuration()) return [];
  return [
    ...(process.env.POINTSNAP_BROWSER_AMERICAN === "1"
      ? ["AA_AADVANTAGE"]
      : []),
    ...(process.env.POINTSNAP_BROWSER_DELTA === "1" ? ["DL_SKYMILES"] : []),
    ...(process.env.POINTSNAP_BROWSER_SMILES === "1" ? ["G3_GOL_SMILES"] : []),
    ...(process.env.POINTSNAP_BROWSER_ETIHAD === "1" ? ["EY_GUEST"] : []),
  ];
}
const envelope = z.object({
  programId: z.enum([
    "AA_AADVANTAGE",
    "DL_SKYMILES",
    "G3_GOL_SMILES",
    "EY_GUEST",
  ]),
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

export async function browserSearch(
  q: SearchQuery,
  signal: AbortSignal,
  programId = "AA_AADVANTAGE",
  onNotice?: (notice: string) => void,
) {
  const name =
    programId === "EY_GUEST"
      ? "Etihad"
      : programId === "G3_GOL_SMILES"
        ? "Smiles"
        : programId === "DL_SKYMILES"
          ? "Delta"
          : "American";
  const config = configuration();
  if (!config || !browserPrograms().includes(programId))
    throw new ProviderError(`${name}'s browser connection is not enabled.`);
  signal.throwIfAborted();
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(
      new URL(
        `/v1/search/${programId === "EY_GUEST" ? "etihad" : programId === "G3_GOL_SMILES" ? "smiles" : programId === "DL_SKYMILES" ? "delta" : "american"}`,
        config.url,
      ),
      {
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
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(programId === "G3_GOL_SMILES" ? 185000 : 100000),
        ]),
        cache: "no-store",
        redirect: "error",
      },
    );
  } catch {
    signal.throwIfAborted();
    throw new ProviderError(
      `${name}'s browser service could not be reached or timed out.`,
    );
  }
  if (!response.ok) {
    const issue = await response.json().catch(() => null);
    const message =
      typeof issue?.message === "string" && issue.message.length <= 250
        ? issue.message
        : `${name}'s browser search could not complete.`;
    throw new ProviderError(message, response.status);
  }
  const decoded = envelope.safeParse(await response.json());
  if (!decoded.success)
    throw new ProviderError(
      `${name}'s browser service returned an incomplete response.`,
    );
  const data = decoded.data;
  if (
    data.programId !== programId ||
    data.query.origin !== q.origin ||
    data.query.dest !== q.dest ||
    data.query.departDate !== q.departDate ||
    data.query.pax !== q.pax
  )
    throw new ProviderError(
      `${name}'s browser response belongs to a different search.`,
    );
  const observed = Date.parse(data.observedAt);
  if (observed < started - 30000 || observed > Date.now() + 30000)
    throw new ProviderError(
      `${name}'s browser response is not a fresh observation.`,
    );
  const rows = (
    programId === "EY_GUEST"
      ? parseEtihad
      : programId === "G3_GOL_SMILES"
        ? parseSmiles
        : programId === "DL_SKYMILES"
          ? parseDelta
          : parseAmerican
  )(data.payload, q, data.observedAt);
  if (
    rows.length !== data.itineraryCount ||
    rows.reduce((n, row) => n + (row.fares?.length ?? 0), 0) !== data.fareCount
  )
    throw new ProviderError(
      `${name}'s browser response has incomplete flight or fare counts.`,
    );
  if (
    programId === "AA_AADVANTAGE" &&
    data.payload &&
    typeof data.payload === "object" &&
    "type" in data.payload &&
    data.payload.type === "american-cabin-searches"
  )
    onNotice?.(
      "Combined American's all-cabin and Business/First searches. The later premium quote replaces an earlier price for the same cabin and flight.",
    );
  if (programId === "EY_GUEST")
    onNotice?.(
      "Combined Etihad’s Economy/Business and Business/First searches. Includes available GuestSeat and pay-with-miles fares; sold-out choices are excluded. Exact cash taxes may differ from the airline’s rounded display.",
    );
  if (programId === "G3_GOL_SMILES") {
    const { withdrawn, otherAirports } = smilesObservationCounts(data.payload);
    const notices: string[] = [];
    if (withdrawn)
      notices.push(
        `Smiles withdrew ${withdrawn} listed ${withdrawn === 1 ? "offer" : "offers"} after its live seat recheck. Only offers with confirmed prices and taxes are shown.`,
      );
    if (otherAirports)
      notices.push(
        `Smiles also returned ${otherAirports} ${otherAirports === 1 ? "offer" : "offers"} for other airports. Only ${q.origin}–${q.dest} flights are shown.`,
      );
    if (notices.length) onNotice?.(notices.join(" "));
  }
  return rows;
}
