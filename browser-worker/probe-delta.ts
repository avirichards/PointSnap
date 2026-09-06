/** Explicit live diagnostic of the same Delta runner used by PointSnap. */
import { mkdir, writeFile } from "node:fs/promises";
import { DeltaBrowserRunner } from "./delta";
import { BrowserSearchError } from "./american";
import { parseDelta } from "../src/lib/award-search/delta";
import { parseQuery } from "../src/lib/award-search/query";

async function main() {
  const [
    date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    origin = "LAX",
    dest = "JFK",
    pax = "1",
  ] = process.argv.slice(2);
  const query = parseQuery(
    new URLSearchParams({ origin, dest, departDate: date, pax, minCabin: "Y" }),
  );
  const runner = new DeltaBrowserRunner({
      onObservation:
        process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1"
          ? async (payload) => {
              await mkdir("work/browser-probes", { recursive: true });
              await writeFile(
                `work/browser-probes/delta-${origin}-${dest}-${pax}-flights.json`,
                JSON.stringify(payload),
                { mode: 0o600 },
              );
            }
          : undefined,
    }),
    started = Date.now();
  let report: Record<string, unknown>;
  try {
    const data = await runner.search(query, AbortSignal.timeout(95000));
    const rows = parseDelta(data.payload, query, data.observedAt);
    report = {
      result: "success",
      complete: true,
      itineraries: data.itineraryCount,
      fares: data.fareCount,
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
          : "Delta browser diagnostic did not complete.",
      stage: error instanceof BrowserSearchError ? error.stage : undefined,
    };
    process.exitCode = 1;
  } finally {
    await runner.close();
  }
  const output = {
    at: new Date().toISOString(),
    engine: "webkit",
    platform: process.platform,
    query,
    elapsedMs: Date.now() - started,
    ...report,
  };
  await mkdir("work/browser-probes", { recursive: true });
  await writeFile(
    `work/browser-probes/delta-${origin}-${dest}-${pax}.json`,
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(JSON.stringify(output));
}
void main().catch(() => {
  console.error("Delta diagnostic setup failed.");
  process.exitCode = 1;
});
