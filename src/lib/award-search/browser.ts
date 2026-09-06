import { z } from "zod";
import type { SearchQuery } from "@/lib/types";
import { parseUnited, unitedPayloadSchema } from "./united";
import { parseFlyingBlueNative } from "./flying-blue-native";
import { parseVirginNative } from "./virgin-native";
import { parseAmerican } from "./american";
import { parseEtihad } from "./etihad";
import { parseSas } from "./sas";
import { parseCopa, copaObservationCounts, copaPayloadSchema } from "./copa";
import { parseQantasNative, qantasNativeCounts } from "./qantas-native";
import { parseSouthwest } from "./southwest";
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
    ...(process.env.POINTSNAP_BROWSER_FLYING_BLUE === "1"
      ? ["AF_FLYINGBLUE"]
      : []),
    ...(process.env.POINTSNAP_BROWSER_VIRGIN === "1" ? ["VS_FLYING_CLUB"] : []),
    ...(process.env.POINTSNAP_BROWSER_UNITED === "1" ? ["UA_MP"] : []),
    ...(process.env.POINTSNAP_BROWSER_QANTAS === "1" ? ["QF_FF"] : []),
    ...(process.env.POINTSNAP_BROWSER_COPA === "1" ? ["CM_CONNECTMILES"] : []),
    ...(process.env.POINTSNAP_BROWSER_SAS === "1" ? ["SK_EUROBONUS"] : []),
    ...(process.env.POINTSNAP_BROWSER_AMERICAN === "1"
      ? ["AA_AADVANTAGE"]
      : []),
    ...(process.env.POINTSNAP_BROWSER_DELTA === "1" ? ["DL_SKYMILES"] : []),
    ...(process.env.POINTSNAP_BROWSER_SMILES === "1" ? ["G3_GOL_SMILES"] : []),
    ...(process.env.POINTSNAP_BROWSER_ETIHAD === "1" ? ["EY_GUEST"] : []),
    ...(process.env.POINTSNAP_BROWSER_SOUTHWEST === "1"
      ? ["WN_RAPID_REWARDS"]
      : []),
  ];
}
const envelope = z.object({
  programId: z.enum([
    "AF_FLYINGBLUE",
    "VS_FLYING_CLUB",
    "UA_MP",
    "AA_AADVANTAGE",
    "DL_SKYMILES",
    "G3_GOL_SMILES",
    "EY_GUEST",
    "WN_RAPID_REWARDS",
    "SK_EUROBONUS",
    "CM_CONNECTMILES",
    "QF_FF",
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
    programId === "AF_FLYINGBLUE"
      ? "Flying Blue"
      : programId === "VS_FLYING_CLUB"
        ? "Virgin Atlantic"
        : programId === "UA_MP"
          ? "United"
          : programId === "QF_FF"
            ? "Qantas"
            : programId === "CM_CONNECTMILES"
              ? "Copa"
              : programId === "SK_EUROBONUS"
                ? "SAS"
                : programId === "WN_RAPID_REWARDS"
                  ? "Southwest"
                  : programId === "EY_GUEST"
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
        `/v1/search/${programId === "AF_FLYINGBLUE" ? "flying-blue" : programId === "VS_FLYING_CLUB" ? "virgin" : programId === "UA_MP" ? "united" : programId === "QF_FF" ? "qantas" : programId === "CM_CONNECTMILES" ? "copa" : programId === "SK_EUROBONUS" ? "sas" : programId === "WN_RAPID_REWARDS" ? "southwest" : programId === "EY_GUEST" ? "etihad" : programId === "G3_GOL_SMILES" ? "smiles" : programId === "DL_SKYMILES" ? "delta" : "american"}`,
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
          AbortSignal.timeout(
            programId === "AF_FLYINGBLUE" ||
              programId === "UA_MP" ||
              programId === "G3_GOL_SMILES" ||
              programId === "CM_CONNECTMILES" ||
              programId === "QF_FF"
              ? 185000
              : 100000,
          ),
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
    programId === "AF_FLYINGBLUE"
      ? parseFlyingBlueNative
      : programId === "VS_FLYING_CLUB"
        ? parseVirginNative
        : programId === "UA_MP"
          ? parseUnited
          : programId === "QF_FF"
            ? parseQantasNative
            : programId === "CM_CONNECTMILES"
              ? parseCopa
              : programId === "SK_EUROBONUS"
                ? parseSas
                : programId === "WN_RAPID_REWARDS"
                  ? parseSouthwest
                  : programId === "EY_GUEST"
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
  if (programId === "WN_RAPID_REWARDS") {
    const cashMatches = rows.reduce(
      (n, row) => n + (row.fares?.filter((fare) => fare.cashFare).length ?? 0),
      0,
    );
    onNotice?.(
      "Southwest’s available Basic, Choice, Choice Preferred and Choice Extra fares are all Economy. Same-flight stops are included. " +
        (cashMatches === data.fareCount && cashMatches > 0
          ? "Cash comparisons match each flight and fare family."
          : "Cash comparisons are shown only where the same flight and fare family could be matched; missing comparisons do not remove award fares."),
    );
  }
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
  if (programId === "CM_CONNECTMILES") {
    const payload = copaPayloadSchema.parse(data.payload);
    const { otherAirportItineraries } = copaObservationCounts(
      payload.response,
      q,
    );
    if (otherAirportItineraries)
      onNotice?.(
        `Copa also returned ${otherAirportItineraries} itineraries for nearby airports; only ${q.origin}–${q.dest} flights are shown.`,
      );
  }
  if (programId === "QF_FF") {
    const { otherAirportItineraries } = qantasNativeCounts(data.payload, q);
    onNotice?.(
      "Qantas’s anonymous Classic and Classic Plus quotes include exact per-person fees; its airline list rounds those fees upward. " +
        (otherAirportItineraries
          ? `The airline also returned ${otherAirportItineraries} itineraries for nearby airports; only ${q.origin}–${q.dest} flights are shown.`
          : ""),
    );
  }
  if (programId === "UA_MP") {
    const p = unitedPayloadSchema.parse(data.payload);
    onNotice?.(
      "MileagePlus prices were observed through an authorized member account and may depend on elite status. Confirm eligibility and the final price with United. " +
        (p.responses.some((r) => r.data.Warnings?.length)
          ? "The airline returned all displayed flights but also reported an upstream shopping warning; broader inventory completeness is unverified."
          : "All displayed flights and both cabin views were reconciled."),
    );
  }
  if (programId === "AF_FLYINGBLUE")
    onNotice?.(
      "Flying Blue member quotes include every displayed itinerary and expanded cabin fare. Exact fees are shown per person. Connecting segment cabins and broader route completeness remain under verification.",
    );
  if (programId === "VS_FLYING_CLUB")
    onNotice?.(
      "Native Flying Club member quotes include all displayed flight and cabin offers. Sold-out cabins are excluded; exact fees can differ from the airline’s rounded display.",
    );
  return rows;
}
