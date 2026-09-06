/** Explicit live diagnostic of the same Smiles runner used by PointSnap. */
import { mkdir, writeFile } from "node:fs/promises";
import { SmilesBrowserRunner, type SmilesBrowserEngine } from "./smiles";
import { BrowserSearchError } from "./american";
import {
  parseSmiles,
  smilesObservationCounts,
} from "../src/lib/award-search/smiles";
import { parseQuery } from "../src/lib/award-search/query";

async function main() {
  const [
    date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    origin = "GRU",
    dest = "GIG",
    pax = "1",
  ] = process.argv.slice(2);
  const query = parseQuery(
    new URLSearchParams({ origin, dest, departDate: date, pax, minCabin: "Y" }),
  );
  const engine = process.env.POINTSNAP_SMILES_ENGINE ?? "webkit";
  if (!["webkit", "chromium", "firefox"].includes(engine))
    throw new Error("Unknown diagnostic browser engine.");
  const saveObservation = async (payload: unknown, rejected = false) => {
    await mkdir("work/browser-probes", { recursive: true });
    await writeFile(
      `work/browser-probes/smiles-${engine}-${origin}-${dest}-${date}-${pax}-${rejected ? "rejected-" : ""}flights.json`,
      JSON.stringify(payload),
      { mode: 0o600 },
    );
  };
  const runner = new SmilesBrowserRunner({
      engine: engine as SmilesBrowserEngine,
      onObservation:
        process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1"
          ? (payload) => saveObservation(payload)
          : undefined,
      onRejectedObservation:
        process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1"
          ? (payload) => saveObservation(payload, true)
          : undefined,
    }),
    started = Date.now();
  let report: Record<string, unknown>;
  try {
    const data = await runner.search(query, AbortSignal.timeout(180000));
    const rows = parseSmiles(data.payload, query, data.observedAt);
    const counts = smilesObservationCounts(data.payload);
    report = {
      result: "success",
      complete: true,
      itineraries: data.itineraryCount,
      fares: data.fareCount,
      listedItineraries: counts.listed,
      withdrawnOffers: counts.withdrawn,
      otherAirportOffers: counts.otherAirports,
      nonstops: rows.filter(
        (r) => r.segments.length === 1 && !r.segments[0].technicalStops?.length,
      ).length,
      stages: data.stages,
      observedAt: data.observedAt,
      example: rows[0]
        ? {
            flights: rows[0].segments.map((s) => s.flightNumber),
            duration: rows[0].duration,
            fares: rows[0].fares?.map((f) => ({
              name: f.fareName,
              cabin: f.cabin,
              points: f.points,
              partyPoints: f.partyPoints,
              cash: f.cash,
              currency: f.currency,
              seats: f.seats,
            })),
          }
        : null,
    };
  } catch (error) {
    report = {
      result: "error",
      complete: false,
      message:
        error instanceof BrowserSearchError
          ? error.message
          : "Smiles browser diagnostic did not complete.",
      stage: error instanceof BrowserSearchError ? error.stage : undefined,
      diagnostic:
        error instanceof BrowserSearchError ? error.evidence : undefined,
    };
    process.exitCode = 1;
  } finally {
    await runner.close();
  }
  const output = {
    at: new Date().toISOString(),
    engine,
    platform: process.platform,
    architecture: process.arch,
    query,
    elapsedMs: Date.now() - started,
    ...report,
  };
  await mkdir("work/browser-probes", { recursive: true });
  await writeFile(
    `work/browser-probes/smiles-${engine}-${origin}-${dest}-${date}-${pax}.json`,
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(JSON.stringify(output));
}
void main().catch(() => {
  console.error("Smiles diagnostic setup failed.");
  process.exitCode = 1;
});
