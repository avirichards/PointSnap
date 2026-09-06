import { mkdir, writeFile } from "node:fs/promises";
import { parseQuery } from "../src/lib/award-search/query";
import { EtihadBrowserRunner } from "./etihad";
import { BrowserSearchError } from "./american";

async function main() {
  const [origin = "JFK", dest = "AUH", departDate = "2026-10-05", pax = "1"] =
    process.argv.slice(2);
  const query = parseQuery(
    new URLSearchParams({ origin, dest, departDate, pax, minCabin: "Y" }),
  );
  const runner = new EtihadBrowserRunner(),
    started = Date.now();
  try {
    const result = await runner.search(query, AbortSignal.timeout(150000));
    await mkdir("work/browser-probes", { recursive: true });
    const summary = {
      program: result.programId,
      query,
      itineraries: result.itineraryCount,
      fares: result.fareCount,
      elapsedMs: Date.now() - started,
      stages: result.stages,
    };
    await writeFile(
      "work/browser-probes/etihad-latest.json",
      JSON.stringify(summary, null, 2) + "\n",
    );
    if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1")
      await writeFile(
        "work/browser-probes/etihad-payload.json",
        JSON.stringify(result.payload, null, 2) + "\n",
        { mode: 0o600 },
      );
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.log(
      JSON.stringify({
        query,
        elapsedMs: Date.now() - started,
        error:
          error instanceof BrowserSearchError
            ? error.message
            : "Etihad probe failed.",
        stage: error instanceof BrowserSearchError ? error.stage : "probe",
        evidence:
          error instanceof BrowserSearchError ? error.evidence : undefined,
      }),
    );
    process.exitCode = 1;
  } finally {
    await runner.close();
  }
}
void main();
