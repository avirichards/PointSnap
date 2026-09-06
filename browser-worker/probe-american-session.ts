/** Opt-in: three real anonymous searches, one profile, then a normal restart. */
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { AmericanBrowserRunner, BrowserSearchError } from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import { parseQuery } from "../src/lib/award-search/query";

async function main() {
  const mode = process.argv[2];
  if (
    mode !== "chromium" &&
    mode !== "webkit" &&
    mode !== "firefox" &&
    mode !== "desktop-chrome"
  )
    throw new Error("Choose chromium, webkit, firefox or desktop-chrome.");
  const desktop = mode === "desktop-chrome";
  const engine = desktop ? "chromium" : mode;
  const query = parseQuery(
    new URLSearchParams({
      origin: process.argv[4] || "LAX",
      dest: process.argv[5] || "AUS",
      departDate:
        process.argv[3] ||
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      pax: process.argv[6] || "1",
      minCabin: "Y",
    }),
  );
  const idleMs = Number(process.env.POINTSNAP_PROFILE_IDLE_MS ?? "30000");
  if (!Number.isFinite(idleMs) || idleMs < 0 || idleMs > 3600000)
    throw new Error("Choose an idle interval between zero and one hour.");
  const options = {
    engine,
    channel: desktop
      ? "chrome"
      : process.env.POINTSNAP_BROWSER_CHANNEL || "chromium",
    headless: desktop ? false : process.env.POINTSNAP_BROWSER_HEADLESS !== "0",
    entry: "homepage-form" as const,
    persistentProfile: true,
  } satisfies NonNullable<
    ConstructorParameters<typeof AmericanBrowserRunner>[0]
  >;
  const createRunner = () =>
    desktop
      ? new AmericanBrowserRunner(
          { entry: "homepage-form" },
          createDesktopChromeSession(),
        )
      : new AmericanBrowserRunner(options);
  let runner = createRunner();
  const reports: Record<string, unknown>[] = [];
  const file = `work/browser-probes/american-persistent-${mode}-${Date.now()}.json`;
  await mkdir("work/browser-probes", { recursive: true });
  try {
    for (const phase of [
      "initial",
      "same-session-after-idle",
      "after-browser-restart",
    ]) {
      if (phase === "same-session-after-idle") {
        console.log(JSON.stringify({ event: "idle", idleMs }));
        await delay(idleMs);
      }
      if (phase === "after-browser-restart") {
        await runner.close();
        runner = createRunner();
      }
      const started = Date.now();
      console.log(JSON.stringify({ event: "search-start", phase }));
      let result: Record<string, unknown>;
      try {
        const response = await runner.search(query, AbortSignal.timeout(95000));
        result = {
          result: "success",
          itineraries: response.itineraryCount,
          fares: response.fareCount,
          stages: response.stages,
        };
      } catch (error) {
        result =
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
                message: "The profile experiment could not complete.",
              };
        process.exitCode = 1;
      }
      const report = {
        phase,
        at: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        ...result,
      };
      reports.push(report);
      console.log(JSON.stringify(report));
      await writeFile(
        file,
        JSON.stringify(
          { query, mode, options, platform: process.platform, idleMs, reports },
          null,
          2,
        ) + "\n",
      );
      if (result.stage === "launch") {
        console.log(
          JSON.stringify({
            event: "remaining-phases-skipped",
            reason:
              "No browser started; profile reuse and idle recovery could not be tested.",
          }),
        );
        break;
      }
    }
  } finally {
    await runner.close();
  }
  console.log(JSON.stringify({ event: "report-saved", file }));
}
void main().catch(() => {
  console.error(
    "American profile diagnostic setup failed; no availability was inferred.",
  );
  process.exitCode = 1;
});
