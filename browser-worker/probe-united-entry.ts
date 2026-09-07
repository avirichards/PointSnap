import { createCollectorPage, prepareCollectorPage } from "./background-page";
// Current official form, dedicated ordinary Chrome; no account or cookie import.
import { mkdir, writeFile } from "node:fs/promises";
import { createDesktopChromeSession } from "./desktop-chrome";
import { BrowserSessionLaunchError } from "./persistent-session";

async function main() {
  const session = createDesktopChromeSession("united");
  const reports: unknown[] = [];
  let stage = "launch";
  try {
    await session.run(AbortSignal.timeout(150000), async (context) => {
      const page = context.pages()[0] || (await createCollectorPage(context));
      page.setDefaultTimeout(15000);
      const responses: { path: string; status: number }[] = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (
          url.hostname.endsWith("united.com") &&
          /\/api\/flight\//i.test(url.pathname)
        )
          responses.push({ path: url.pathname, status: response.status() });
      });
      stage = "award-form";
      await prepareCollectorPage(page);
      await page.goto(
        "https://www.united.com/en/us/book-flight/united-award-travel",
        { waitUntil: "domcontentloaded", timeout: 45000 },
      );
      await page
        .getByRole("heading", { name: "Book an award flight", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Accept cookies", exact: true })
        .click({ timeout: 5000 })
        .catch(() => {});
      await page.getByRole("tab", { name: "One-way", exact: true }).click();
      stage = "route-date";
      await page
        .getByRole("combobox", {
          name: "From departing city, airport name, or airport code.",
          exact: true,
        })
        .fill("LAX");
      await page
        .getByRole("button", { name: "Los Angeles, CA, US (LAX)", exact: true })
        .click();
      await page
        .getByRole("combobox", {
          name: "To destination city, airport name, or airport code.",
          exact: true,
        })
        .fill("AUS");
      await page
        .getByRole("button", { name: "Austin, TX, US (AUS)", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Departure", exact: true })
        .fill("10/06/2026");
      await page
        .getByRole("textbox", { name: "Departure", exact: true })
        .press("Tab");
      const started = Date.now();
      stage = "submit-miles";
      await page
        .getByRole("button", { name: "Find flights", exact: true })
        .click();
      await page
        .waitForFunction(
          () =>
            /Sign in for the best experience|flight results are|Select flight|unable to process|Access Denied/i.test(
              document.body.innerText,
            ),
          undefined,
          { timeout: 35000 },
        )
        .catch(() => {});
      const readState = () =>
        page.evaluate(() => ({
          path: location.pathname,
          loginDialog:
            /Sign in for the best experience/.test(document.body.innerText) &&
            [...document.querySelectorAll("input")].some(
              (el) =>
                /Email or MileagePlus/i.test(
                  el.getAttribute("aria-label") ||
                    el.closest("label")?.textContent ||
                    "",
                ) || !!document.querySelector('[role="dialog"] input'),
            ),
          loading: /Loading results/.test(document.body.innerText),
          verification:
            /Access Denied|verify you are human|challenge validation/i.test(
              document.body.innerText,
            ),
          priceMode: [...document.querySelectorAll("select")]
            .map((el) => el.selectedOptions[0]?.textContent)
            .filter((text) => text === "Miles" || text === "Money"),
          flightSelectButtons: [...document.querySelectorAll("button")].filter(
            (el) => /select flight|select fare/i.test(el.innerText),
          ).length,
        }));
      let report = {
        phase: "award-submission",
        at: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        state: await readState(),
        responses: [...responses],
      };
      reports.push(report);
      console.log(JSON.stringify(report));
      if (
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .isVisible()
      ) {
        stage = "dismiss-login";
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        await page
          .waitForFunction(
            () => !/Loading results/.test(document.body.innerText),
            undefined,
            { timeout: 20000 },
          )
          .catch(() => {});
        report = {
          phase: "after-dismissed-login",
          at: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          state: await readState(),
          responses: [...responses],
        };
        reports.push(report);
        console.log(JSON.stringify(report));
      }
    });
  } catch (error) {
    const report = {
      stage,
      error: "Native form diagnostic failed",
      issue:
        error instanceof BrowserSessionLaunchError
          ? error.issue
          : error instanceof Error &&
              /__name is not defined/.test(error.message)
            ? "serialized-function-helper"
            : error instanceof Error
              ? error.name
              : "unknown",
    };
    reports.push(report);
    console.log(JSON.stringify(report));
    process.exitCode = 1;
  } finally {
    await session.close();
    await mkdir("work/united-current", { recursive: true });
    await writeFile(
      "work/united-current/anonymous-form-report.json",
      JSON.stringify(
        {
          query: { origin: "LAX", dest: "AUS", date: "2026-10-06", pax: 1 },
          method: "app-owned ordinary Chrome; no login",
          reports,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
void main().catch(() => {
  console.error("United diagnostic setup failed; no availability inferred.");
  process.exitCode = 1;
});
