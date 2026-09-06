import { AmericanBrowserRunner } from "./american";
import { createBrowserWorker } from "./server";
import { DeltaBrowserRunner } from "./delta";
import { SmilesBrowserRunner } from "./smiles";

const channel = process.env.POINTSNAP_BROWSER_CHANNEL || "chromium";
const headless = process.env.POINTSNAP_BROWSER_HEADLESS !== "0";
const configuredEngine = process.env.POINTSNAP_BROWSER_ENGINE ?? "chromium";
if (!["chromium", "firefox", "webkit"].includes(configuredEngine))
  throw new Error(
    "Choose chromium, firefox or webkit for POINTSNAP_BROWSER_ENGINE.",
  );
const engine = configuredEngine as "chromium" | "firefox" | "webkit";
const entry =
  process.env.POINTSNAP_BROWSER_ENTRY === "homepage-form"
    ? "homepage-form"
    : process.env.POINTSNAP_BROWSER_ENTRY === "direct"
      ? "direct"
      : "homepage";
const runner = new AmericanBrowserRunner({ channel, headless, entry, engine });
const worker = createBrowserWorker(runner, {
  token: process.env.POINTSNAP_BROWSER_WORKER_TOKEN || "",
  evidenceDirectory: process.env.POINTSNAP_BROWSER_EVIDENCE_DIR,
  smilesRunner:
    process.env.POINTSNAP_BROWSER_SMILES === "1"
      ? new SmilesBrowserRunner()
      : undefined,
  deltaRunner:
    process.env.POINTSNAP_BROWSER_DELTA === "1"
      ? new DeltaBrowserRunner()
      : undefined,
});
const host = process.env.POINTSNAP_BROWSER_HOST || "127.0.0.1";
const port = Number(process.env.POINTSNAP_BROWSER_PORT || "3002");
worker.server.listen(port, host, () => {
  console.log(
    `PointSnap browser worker listening on ${host}:${port}; engine=${engine}; channel=${channel}; headless=${headless}; entry=${entry}`,
  );
});
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.once(event, () => {
    void worker.close().finally(() => process.exit(0));
  });
