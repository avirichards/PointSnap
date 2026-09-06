import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import type { SearchQuery } from "../src/lib/types";
import {
  copaResponseSchema,
  copaObservationCounts,
  parseCopa,
  validateCopaRequest,
} from "../src/lib/award-search/copa";
import { ProviderError } from "../src/lib/award-search/types";
import { BrowserSearchError, type AmericanBrowserResult } from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";
export type CopaBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "CM_CONNECTMILES";
};
const passengerButton =
  "Travelers section. Select the number of adults, children and babies that will be traveling.";
const moreLabel =
  "View more button. Press the button to view more flight results";
export function copaDateLabel(date: string) {
  const d = new Date(date + "T12:00:00Z"),
    day = d.getUTCDate(),
    ordinal =
      day >= 11 && day <= 13
        ? "th"
        : day % 10 === 1
          ? "st"
          : day % 10 === 2
            ? "nd"
            : day % 10 === 3
              ? "rd"
              : "th";
  return (
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(d) +
    ", " +
    new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
      d,
    ) +
    " " +
    day +
    ordinal +
    ", " +
    d.getUTCFullYear()
  );
}
export async function submitCopaForm(
  page: Page,
  q: SearchQuery,
  signal: AbortSignal,
) {
  await page.goto("https://www.copaair.com/", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.locator("#origin:visible").waitFor();
  if (await page.locator('button:visible:has-text("Round Trip")').count()) {
    await page.locator('button:visible:has-text("Round Trip")').click();
    await page
      .getByText("One way", { exact: true })
      .filter({ visible: true })
      .click();
  }
  if (
    !(
      await page
        .locator('button[data-ga="Booking Panel/Trip Selector"]:visible')
        .innerText()
    ).includes("One way")
  )
    throw new BrowserSearchError(
      "Copa's one-way search mode could not be confirmed.",
      "form",
    );
  const award = page.locator('input[type="checkbox"]:visible');
  if (!(await award.isChecked()))
    await page.locator('label:visible:has-text("Book with miles")').click();
  for (const [id, airport] of [
    ["origin", q.origin],
    ["destination", q.dest],
  ]) {
    await page.locator(`#${id}:visible`).fill(airport);
    await page
      .getByText(airport, { exact: true })
      .filter({ visible: true })
      .click();
  }
  await page.locator("#datecalendar-input-big-id:visible").click();
  const label = copaDateLabel(q.departDate),
    dateButton = page.getByRole("button", {
      name: new RegExp("^(?:Today, )?" + label + "$"),
    });
  for (let n = 0; n < 13 && !(await dateButton.isVisible()); n++) {
    signal.throwIfAborted();
    const previous = await page
      .locator("button[aria-label]")
      .evaluateAll((els) =>
        els
          .find(
            (e) =>
              e.getClientRects().length &&
              /^(?:Today, )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /.test(
                e.getAttribute("aria-label") ?? "",
              ),
          )
          ?.getAttribute("aria-label"),
      );
    const next = page.getByRole("button", {
      name: "Go to the Next Month",
      exact: true,
    });
    if (!(await next.isEnabled())) break;
    await next.click();
    await page.waitForFunction(
      (old) =>
        [...document.querySelectorAll("button[aria-label]")]
          .find(
            (e) =>
              e.getClientRects().length &&
              /^(?:Today, )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /.test(
                e.getAttribute("aria-label") ?? "",
              ),
          )
          ?.getAttribute("aria-label") !== old,
      previous,
      { timeout: 5000, polling: 100 },
    );
  }
  if (!(await dateButton.isVisible()) || !(await dateButton.isEnabled()))
    throw new BrowserSearchError(
      "Copa's calendar does not offer the requested departure date.",
      "form",
    );
  await dateButton.click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  const save = page.getByRole("button", { name: /^Save passenger selection/ });
  if (!(await save.isVisible()))
    await page
      .getByRole("button", { name: passengerButton, exact: true })
      .click();
  const current = (await save.getAttribute("aria-label"))?.match(
    /Selected (\d+) Adult\[s\], (\d+) Child\[ren\], and (\d+) Infant\[s\]/,
  );
  if (!current || current[2] !== "0" || current[3] !== "0")
    throw new BrowserSearchError(
      "Copa's passenger selection could not be confirmed.",
      "form",
    );
  for (let n = 0; n < Math.abs(q.pax - Number(current[1])); n++)
    await page
      .getByRole("button", {
        name: q.pax > Number(current[1]) ? "+" : "-",
        exact: true,
      })
      .first()
      .click();
  await save.click();
  if (
    !(await page.locator("#origin:visible").inputValue()).includes(
      `(${q.origin})`,
    ) ||
    !(await page.locator("#destination:visible").inputValue()).includes(
      `(${q.dest})`,
    ) ||
    (await page
      .getByRole("button", { name: passengerButton, exact: true })
      .innerText()) !== `${q.pax} Adult${q.pax === 1 ? "" : "s"}` ||
    !(await award.isChecked())
  )
    throw new BrowserSearchError(
      "Copa's displayed route, passengers or points mode changed before submission.",
      "form",
    );
}
type CopaSolution = ReturnType<
  typeof copaResponseSchema.parse
>[0]["solutions"][number];
export function copaSourceIdentity(s: CopaSolution) {
  const first = s.flights[0],
    last = s.flights.at(-1)!;
  const parts = s.journeyTime.match(/^PT(\d+)H(\d+)M$/)!;
  return [
    s.flights
      .map(
        (f) => f.marketingCarrier.airlineCode + f.marketingCarrier.flightNumber,
      )
      .join("·"),
    first.departure.airportCode,
    last.arrival.airportCode,
    first.departure.flightTime,
    last.arrival.flightTime,
    Number(parts[1]) * 60 + Number(parts[2]),
  ].join("|");
}
export function copaDisplayedIdentity(codes: string, text: string) {
  const airports = [...text.matchAll(/\(([A-Z]{3})\)/g)].map((m) => m[1]);
  const clocks = [...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/gi)];
  const times = clocks.map(
    (m) =>
      String(
        (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0),
      ).padStart(2, "0") +
      ":" +
      m[2],
  );
  // Layover durations appear above the journey. The total is between its clocks.
  const journey =
    clocks.length === 2
      ? text.slice(clocks[0].index! + clocks[0][0].length, clocks[1].index)
      : "";
  const hm = journey.match(/\b(?:(\d+)h\s*)?(\d+)m\b/),
    h = journey.match(/\b(\d+)h\b/);
  const duration = hm
    ? Number(hm[1] ?? 0) * 60 + Number(hm[2])
    : h
      ? Number(h[1]) * 60
      : null;
  if (airports.length !== 2 || times.length !== 2 || duration === null)
    throw new BrowserSearchError(
      "Copa's displayed itinerary identity could not be confirmed.",
      "completeness",
    );
  return [codes.replace(/\s/g, ""), ...airports, ...times, duration].join("|");
}
export async function reconcileCopaPage(
  page: Page,
  response: unknown,
  q: SearchQuery,
  signal: AbortSignal,
) {
  const [source] = copaResponseSchema.parse(response),
    counts = copaObservationCounts(response, q);
  await page.locator('[data-cy="tripCard_0"]').waitFor({ timeout: 20000 });
  // Copa can apply a retained filter after the initial list renders, removing
  // and renumbering rows. Clear it through the real UI before collecting fares.
  const closeFilters = page.getByRole("button", {
    name: "Filters close button. Press the button to continue with the flight selection.",
    exact: true,
  });
  if (!(await closeFilters.isVisible()))
    await page
      .getByRole("button", {
        name: "Button to filter and sort flights results. Press the button to see the filter options.",
        exact: true,
      })
      .click();
  await page
    .getByRole("button", {
      name: "Button to clear the filter selection you made. Press to clear all applied filters.",
      exact: true,
    })
    .click();
  await closeFilters.click();
  await page.waitForTimeout(750);
  for (let n = 0; n < 30; n++) {
    const more = page.getByRole("button", { name: moreLabel, exact: true });
    if (!(await more.isVisible())) break;
    await more.click();
  }
  if (
    (await page
      .getByRole("button", { name: moreLabel, exact: true })
      .isVisible()) ||
    (await page.locator('[data-cy^="generalCard_"]').count()) !==
      counts.itineraries ||
    !(await page.locator("#btnLoginBox").isVisible()) ||
    (await page.locator('[data-cy="searchParams-passengers"]').innerText()) !==
      `${q.pax} Passenger${q.pax === 1 ? "" : "s"}`
  )
    throw new BrowserSearchError(
      "Copa's displayed flights, party or anonymous state did not match its response.",
      "completeness",
    );
  const identities = new Map(
    source.solutions.map((s) => [copaSourceIdentity(s), s]),
  );
  if (identities.size !== source.solutions.length)
    throw new BrowserSearchError(
      "Copa returned ambiguous displayed flight identities.",
      "completeness",
    );
  const seen = new Set<string>();
  const renderedIds = await page
    .locator('[data-cy^="tripCard_"]')
    .evaluateAll((els) =>
      els.flatMap((e) => {
        const id = e.getAttribute("data-cy")?.match(/^tripCard_(\d+)$/)?.[1];
        return id === undefined ? [] : [id];
      }),
    );
  if (
    renderedIds.length !== source.solutions.length ||
    new Set(renderedIds).size !== renderedIds.length
  )
    throw new BrowserSearchError(
      "Copa's rendered itinerary identifiers could not be reconciled.",
      "completeness",
    );
  let displayedFares = 0;
  for (const i of renderedIds) {
    signal.throwIfAborted();
    const codes = await page
      .locator(`[data-cy="tripCard_${i}_codes"]`)
      .innerText();
    const text = await page.locator(`[data-cy="tripCard_${i}"]`).innerText();
    const identity = copaDisplayedIdentity(codes, text),
      s = identities.get(identity);
    if (!s || seen.has(identity))
      throw new BrowserSearchError(
        "Copa's displayed flights did not match all source itineraries.",
        "completeness",
        502,
        { row: i, identity },
      );
    seen.add(identity);
    for (const [letter, prefix] of [
      ["E", "economic"],
      ["B", "business"],
    ]) {
      const expected = s.offers.filter((o) =>
        o.fareFamily.code.startsWith(letter),
      );
      const cell = page.locator(`[data-cy="${prefix}_${i}"]`);
      if (!expected.length) {
        if (!/Sold Out/.test(await cell.innerText()))
          throw new BrowserSearchError(
            "Copa displayed a cabin missing from its source offers.",
            "completeness",
          );
        continue;
      }
      // Let the real page finish scrolling/reflow before clicking the fare.
      // Its animated card transition can otherwise replace the target mid-click.
      await cell.scrollIntoViewIfNeeded();
      await page.waitForTimeout(350);
      for (let attempt = 0; attempt < 3; attempt++) {
        await cell.click();
        await page.waitForTimeout(600);
        if (
          (await cell.getAttribute("aria-pressed")) === "true" &&
          (await page
            .locator(`[data-cy="${prefix}StandardFare"]:visible`)
            .count())
        )
          break;
      }
      const expectedQuotes = expected.map((o) => ({
        name: o.fareFamily.name,
        points: o.pricePerAdult.miles,
        taxes: o.pricePerAdult.taxes,
        currency: source.currency.code,
      }));
      // Capture the matched card set atomically. Reading again after a successful
      // wait can land between Copa's exit/entry animation frames.
      const snapshot = await page
        .waitForFunction(
          ({ prefix, quotes, id }) => {
            if (
              document
                .querySelector(`[data-cy="${prefix}_${id}"]`)
                ?.getAttribute("aria-pressed") !== "true"
            )
              return false;
            const cards = [
              ...document.querySelectorAll(
                `[data-cy="${prefix}SaverFare"],[data-cy="${prefix}StandardFare"]`,
              ),
            ].filter(
              (e) =>
                e.getClientRects().length &&
                getComputedStyle(e).visibility !== "hidden",
            );
            if (cards.length !== 2) return false;
            const visible = cards.map((e) => ({
              name:
                e.querySelector('[data-cy$="_title"]')?.textContent?.trim() ??
                "",
              points:
                e.querySelector('[data-cy$="_price"]')?.textContent?.trim() ??
                null,
              taxes:
                e.querySelector('[data-cy$="_taxes"]')?.textContent?.trim() ??
                null,
              perAdult:
                e
                  .querySelector('[data-cy$="_perAdult"]')
                  ?.textContent?.trim() ?? null,
              soldOut: /Sold Out/.test((e as HTMLElement).innerText),
            }));
            const actual = visible
              .flatMap((f) => {
                if (f.points === null) return f.soldOut ? [] : ["unsettled"];
                const points = f.points.match(/^([\d,]+)\s+miles$/),
                  taxes = f.taxes?.match(
                    /^\+\s*([\d,]+(?:\.\d+)?)\s+([A-Z]{3})$/,
                  );
                if (
                  !points ||
                  !taxes ||
                  f.perAdult !== "One way · Per adult" ||
                  f.soldOut
                )
                  return ["unsettled"];
                return [
                  `${f.name}:${Number(points[1].replaceAll(",", ""))}:${Number(taxes[1].replaceAll(",", ""))}:${taxes[2]}`,
                ];
              })
              .sort();
            return JSON.stringify(actual) ===
              JSON.stringify(
                quotes
                  .map((f) => `${f.name}:${f.points}:${f.taxes}:${f.currency}`)
                  .sort(),
              )
              ? visible
              : false;
          },
          { prefix, quotes: expectedQuotes, id: i },
          { timeout: 5000, polling: 100 },
        )
        .catch(() => {
          throw new BrowserSearchError(
            "Copa's expanded fare cards did not settle to the complete returned quotes.",
            "completeness",
            502,
            { row: i, cabin: prefix, displayedFares, expected: expectedQuotes },
          );
        });
      const visible = await snapshot.jsonValue();
      if (!visible)
        throw new BrowserSearchError(
          "Copa's fare snapshot was incomplete.",
          "completeness",
        );
      const normalized = visible
        .filter((f) => f.points !== null)
        .map((f) => {
          const points = f.points?.match(/^([\d,]+)\s+miles$/),
            taxes = f.taxes?.match(/^\+\s*([\d,]+(?:\.\d+)?)\s+([A-Z]{3})$/);
          if (
            !points ||
            !taxes ||
            f.perAdult !== "One way · Per adult" ||
            f.soldOut
          )
            throw new BrowserSearchError(
              "Copa's displayed fare amount or price basis changed.",
              "completeness",
            );
          return {
            name: f.name,
            points: Number(points[1].replaceAll(",", "")),
            taxes: Number(taxes[1].replaceAll(",", "")),
            currency: taxes[2],
          };
        });
      const canonical = (
        rows: {
          name: string;
          points: number;
          taxes: number;
          currency: string;
        }[],
      ) =>
        JSON.stringify(
          rows
            .map((f) => `${f.name}:${f.points}:${f.taxes}:${f.currency}`)
            .sort(),
        );
      if (
        visible.length !== 2 ||
        visible.some((f) => f.points === null && !f.soldOut) ||
        canonical(normalized) !==
          canonical(
            expected.map((o) => ({
              name: o.fareFamily.name,
              points: o.pricePerAdult.miles,
              taxes: o.pricePerAdult.taxes,
              currency: source.currency.code,
            })),
          )
      )
        throw new BrowserSearchError(
          "Copa's complete fare choices did not match the expanded airline cards.",
          "completeness",
          502,
          {
            itineraries: i,
            displayedFares,
            visible,
            normalized,
            expected: expected.map((o) => ({
              name: o.fareFamily.name,
              points: o.pricePerAdult.miles,
              taxes: o.pricePerAdult.taxes,
              currency: source.currency.code,
            })),
          },
        );
      displayedFares += normalized.length;
    }
  }
  if (displayedFares !== counts.fares)
    throw new BrowserSearchError(
      "Copa's fare reconciliation was incomplete.",
      "completeness",
    );
  if (
    (await page.locator('[data-cy^="generalCard_"]').count()) !==
    counts.itineraries
  )
    throw new BrowserSearchError(
      "Copa's displayed flight list changed during fare collection.",
      "completeness",
    );
  return { ...counts, displayedFares };
}
export class CopaBrowserRunner {
  constructor(
    private session: PersistentBrowserSession = createDesktopChromeSession(
      "copa",
    ),
  ) {}
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<CopaBrowserResult> {
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
        await submitCopaForm(page, q, signal);
        stage = "availability";
        const pending = page.waitForResponse(
          (r) => {
            const u = new URL(r.url());
            return (
              u.hostname === "api.copaair.com" &&
              u.pathname === "/ibe/booking/plan-redemptions" &&
              r.request().method() === "POST"
            );
          },
          { timeout: 55000 },
        );
        void pending.catch(() => {});
        await page.locator("#btn-search:visible").click();
        const response = await pending;
        const request = validateCopaRequest(
          response.request().postDataJSON(),
          q,
        );
        if (!response.ok())
          throw new BrowserSearchError(
            `Copa's native inventory returned HTTP ${response.status()}.`,
            "availability",
            response.status() === 429 ? 429 : 502,
          );
        const bytes = await response.body();
        if (bytes.byteLength > 16 * 1024 * 1024)
          throw new BrowserSearchError(
            "Copa's response exceeded the collection limit.",
            "availability",
          );
        const raw = JSON.parse(bytes.toString("utf8"));
        if (
          raw.errors ||
          raw[0]?.errors ||
          raw[0]?.hasMore ||
          raw[0]?.nextPage ||
          raw[0]?.pagination?.hasMore
        )
          throw new BrowserSearchError(
            "Copa returned an error or an unfinished inventory list.",
            "completeness",
          );
        const body = copaResponseSchema.safeParse(raw);
        if (!body.success)
          throw new BrowserSearchError(
            "Copa's flight or price format changed.",
            "parse",
          );
        const observedAt = new Date().toISOString(),
          payload = {
            type: "copa-miles" as const,
            request,
            response: body.data,
          };
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
          await mkdir("work/browser-probes", { recursive: true });
          await writeFile(
            "work/browser-probes/copa-candidate.json",
            JSON.stringify(payload, null, 2),
            { mode: 0o600 },
          );
        }
        const rows = parseCopa(payload, q, observedAt);
        stage = "completeness";
        const counts = await reconcileCopaPage(page, body.data, q, signal);
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
          await mkdir("work/browser-probes", { recursive: true });
          await writeFile(
            "work/browser-probes/copa-reconciliation.json",
            JSON.stringify({ query: q, counts }, null, 2),
            { mode: 0o600 },
          );
          await page.screenshot({
            path: "work/browser-probes/copa-reference.png",
          });
        }
        return {
          programId: "CM_CONNECTMILES",
          query: q,
          observedAt,
          complete: true,
          itineraryCount: rows.length,
          fareCount: counts.exactFares,
          payload,
          stages: [
            {
              stage: "points",
              status: 200,
              elapsedMs: Date.now() - started,
              itineraries: rows.length,
            },
          ],
        };
      } catch (e) {
        signal.throwIfAborted();
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
          const controls = await page
            .evaluate(() => ({
              selected: [
                ...document.querySelectorAll('[aria-pressed="true"]'),
              ].map((e) => e.getAttribute("data-cy")),
              cards: [...document.querySelectorAll("[data-cy]")]
                .filter((e) =>
                  /^(economic|business)(Standard|Saver)Fare$/.test(
                    e.getAttribute("data-cy") ?? "",
                  ),
                )
                .map((e) => ({
                  id: e.getAttribute("data-cy"),
                  rect: e.getBoundingClientRect().toJSON(),
                  visibility: getComputedStyle(e).visibility,
                  title: e.querySelector('[data-cy$="_title"]')?.textContent,
                  price: e.querySelector('[data-cy$="_price"]')?.textContent,
                  taxes: e.querySelector('[data-cy$="_taxes"]')?.textContent,
                  basis: e.querySelector('[data-cy$="_perAdult"]')?.textContent,
                })),
            }))
            .catch(() => null);
          await writeFile(
            "work/browser-probes/copa-controls.json",
            JSON.stringify(controls, null, 2),
            { mode: 0o600 },
          );
        }
        if (e instanceof BrowserSearchError) {
          if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
            await mkdir("work/browser-probes", { recursive: true });
            await writeFile(
              "work/browser-probes/copa-mismatch.json",
              JSON.stringify(
                { message: e.message, stage: e.stage, evidence: e.evidence },
                null,
                2,
              ),
              { mode: 0o600 },
            );
            await page
              .screenshot({ path: "work/browser-probes/copa-mismatch.png" })
              .catch(() => {});
          }
          throw e;
        }
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
          await mkdir("work/browser-probes", { recursive: true });
          await writeFile(
            "work/browser-probes/copa-failure.json",
            JSON.stringify(
              {
                stage,
                error:
                  e instanceof Error
                    ? e.message
                        .replace(/https?:\/\/\S+/g, "[url]")
                        .slice(0, 2000)
                    : "unknown",
                path: new URL(page.url()).pathname,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
        }
        if (e instanceof ProviderError)
          throw new BrowserSearchError(e.message, "parse");
        throw new BrowserSearchError(
          `Copa's browser search could not complete its ${stage} step.`,
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
