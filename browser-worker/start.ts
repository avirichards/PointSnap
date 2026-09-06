import { AmericanBrowserRunner } from "./american";
import { createBrowserWorker } from "./server";
import { EtihadBrowserRunner } from "./etihad";
import { DeltaBrowserRunner } from "./delta";
import { SmilesBrowserRunner } from "./smiles";
import { SasBrowserRunner } from "./sas";
import { CopaBrowserRunner } from "./copa";
import { QantasBrowserRunner } from "./qantas";
import { SouthwestBrowserRunner } from "./southwest";
import { createDesktopChromeSession } from "./desktop-chrome";

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
const persistentProfile =
  process.env.POINTSNAP_BROWSER_PERSISTENT_PROFILE === "1";
const americanMode = process.env.POINTSNAP_AMERICAN_BROWSER_MODE ?? "managed";
const includePremium = process.env.POINTSNAP_AMERICAN_EXPAND_CABINS === "1";
if (americanMode !== "managed" && americanMode !== "desktop-chrome")
  throw new Error(
    "Choose managed or desktop-chrome for POINTSNAP_AMERICAN_BROWSER_MODE.",
  );
const runner =
  americanMode === "desktop-chrome"
    ? new AmericanBrowserRunner(
        {
          entry: "homepage-form",
          includePremium,
        },
        createDesktopChromeSession(),
      )
    : new AmericanBrowserRunner({
        channel,
        headless,
        entry,
        engine,
        persistentProfile,
      });
const worker = createBrowserWorker(runner, {
  token: process.env.POINTSNAP_BROWSER_WORKER_TOKEN || "",
  evidenceDirectory: process.env.POINTSNAP_BROWSER_EVIDENCE_DIR,
  qantasRunner:
    process.env.POINTSNAP_BROWSER_QANTAS === "1"
      ? new QantasBrowserRunner()
      : undefined,
  copaRunner:
    process.env.POINTSNAP_BROWSER_COPA === "1"
      ? new CopaBrowserRunner()
      : undefined,
  sasRunner:
    process.env.POINTSNAP_BROWSER_SAS === "1"
      ? new SasBrowserRunner()
      : undefined,
  southwestRunner:
    process.env.POINTSNAP_BROWSER_SOUTHWEST === "1"
      ? new SouthwestBrowserRunner()
      : undefined,
  etihadRunner:
    process.env.POINTSNAP_BROWSER_ETIHAD === "1"
      ? new EtihadBrowserRunner()
      : undefined,
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
    `PointSnap browser worker listening on ${host}:${port}; americanMode=${americanMode}; engine=${engine}; channel=${americanMode === "desktop-chrome" ? "chrome" : channel}; headless=${americanMode === "desktop-chrome" ? false : headless}; entry=${americanMode === "desktop-chrome" ? "homepage-form" : entry}; persistentProfile=${americanMode === "desktop-chrome" || persistentProfile}; expandCabins=${americanMode === "desktop-chrome" && includePremium}`,
  );
});
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.once(event, () => {
    void worker.close().finally(() => process.exit(0));
  });
