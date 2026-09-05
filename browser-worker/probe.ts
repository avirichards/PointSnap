/** Opt-in real browser/network diagnostic; no personal profile or credentials. */
import { mkdir, writeFile } from "node:fs/promises";
import { AmericanBrowserRunner, BrowserSearchError } from "./american";
import { parseQuery } from "../src/lib/award-search/query";

async function main() {
  const engine = process.argv[2];
  if (engine !== "chromium" && engine !== "webkit" && engine !== "firefox")
    throw new Error(
      "Pass chromium, webkit or firefox, followed by an optional YYYY-MM-DD departure date.",
    );
  const q = parseQuery(
    new URLSearchParams({
      origin: "LAX",
      dest: "AUS",
      departDate:
        process.argv[3] ||
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      pax: "1",
      minCabin: "Y",
    }),
  );
  const entry =
    process.env.POINTSNAP_BROWSER_ENTRY === "direct" ? "direct" : "homepage";
  const channel = process.env.POINTSNAP_BROWSER_CHANNEL || "chromium";
  const runner = new AmericanBrowserRunner({
    engine,
    headless: true,
    entry,
    channel,
  });
  const started = Date.now();
  let report: Record<string, unknown>;
  try {
    const result = await runner.search(q, AbortSignal.timeout(95000));
    report = {
      result: "success",
      itineraries: result.itineraryCount,
      fares: result.fareCount,
      stages: result.stages,
    };
  } catch (error) {
    report =
      error instanceof BrowserSearchError
        ? {
            result: "error",
            message: error.message,
            stage: error.stage,
            status: error.status,
            ...error.evidence,
          }
        : {
            result: "error",
            message: "The browser diagnostic could not complete.",
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
    headless: true,
    entry,
    channel: engine === "chromium" ? channel : undefined,
    query: q,
    elapsedMs: Date.now() - started,
    ...report,
  };
  await mkdir("work/browser-probes", { recursive: true });
  await writeFile(
    `work/browser-probes/${engine}.json`,
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(JSON.stringify(output));
}
void main().catch(() => {
  console.error(
    "Browser diagnostic setup failed. Check the engine, date and browser installation.",
  );
  process.exitCode = 1;
});
