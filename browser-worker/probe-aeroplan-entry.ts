// Bounded current-flow diagnostic: ordinary Chrome, isolated airline profile.
// No login, credentials, cookies, response bodies or personal state are read.
import { mkdir, writeFile } from "node:fs/promises";
import { createDesktopChromeSession } from "./desktop-chrome";
import { BrowserSessionLaunchError } from "./persistent-session";

async function main() {
  const session = createDesktopChromeSession("aeroplan");
  const reports: unknown[] = [];
  let stage = "launch";
  try {
    await session.run(AbortSignal.timeout(120000), async (context) => {
      stage = "page";
      const page = context.pages()[0] || (await context.newPage());
      page.setDefaultTimeout(15000);
      const inventoryRequests: { path: string; status: number }[] = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (
          url.hostname.endsWith(".aircanada.com") &&
          /\/search\/air-bounds/.test(url.pathname)
        )
          inventoryRequests.push({
            path: url.pathname,
            status: response.status(),
          });
      });
      for (const [entry, url] of [
        [
          "published-points-homepage",
          "https://www.aircanada.com/ca/en/aco/home.html?bookWith=points",
        ],
        [
          "published-award-results",
          "https://www.aircanada.com/aeroplan/redeem/availability/outbound?ADT=1&CHD=0&INF=0&INS=0&YTH=0&departureDate0=2026-11-24&dest0=SFO&lang=en-CA&marketCode=INT&org0=PVG&tripType=O",
        ],
      ]) {
        const started = Date.now();
        stage = `${entry}:activate`;
        inventoryRequests.length = 0;
        await page.bringToFront();
        stage = `${entry}:navigate`;
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        stage = `${entry}:read`;
        await page
          .waitForFunction(
            () =>
              /Please sign in to book with Aeroplan points|Aeroplan number or email|Access Denied|available flights|flight results/i.test(
                document.body.innerText,
              ),
            undefined,
            { timeout: 30000 },
          )
          .catch(() => {});
        const state = await page.evaluate(() => {
          const text = document.body.innerText;
          return {
            title: document.title,
            path: location.pathname,
            pointsSignInPrompt:
              /Please sign in to book with Aeroplan points/i.test(text),
            loginForm: [
              ...document.querySelectorAll('input[type="password"]'),
            ].some((element) => !!element.getClientRects().length),
            memberIdentifierLabel: /Aeroplan number or email/.test(text),
            verification:
              /access denied|verify you are human|challenge validation|complete the security check/i.test(
                text,
              ),
            flightResultsText: /available flights|flight results/i.test(text),
          };
        });
        const report = {
          entry,
          at: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          navigationStatus: response?.status(),
          ...state,
          inventoryRequests: [...inventoryRequests],
        };
        reports.push(report);
        console.log(JSON.stringify(report));
      }
    });
  } catch (error) {
    const report = {
      stage,
      error: "Entry diagnostic failed",
      issue:
        error instanceof BrowserSessionLaunchError
          ? error.issue
          : error instanceof Error &&
              /__name is not defined/.test(error.message)
            ? "serialized-function-helper"
            : error instanceof Error &&
                /Execution context was destroyed/.test(error.message)
              ? "navigation-during-read"
              : error instanceof Error
                ? error.name
                : "unknown",
    };
    reports.push(report);
    console.log(JSON.stringify(report));
    process.exitCode = 1;
  } finally {
    await session.close();
    await mkdir("work/aeroplan-current", { recursive: true });
    await writeFile(
      "work/aeroplan-current/anonymous-entry-report.json",
      JSON.stringify(
        { method: "app-owned ordinary Chrome; no login", reports },
        null,
        2,
      ) + "\n",
    );
  }
}
void main().catch(() => {
  console.error(
    "Aeroplan entry diagnostic did not complete; no availability inferred.",
  );
  process.exitCode = 1;
});
