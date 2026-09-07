/** Explicit access experiment, not enabled by the normal app worker. */
import { mkdir, writeFile } from "node:fs/promises";
import { AmericanBrowserRunner, BrowserSearchError } from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import { parseQuery } from "../src/lib/award-search/query";

async function main() {
  const [origin = "LAX", dest = "AUS", departDate = "2026-10-05", pax = "2"] =
    process.argv.slice(2);
  const query = parseQuery(
    new URLSearchParams({ origin, dest, departDate, pax, minCabin: "Y" }),
  );
  const directory = `work/browser-probes/american-connections-${Date.now()}`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const started = Date.now();
  const scopes: {
    connectionCity: string | null;
    itineraries: number;
    fares: number;
    elapsedMs: number;
  }[] = [];
  const runner = new AmericanBrowserRunner(
    {
      entry: "homepage-form",
      includePremium: true,
      includeConnections: true,
      async onScope({ connectionCity, result }) {
        const summary = {
          connectionCity,
          itineraries: result.itineraryCount,
          fares: result.fareCount,
          elapsedMs: Date.now() - started,
        };
        scopes.push(summary);
        await writeFile(
          `${directory}/progress.json`,
          JSON.stringify({ query, scopes, complete: false }, null, 2),
          { mode: 0o600 },
        );
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1")
          await writeFile(
            `${directory}/${connectionCity ?? "baseline"}.json`,
            JSON.stringify(result, null, 2),
            { mode: 0o600 },
          );
        console.log(JSON.stringify({ event: "scope-verified", ...summary }));
      },
    },
    createDesktopChromeSession("american"),
  );
  try {
    const result = await runner.search(query, AbortSignal.timeout(300000));
    const summary = {
      query,
      complete: true,
      itineraries: result.itineraryCount,
      fares: result.fareCount,
      scopes,
      elapsedMs: Date.now() - started,
    };
    await writeFile(
      `${directory}/result.json`,
      JSON.stringify(summary, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(summary));
  } catch (error) {
    const summary = {
      query,
      complete: false,
      scopes,
      elapsedMs: Date.now() - started,
      error:
        error instanceof BrowserSearchError
          ? error.message
          : "The connection experiment did not complete.",
      stage: error instanceof BrowserSearchError ? error.stage : "experiment",
    };
    await writeFile(
      `${directory}/result.json`,
      JSON.stringify(summary, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(summary));
    process.exitCode = 1;
  } finally {
    await runner.close();
  }
}
void main();
