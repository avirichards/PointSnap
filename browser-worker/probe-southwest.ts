/** Bounded opt-in investigation of Southwest's public browser booking flow. */
import { chromium, webkit, firefox, type Browser } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";

async function main() {
  const engine = process.argv[2] || "webkit";
  if (engine !== "chromium" && engine !== "webkit" && engine !== "firefox")
    throw new Error("Choose a supported engine.");
  const query = JSON.parse(
    await readFile("scripts/diagnostics/southwest-request.json", "utf8"),
  );
  query.departureDate =
    process.argv[3] ||
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const landing = new URL(
    "https://www.southwest.com/air/booking/select-depart.html",
  );
  landing.search = new URLSearchParams({
    ...query,
    departureTimeOfDay: "ALL_DAY",
    returnTimeOfDay: "ALL_DAY",
  }).toString();
  const started = Date.now(),
    stages: Record<string, unknown>[] = [];
  let browser: Browser | undefined;
  let report: Record<string, unknown> = {};
  try {
    browser = await { chromium, webkit, firefox }[engine].launch({
      headless: true,
      timeout: 30000,
      ...(engine === "chromium"
        ? { channel: "chromium", chromiumSandbox: true }
        : {}),
    });
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    page.on("response", (response) => {
      if (response.request().isNavigationRequest())
        stages.push({
          stage: "document",
          elapsedMs: Date.now() - started,
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    const shopping = page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.hostname === "www.southwest.com" &&
            url.pathname ===
              "/api/air-booking/v1/air-booking/page/air/booking/shopping"
          );
        },
        { timeout: 45000 },
      )
      .catch(() => null);
    await page.goto(landing.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 40000,
    });
    const response = await shopping;
    const json = await response?.json().catch(() => null);
    // Record only the response shape and displayed flight/fare counts. No
    // headers, cookies, account state or opaque airline response identifiers.
    const renderedFares = await page
      .getByRole("button", { name: /fare [\d,]+ PTS/ })
      .count();
    report = {
      result: response?.ok() ? "unverified" : "error",
      shoppingStatus: response?.status() ?? null,
      errorCode: /^\d{3,12}$/.test(String(json?.code))
        ? String(json.code)
        : undefined,
      responseKeys: json && typeof json === "object" ? Object.keys(json) : [],
      title: (await page.title())
        .replace(/https?:\/\/\S+/g, "[booking page]")
        .slice(0, 200),
      displayedFareButtons: renderedFares,
      message:
        "A validated complete Southwest adapter is not enabled by this diagnostic.",
    };
    process.exitCode = 1;
  } catch {
    report = {
      result: "error",
      message: "The Southwest browser flow did not complete.",
    };
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
  const output = {
    at: new Date().toISOString(),
    engine,
    platform: process.platform,
    route: "DEN–LAS",
    date: query.departureDate,
    pax: 1,
    elapsedMs: Date.now() - started,
    ...report,
    stages,
  };
  await mkdir("work/browser-probes", { recursive: true });
  await writeFile(
    `work/browser-probes/southwest-${engine}.json`,
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(JSON.stringify(output));
}
void main().catch(() => {
  console.error("Southwest browser diagnostic setup failed.");
  process.exitCode = 1;
});
