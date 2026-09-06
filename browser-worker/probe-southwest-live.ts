import { mkdir, writeFile } from "node:fs/promises";
import { parseQuery } from "../src/lib/award-search/query";
import { SouthwestBrowserRunner } from "./southwest";
import { BrowserSearchError } from "./american";
async function main() {
  const [origin = "DEN", dest = "LAS", departDate = "2026-10-05", pax = "2"] =
    process.argv.slice(2);
  const query = parseQuery(
    new URLSearchParams({ origin, dest, departDate, pax, minCabin: "Y" }),
  );
  const runner = new SouthwestBrowserRunner(),
    started = Date.now();
  try {
    const r = await runner.search(query, AbortSignal.timeout(120000));
    const summary = {
      program: r.programId,
      query,
      itineraries: r.itineraryCount,
      fares: r.fareCount,
      elapsedMs: Date.now() - started,
      stages: r.stages,
    };
    await mkdir("work/browser-probes", { recursive: true });
    await writeFile(
      "work/browser-probes/southwest-latest.json",
      JSON.stringify(summary, null, 2) + "\n",
    );
    if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1")
      await writeFile(
        "work/browser-probes/southwest-payload.json",
        JSON.stringify(r.payload, null, 2) + "\n",
        { mode: 0o600 },
      );
    console.log(JSON.stringify(summary));
  } catch (e) {
    console.log(
      JSON.stringify({
        query,
        elapsedMs: Date.now() - started,
        error:
          e instanceof BrowserSearchError
            ? e.message
            : "Southwest probe failed.",
        stage: e instanceof BrowserSearchError ? e.stage : "probe",
      }),
    );
    process.exitCode = 1;
  } finally {
    await runner.close();
  }
}
void main();
