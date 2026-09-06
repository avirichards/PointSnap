import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import type { SearchQuery } from "../src/lib/types";
import {
  parseQantasNative,
  readQantasNative,
  qantasNativeCounts,
} from "../src/lib/award-search/qantas-native";
import { ProviderError } from "../src/lib/award-search/types";
import { BrowserSearchError, type AmericanBrowserResult } from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";

export type QantasBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "QF_FF";
};
const domesticRows = '[id^="flight_row_bnd_0_flt_"]';
const internationalFares = 'input[type="radio"][name^="a_0_"]';

export function qantasBlockingNavigation(
  url: string,
  status: number,
  type: string,
) {
  return (
    new URL(url).hostname === "book.qantas.com" &&
    type === "document" &&
    [401, 403, 429].includes(status)
  );
}

export async function submitQantasForm(
  page: Page,
  q: SearchQuery,
  signal: AbortSignal,
) {
  await page.goto("https://www.qantas.com/en-us/book/flights", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page
    .getByRole("combobox", { name: "Departure location", exact: true })
    .waitFor();
  const reject = page.getByRole("button", { name: "Reject All", exact: true });
  if (await reject.isVisible()) await reject.click();
  const rewards = page.getByRole("switch", { name: "Rewards", exact: true });
  if (!(await rewards.isChecked())) await rewards.click();
  await page.getByRole("combobox", { name: "Trip Type", exact: true }).click();
  await page.getByRole("option", { name: "One way", exact: true }).click();
  for (const [name, clear, airport] of [
    ["Departure location", "Clear Departure Location", q.origin],
    ["Arrival location", "Clear Arrival location", q.dest],
  ]) {
    signal.throwIfAborted();
    const input = page.getByRole("combobox", { name, exact: true });
    const clearButton = page.getByRole("button", { name: clear, exact: true });
    if (await clearButton.isVisible()) await clearButton.click();
    await input.fill(airport);
    await page
      .getByRole("option")
      .filter({ has: page.getByText(airport, { exact: true }) })
      .click();
    await page
      .waitForFunction(
        ({ input, airport }) =>
          input instanceof HTMLInputElement &&
          input.value.startsWith(airport + ","),
        { input: await input.elementHandle(), airport },
        { timeout: 5000 },
      )
      .catch(() => {
        throw new BrowserSearchError(
          "Qantas's selected airport could not be confirmed.",
          "form",
        );
      });
  }
  await page.locator("#daypicker-button").click();
  const calendar = page.getByRole("dialog", {
    name: "Select travel dates",
    exact: true,
  });
  await calendar.waitFor();
  const about = page.getByRole("alertdialog", {
    name: "About reward seats",
    exact: true,
  });
  if (await about.isVisible())
    await about.getByRole("button", { name: "Close", exact: true }).click();
  const date = calendar.getByTestId(q.departDate);
  for (let n = 0; n < 12 && !(await date.count()); n++) {
    signal.throwIfAborted();
    const days = calendar.locator("button[data-timestamp]");
    const lastDate = await days.last().getAttribute("data-testid");
    await days.last().scrollIntoViewIfNeeded();
    await page
      .waitForFunction(
        (old) => {
          const days = document.querySelectorAll("button[data-timestamp]");
          return days[days.length - 1]?.getAttribute("data-testid") !== old;
        },
        lastDate,
        { timeout: 5000 },
      )
      .catch(() => {});
  }
  if (!(await date.count()) || !(await date.isEnabled()))
    throw new BrowserSearchError(
      "Qantas's calendar does not offer the requested date.",
      "form",
    );
  await date.click();
  await page
    .waitForFunction(
      (selectedDate) =>
        document
          .querySelector(`button[data-testid="${selectedDate}"]`)
          ?.getAttribute("aria-label")
          ?.includes("Selected for departure"),
      q.departDate,
      { timeout: 5000 },
    )
    .catch(async () => {
      throw new BrowserSearchError(
        "Qantas's selected departure date could not be confirmed.",
        "form",
        502,
        { dateLabel: await date.getAttribute("aria-label") },
      );
    });
  await calendar
    .getByRole("button", { name: "close date selector", exact: true })
    .click();
  await page.getByRole("button", { name: /^\d+ Adults?$/ }).click();
  const adults = page.getByRole("spinbutton", { name: "Adults", exact: true });
  const current = Number(await adults.inputValue());
  if (!Number.isInteger(current) || current < 1 || current > 9)
    throw new BrowserSearchError(
      "Qantas's adult count could not be read.",
      "form",
    );
  if (current !== q.pax) {
    await adults.fill(String(q.pax));
    await adults.press("Tab");
  }
  await page
    .waitForFunction(
      ({ input, count }) =>
        input instanceof HTMLInputElement && Number(input.value) === count,
      { input: await adults.elementHandle(), count: q.pax },
      { timeout: 5000 },
    )
    .catch(() => {
      throw new BrowserSearchError(
        "Qantas's passenger selection did not update.",
        "form",
      );
    });
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page
    .getByRole("button", {
      name: `${q.pax} Adult${q.pax === 1 ? "" : "s"}`,
      exact: true,
    })
    .waitFor();
  if (
    !(await rewards.isChecked()) ||
    !(
      await page
        .getByRole("combobox", { name: "Departure location", exact: true })
        .inputValue()
    ).startsWith(q.origin + ",") ||
    !(
      await page
        .getByRole("combobox", { name: "Arrival location", exact: true })
        .inputValue()
    ).startsWith(q.dest + ",")
  )
    throw new BrowserSearchError(
      "Qantas's route or rewards mode changed before submission.",
      "form",
    );
}

export function qantasDisplayedPrice(text: string) {
  const m = text.match(/([\d,]+)\s*(?:PTS)?\s*\+\s*\$([\d,]+(?:\.\d+)?)/i);
  return m
    ? {
        points: Number(m[1].replaceAll(",", "")),
        fees: Number(m[2].replaceAll(",", "")),
        plus: /Classic Plus/.test(text),
      }
    : null;
}
export type QantasDisplayedFare = { id: string; text: string };
export type QantasDisplayedRow = {
  id: string;
  text: string;
  fares: QantasDisplayedFare[];
};

export function validateQantasPage(
  response: unknown,
  q: SearchQuery,
  rows: QantasDisplayedRow[],
  layout: "domestic" | "international",
) {
  const a = readQantasNative(response, q).modelInput.availability,
    b = a.bounds[0],
    counts = qantasNativeCounts(response, q);
  const expectedIds = b.listItineraries.itineraries.map((i) => i.itemId).sort();
  if (
    JSON.stringify(rows.map((r) => r.id).sort()) !== JSON.stringify(expectedIds)
  )
    throw new BrowserSearchError(
      "Qantas's displayed flight list does not match every source itinerary.",
      "completeness",
      502,
      { source: expectedIds.length, displayed: rows.length },
    );
  let displayedFares = 0;
  for (const row of rows) {
    const expected = Object.values(b.flights[row.id].listRecommendation).filter(
      (r) => a.listFareFamily.fareFamilies[r.ffCode]?.isMarginal,
    );
    const priced = row.fares.filter((f) => qantasDisplayedPrice(f.text));
    if (priced.length !== expected.length)
      throw new BrowserSearchError(
        "Qantas's displayed award choices differ from its source.",
        "completeness",
        502,
        { flight: row.id, expected: expected.length, displayed: priced.length },
      );
    for (const r of expected) {
      const family = a.listFareFamily.fareFamilies[r.ffCode];
      const id =
        layout === "domestic"
          ? `${family.belongsToFirstDesktopColumn ? "left" : "right"}_desktop_group_bnd_0_flt_${row.id}`
          : `a_0_${row.id}_${r.ffCode}`;
      const cards = priced.filter((f) => f.id === id),
        p = cards.length === 1 ? qantasDisplayedPrice(cards[0].text) : null;
      // The airline rounds fees upward in the list. Keep its exact quote in PointSnap.
      if (
        !p ||
        p.points !== r.priceForOne.convertedBaseFare ||
        p.fees !== Math.ceil(r.taxForOne) ||
        p.plus !== r.isRewardPlus
      )
        throw new BrowserSearchError(
          "Qantas's award points, rounded fees or Classic fare type do not match the displayed card.",
          "completeness",
          502,
          { flight: row.id, family: r.ffCode },
        );
      displayedFares++;
    }
    const itinerary = b.listItineraries.itineraries.find(
      (i) => i.itemId === row.id,
    )!;
    {
      const compact = row.text.replace(/\s/g, "");
      for (const segment of itinerary.segments)
        if (!compact.includes(segment.airline.code + segment.flightNumber))
          throw new BrowserSearchError(
            "Qantas's displayed flight numbers do not match.",
            "completeness",
          );
      for (const value of [itinerary.beginDate, itinerary.endDate])
        if (!row.text.includes(new Date(value).toISOString().slice(11, 16)))
          throw new BrowserSearchError(
            "Qantas's displayed flight times do not match.",
            "completeness",
          );
      const minutes = itinerary.duration / 60000;
      const durations = [...row.text.matchAll(/(?:(\d+)h\s*)?(\d+)m\b/g)].map(
        (m) => Number(m[1] ?? 0) * 60 + Number(m[2]),
      );
      if (!durations.includes(minutes))
        throw new BrowserSearchError(
          "Qantas's displayed journey duration does not match.",
          "completeness",
        );
    }
  }
  if (displayedFares !== counts.fares)
    throw new BrowserSearchError(
      "Qantas's complete fare list could not be reconciled.",
      "completeness",
    );
  return { ...counts, displayedFares, layout };
}

export async function reconcileQantasPage(
  page: Page,
  response: unknown,
  q: SearchQuery,
  signal: AbortSignal,
) {
  await page
    .locator(`${domesticRows}, ${internationalFares}`)
    .first()
    .waitFor({ state: "attached", timeout: 25000 });
  const clear = page.getByRole("button", {
    name: "Clear all filters",
    exact: true,
  });
  if ((await clear.isVisible()) && (await clear.isEnabled()))
    await clear.click();
  const cabin = page.getByRole("button", {
    name: /^(?:Economy|Premium|Business|First|All) Cabin:/,
  });
  if (
    (await cabin.isVisible()) &&
    !(await cabin.innerText()).startsWith("All")
  ) {
    await cabin.click();
    await page.locator("#optionALL_0").click();
  }
  const more = page.getByRole("button", {
    name: "Show more flights",
    exact: true,
  });
  for (let n = 0; n < 20 && (await more.isVisible()); n++) {
    signal.throwIfAborted();
    const before = await page.locator(domesticRows).count();
    await more.click();
    await page.waitForFunction(
      ({ selector, before }) =>
        document.querySelectorAll(selector).length > before,
      { selector: domesticRows, before },
      { timeout: 5000 },
    );
  }
  if (await more.isVisible())
    throw new BrowserSearchError(
      "Qantas still has unexpanded flight results.",
      "completeness",
    );
  if (
    process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1" &&
    (await page.locator(internationalFares).count())
  ) {
    const structure = await page
      .locator(internationalFares)
      .first()
      .evaluate((input) => {
        const parents = [];
        let e = input.parentElement;
        while (e && e.tagName !== "BODY") {
          parents.push({
            tag: e.tagName,
            id: e.id,
            cls: e.className,
            radioCount: e.querySelectorAll("input[type=radio]").length,
            text: e.innerText.slice(0, 4500),
          });
          e = e.parentElement;
        }
        return parents;
      });
    await writeFile(
      "work/browser-probes/qantas-international-structure.json",
      JSON.stringify(structure, null, 2),
      { mode: 0o600 },
    );
  }
  const layout = (await page.locator(domesticRows).count())
    ? "domestic"
    : "international";
  const rows: QantasDisplayedRow[] =
    layout === "domestic"
      ? await page.locator(domesticRows).evaluateAll((els) =>
          els.map((e) => ({
            id: e.id.replace("flight_row_bnd_0_flt_", ""),
            text: (e as HTMLElement).innerText,
            fares: [
              ...e.querySelectorAll<HTMLButtonElement>(
                'button[id^="left_desktop_group_bnd_"],button[id^="right_desktop_group_bnd_"]',
              ),
            ].map((f) => ({ id: f.id, text: f.innerText })),
          })),
        )
      : await page.locator(internationalFares).evaluateAll((els) => {
          const groups = new Map<string, QantasDisplayedRow>();
          for (const input of els as HTMLInputElement[]) {
            const id = input.name.replace("a_0_", "");
            const row = groups.get(id) ?? {
              id,
              text:
                input.closest<HTMLElement>(".row.itinerary")?.innerText ?? "",
              fares: [],
            };
            row.fares.push({
              id: input.id,
              text: input.labels?.[0]?.innerText ?? "",
            });
            groups.set(id, row);
          }
          return [...groups.values()];
        });
  if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1")
    await writeFile(
      "work/browser-probes/qantas-displayed.json",
      JSON.stringify({ layout, rows }, null, 2),
      { mode: 0o600 },
    );
  return validateQantasPage(response, q, rows, layout);
}

export class QantasBrowserRunner {
  constructor(
    private session: PersistentBrowserSession = createDesktopChromeSession(
      "qantas",
    ),
  ) {}
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<QantasBrowserResult> {
    const started = Date.now();
    return this.session.run(signal, async (context) => {
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const abort = () => {
        void page.close().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      let stage = "form";
      try {
        await page.bringToFront();
        await submitQantasForm(page, q, signal);
        stage = "availability";
        const pending = page.waitForResponse(
          (r) => {
            const u = new URL(r.url());
            return (
              u.hostname === "book.qantas.com" &&
              u.pathname ===
                "/qf-booking/dyn/air/booking/flexPricerAvailabilityActionFromLoad"
            );
          },
          { timeout: 60000 },
        );
        void pending.catch(() => {});
        const denied = page
          .waitForResponse(
            (r) =>
              qantasBlockingNavigation(
                r.url(),
                r.status(),
                r.request().resourceType(),
              ),
            { timeout: 60000 },
          )
          .then((r) => {
            throw new BrowserSearchError(
              `Qantas's public booking page returned HTTP ${r.status()}. Award availability could not be checked.`,
              "access",
              r.status() === 429 ? 429 : 502,
            );
          });
        void denied.catch(() => {});
        const inventory = Promise.race([pending, denied]);
        void inventory.catch(() => {});
        await page
          .getByRole("button", { name: "Search flights", exact: true })
          .click();
        const proceed = page.getByRole("button", {
          name: "Continue",
          exact: true,
        });
        const notice = proceed.waitFor({ timeout: 30000 }).then(
          () => "notice" as const,
          () => "absent" as const,
        );
        void notice.catch(() => {});
        if (
          (await Promise.race([
            inventory.then(() => "response" as const),
            notice,
          ])) === "notice"
        )
          await proceed.click();
        const response = await inventory;
        if (!response.ok())
          throw new BrowserSearchError(
            `Qantas's native inventory returned HTTP ${response.status()}.`,
            stage,
            response.status() === 429 ? 429 : 502,
          );
        const bytes = await response.body();
        if (bytes.length > 16 * 1024 * 1024)
          throw new BrowserSearchError(
            "Qantas's response exceeded the collection limit.",
            stage,
          );
        const payload = readQantasNative(JSON.parse(bytes.toString("utf8")), q),
          observedAt = new Date().toISOString();
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
          await mkdir("work/browser-probes", { recursive: true });
          await writeFile(
            "work/browser-probes/qantas-candidate.json",
            JSON.stringify(payload, null, 2),
            { mode: 0o600 },
          );
        }
        const rows = parseQantasNative(payload, q, observedAt);
        stage = "completeness";
        const counts = await reconcileQantasPage(page, payload, q, signal);
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
          await writeFile(
            "work/browser-probes/qantas-reconciliation.json",
            JSON.stringify({ query: q, counts }, null, 2),
            { mode: 0o600 },
          );
          await page.screenshot({
            path: "work/browser-probes/qantas-reference.png",
          });
        }
        return {
          programId: "QF_FF",
          query: q,
          observedAt,
          complete: true,
          itineraryCount: rows.length,
          fareCount: rows.reduce((n, r) => n + (r.fares?.length ?? 0), 0),
          payload,
          stages: [
            {
              stage: "points",
              status: 200,
              elapsedMs: Date.now() - started,
              itineraries: rows.length,
              fares: counts.exactFares,
            },
          ],
        };
      } catch (e) {
        signal.throwIfAborted();
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
          await mkdir("work/browser-probes", { recursive: true });
          await writeFile(
            "work/browser-probes/qantas-failure.json",
            JSON.stringify(
              {
                stage,
                pages: context.pages().map((p) => {
                  const u = new URL(p.url());
                  return { host: u.hostname, path: u.pathname.split(";")[0] };
                }),
                message:
                  e instanceof Error
                    ? e.message
                        .replace(/https?:\/\/\S+/g, "[url]")
                        .slice(0, 1800)
                    : "unknown",
                evidence:
                  e instanceof BrowserSearchError ? e.evidence : undefined,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
          await page
            .screenshot({ path: "work/browser-probes/qantas-failure.png" })
            .catch(() => {});
        }
        if (e instanceof BrowserSearchError) throw e;
        if (e instanceof ProviderError)
          throw new BrowserSearchError(e.message, "parse");
        throw new BrowserSearchError(
          `Qantas's browser search could not complete its ${stage} step.`,
          stage,
        );
      } finally {
        signal.removeEventListener("abort", abort);
        await page.close().catch(() => {});
      }
    });
  }
  async close() {
    await this.session.close();
  }
}
