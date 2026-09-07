import { createCollectorPage, prepareCollectorPage } from "./background-page";
import type { Page, Response, Request } from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import type { SearchQuery } from "../src/lib/types";
import {
  parseUnited,
  unitedFlights,
  unitedResponseSchema,
  type UnitedFlight,
} from "../src/lib/award-search/united";
import { BrowserSearchError, type AmericanBrowserResult } from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";
export type UnitedBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "UA_MP";
};
const entry = "https://www.united.com/en/us/book-flight/united-award-travel";
const fail = (message: string, stage = "completeness"): never => {
  throw new BrowserSearchError(message, stage);
};
const clock = (h: string, m: string, ap: string) =>
  String((Number(h) % 12) + (ap === "PM" ? 12 : 0)).padStart(2, "0") + ":" + m;
export function unitedDisplayedKey(text: string) {
  const d = text.match(/Departing at (\d{1,2}):(\d{2})\s*(AM|PM)/),
    a = text.match(/Arriving at (\d{1,2}):(\d{2})\s*(AM|PM)/);
  const duration = text.match(
    /Duration (?:(\d+) hours?\s*(?:and\s*)?)?(?:(\d+) minutes?)?/,
  );
  if (!d || !a || !duration || (!duration[1] && !duration[2])) return null;
  return [
    clock(d[1], d[2], d[3]),
    clock(a[1], a[2], a[3]),
    Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0),
  ].join("|");
}
const sourceKey = (f: UnitedFlight) =>
  [
    f.DepartDateTime.slice(-5),
    (f.Connections.at(-1) ?? f).DestinationDateTime.slice(-5),
    f.TravelMinutesTotal,
  ].join("|");
export type UnitedVisibleRow = { text: string; fares: string[] };
export function reconcileUnitedRows(
  visible: UnitedVisibleRow[],
  flights: UnitedFlight[],
  mixed: boolean,
) {
  const columns = mixed ? [3, 103, 107, 109] : [3, 104, 108, 111];
  const byKey = new Map<string, UnitedFlight>();
  for (const f of flights) {
    const k = sourceKey(f);
    if (byKey.has(k))
      fail(
        "United’s displayed flight times are ambiguous; flight-level reconciliation is required.",
      );
    byKey.set(k, f);
  }
  if (visible.length !== flights.length)
    fail(
      "United’s displayed flight count does not match all returned batches.",
    );
  let checked = 0;
  const seen = new Set<string>();
  for (const row of visible) {
    const key = unitedDisplayedKey(row.text),
      f = key ? byKey.get(key) : undefined;
    if (!key || !f || seen.has(key))
      fail(
        "United’s displayed itinerary identities do not match its returned flights.",
      );
    seen.add(key!);
    const expected = f!.Products.filter((p) => columns.includes(p.ColumnId))
      .flatMap((p) => {
        const miles = p.Prices.find(
          (x) => x.Currency === "MILES" && x.PricingType === "Award",
        );
        if (!miles || miles.Amount <= 0) return [];
        const tax = p.Prices.find((x) => x.PricingType === "Tax");
        if (!tax || tax.Currency !== "USD")
          fail("United’s displayed tax currency has not been verified.");
        const cabin =
          p.ColumnId === 3
            ? "Economy"
            : p.ColumnId === 103 || p.ColumnId === 104
              ? "Premium Economy"
              : p.ColumnId === 109 || p.ColumnId === 111
                ? "First"
                : "Business";
        return [cabin + "|" + miles.Amount + "|" + tax!.Amount];
      })
      .sort();
    const actual = row.fares
      .map((text) => {
        const part = text.includes("Now")
          ? text.slice(text.lastIndexOf("Now"))
          : text;
        const points = [...part.matchAll(/([\d,.]+)(k)?\s*miles/g)].at(-1);
        const fees = [...part.matchAll(/\$([\d,]+(?:\.\d+)?)/g)].at(-1);
        const cabin = part.match(
          /Select fare for (Premium Economy|Economy|Business|First)/,
        )?.[1];
        if (!points || !fees || !cabin)
          fail("United’s displayed fare format could not be reconciled.");
        return (
          cabin +
          "|" +
          Math.round(
            Number(points![1].replaceAll(",", "")) * (points![2] ? 1000 : 1),
          ) +
          "|" +
          Number(fees![1].replaceAll(",", ""))
        );
      })
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      fail("United’s displayed cabin prices differ from its returned fares.");
    // When expanded during qualification, verify every actual flight number as well.
    const details = row.text.split("Flight segment details").slice(1);
    if (details.length) {
      const codes = details.map((s) =>
        s
          .match(/Flight number ([A-Z0-9]{2})\s*(\d{1,4})\./)
          ?.slice(1)
          .join(""),
      );
      if (
        JSON.stringify(codes) !==
        JSON.stringify(
          [f!, ...f!.Connections].map(
            (s) => s.MarketingCarrier + s.FlightNumber,
          ),
        )
      )
        fail(
          "United’s displayed flight numbers do not match its returned itinerary.",
        );
    }
    checked += actual.length;
  }
  return { itineraries: seen.size, displayedFares: checked };
}
export async function unitedVisibleRows(
  page: Page,
): Promise<UnitedVisibleRow[]> {
  return page
    .getByRole("row")
    .filter({ hasText: "Flight Information" })
    .evaluateAll((els) =>
      els.map((e) => ({
        text: e.textContent ?? "",
        fares: [...e.querySelectorAll("button")]
          .filter(
            (b) =>
              !!b.getClientRects().length &&
              /Select fare for/.test(b.innerText),
          )
          .map((b) => b.innerText),
      })),
    );
}
async function expandAll(page: Page) {
  const more = page.getByRole("button", {
    name: "Show all flights",
    exact: true,
  });
  if (await more.isVisible()) await more.click();
}
async function mixedMode(page: Page, mixed: boolean) {
  await page.getByRole("button", { name: /^Mixed Cabin(?:: Hide)?$/ }).click();
  const radio = page.getByRole("radio", {
    name: mixed ? "Show mixed cabin fares" : "Hide mixed cabin fares",
    exact: true,
  });
  if (!(await radio.isChecked())) {
    await radio.click({ noWaitAfter: true });
    await page
      .getByRole("dialog", { name: "Mixed cabin", exact: true })
      .waitFor({ state: "hidden" });
  } else {
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  await expandAll(page);
}
export async function reconcileUnitedPage(
  page: Page,
  value: unknown,
  q: SearchQuery,
) {
  await prepareCollectorPage(page);
  const { flights } = unitedFlights(value, q);
  await page.getByRole("button", { name: "Reset all", exact: true }).click();
  await mixedMode(page, true);
  const settled = async (mixed: boolean) => {
    let last: unknown;
    for (let n = 0; n < 32; n++) {
      try {
        await expandAll(page);
        return reconcileUnitedRows(
          await unitedVisibleRows(page),
          flights,
          mixed,
        );
      } catch (e) {
        last = e;
        await delay(250);
      }
    }
    throw last;
  };
  const all = await settled(true);
  await mixedMode(page, false);
  const unmixed = await settled(false);
  await mixedMode(page, true);
  await settled(true);
  return {
    itineraries: all.itineraries,
    defaultDisplayedFares: all.displayedFares,
    unmixedDisplayedFares: unmixed.displayedFares,
  };
}
export async function submitUnitedForm(page: Page, q: SearchQuery) {
  await page.goto(entry, { waitUntil: "load", timeout: 45000 });
  await prepareCollectorPage(page);
  await page.getByRole("tab", { name: "One-way", exact: true }).click();
  for (const [name, code] of [
    ["From departing city, airport name, or airport code.", q.origin],
    ["To destination city, airport name, or airport code.", q.dest],
  ]) {
    const input = page.getByRole("combobox", { name, exact: true });
    await input.fill("");
    await input.fill(code);
    const option = page.getByRole("button", {
      name: new RegExp("\\(" + code + "(?: - [^)]+)?\\)$"),
    });
    await option.waitFor({ timeout: 15000 });
    if ((await option.count()) !== 1)
      fail("United’s airport choice is ambiguous.", "form");
    await option.click();
    if (!(await input.inputValue()).includes(code))
      fail("United’s selected airport could not be confirmed.", "form");
  }
  const [year, month, day] = q.departDate.split("-");
  const date = page.getByRole("textbox", { name: "Departure", exact: true });
  await date.fill(month + "/" + day + "/" + year);
  await date.press("Tab");
  const party = page.getByRole("button", { name: /^\d+ Adults?$/ });
  await party.click();
  const travelerDialog = page.getByRole("dialog").last();
  // Signed-in accounts can preselect saved people in addition to these generic counters.
  // Search for the requested anonymous party, without sending saved traveler profiles.
  const savedTravelers = travelerDialog.getByRole("checkbox");
  for (let i = 0; i < (await savedTravelers.count()); i++)
    if (await savedTravelers.nth(i).isChecked())
      await savedTravelers.nth(i).uncheck();
  for (const [label, buttonName, target] of [
    ["Children (2 - 17)", "Children (2 - 17)", 0],
    ["Infants on lap (Under 2)", "Infants on lap", 0],
    ["Infants in seat (Under 2)", "Infants in seat", 0],
    ["Adults (18+)", "Adults (18+)", q.pax],
  ] as const) {
    const input = page.getByRole("textbox", { name: label, exact: true });
    const current = Number(await input.inputValue());
    if (!Number.isInteger(current) || current < 0 || current > 9)
      fail("United’s traveler form changed.", "form");
    for (let n = 0; n < Math.abs(current - target); n++)
      await page
        .getByRole("button", {
          name:
            (current < target ? "Increase" : "Decrease") +
            " number of " +
            buttonName +
            " by 1",
          exact: true,
        })
        .click();
    if (Number(await input.inputValue()) !== target)
      fail("United’s traveler selection changed.", "form");
  }
  const apply = travelerDialog.getByText("Apply", { exact: true });
  if (await apply.isVisible()) await apply.click();
  else
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  await page
    .getByRole("button", {
      name: `${q.pax} Adult${q.pax === 1 ? "" : "s"}`,
      exact: true,
    })
    .waitFor();
  for (const name of ["Nonstop only", "Flexible dates"]) {
    const checkbox = page.getByRole("checkbox", { name, exact: true });
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  for (const name of ["Economy", "All airlines"]) {
    const radio = page.getByRole("radio", { name, exact: true });
    if (!(await radio.isChecked())) await radio.check();
  }
  const shownDate = (await date.inputValue()).trim();
  const shortDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(q.departDate + "T12:00:00Z"));
  if (![month + "/" + day + "/" + year, shortDate].includes(shownDate))
    fail("United’s departure date changed before submission.", "form");
  await page.getByRole("button", { name: "Find flights", exact: true }).click();
}
const inventory = (url: string) => {
  const u = new URL(url);
  return (
    u.hostname === "www.united.com" &&
    /^\/api\/flight\/(FetchFlights|FetchSSENestedFlights)$/i.test(u.pathname)
  );
};
export class UnitedBrowserRunner {
  constructor(
    private session: PersistentBrowserSession = createDesktopChromeSession(
      "united",
    ),
  ) {}
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<UnitedBrowserResult> {
    const started = Date.now();
    return this.session.run(signal, async (context) => {
      // Keep one operator-owned tab. This also preserves a normal sign-in form
      // when verification is needed instead of closing it and forcing a new challenge.
      const page =
        context.pages().find((p) => {
          try {
            return new URL(p.url()).hostname === "www.united.com";
          } catch {
            return false;
          }
        }) ?? (await createCollectorPage(context));
      page.setDefaultTimeout(15000);
      const abort = () => {
        void page.close().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      const responses: ReturnType<typeof unitedResponseSchema.parse>[] = [];
      const pending = new Set<Promise<void>>(),
        inflight = new Set<Request>();
      let error: string | null = null,
        lastInventory = 0;
      const request = (r: Request) => {
        if (inventory(r.url())) {
          inflight.add(r);
          lastInventory = Date.now();
        }
      };
      const finished = (r: Request) => {
        inflight.delete(r);
      };
      const failed = (r: Request) => {
        if (inventory(r.url())) {
          error = "United’s flight inventory request did not finish.";
          inflight.delete(r);
        }
      };
      const response = (r: Response) => {
        if (!inventory(r.url())) return;
        const task = (async () => {
          if (!r.ok()) {
            error =
              "United’s flight inventory returned HTTP " + r.status() + ".";
            return;
          }
          const bytes = await r.body();
          if (bytes.length > 24 * 1024 * 1024) {
            error = "United’s flight response exceeded the collection limit.";
            return;
          }
          const parsed = unitedResponseSchema.safeParse(
            JSON.parse(bytes.toString("utf8")),
          );
          if (!parsed.success) {
            error = "United’s returned flight, cabin or stop format changed.";
            return;
          }
          responses.push(parsed.data);
          lastInventory = Date.now();
        })()
          .catch(() => {
            error = "United’s flight response could not be read.";
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      };
      page.on("request", request);
      page.on("requestfinished", finished);
      page.on("requestfailed", failed);
      page.on("response", response);
      try {
        await prepareCollectorPage(page);
        if (
          await page
            .locator("#MPIDEmailField:visible,input[type=password]:visible")
            .count()
        )
          throw new BrowserSearchError(
            "United’s operator session requires sign-in or verification. No customer account connection is needed.",
            "auth_required",
            503,
          );
        await submitUnitedForm(page, q);
        const deadline = Date.now() + 75000;
        while (Date.now() < deadline) {
          signal.throwIfAborted();
          const gate = await page
            .locator("#MPIDEmailField:visible,input[type=password]:visible")
            .count();
          if (gate)
            throw new BrowserSearchError(
              "United’s operator session requires sign-in or verification. No customer account connection is needed.",
              "auth_required",
              503,
            );
          if (error) fail(error, "availability");
          if (
            responses.length &&
            pending.size === 0 &&
            inflight.size === 0 &&
            Date.now() - lastInventory >= 10000 &&
            (await page
              .getByRole("row")
              .filter({ hasText: "Flight Information" })
              .count())
          )
            break;
          await delay(250, undefined, { signal });
        }
        if (
          !responses.length ||
          pending.size ||
          inflight.size ||
          Date.now() - lastInventory < 10000
        )
          fail(
            "United’s award inventory did not finish loading.",
            "availability",
          );
        const payload = {
          type: "united-member-awards" as const,
          query: {
            origin: q.origin,
            dest: q.dest,
            departDate: q.departDate,
            pax: q.pax,
          },
          responses,
          accountPricing: true as const,
        };
        const observedAt = new Date().toISOString(),
          rows = parseUnited(payload, q, observedAt);
        await reconcileUnitedPage(page, payload, q);
        if (error) fail(error, "availability");
        if (pending.size || inflight.size)
          fail(
            "United’s inventory changed during verification.",
            "availability",
          );
        return {
          programId: "UA_MP",
          query: q,
          observedAt,
          complete: true,
          itineraryCount: rows.length,
          fareCount: rows.reduce((n, r) => n + r.fares!.length, 0),
          payload,
          stages: [
            {
              stage: "member-awards",
              status: 200,
              elapsedMs: Date.now() - started,
              itineraries: rows.length,
            },
          ],
        };
      } catch (e) {
        signal.throwIfAborted();
        if (e instanceof BrowserSearchError) throw e;
        const failure = new BrowserSearchError(
          "United’s member award search could not be completed.",
          "collector",
        );
        failure.cause = e;
        throw failure;
      } finally {
        page.off("request", request);
        page.off("requestfinished", finished);
        page.off("requestfailed", failed);
        page.off("response", response);
        signal.removeEventListener("abort", abort);
        await Promise.allSettled(pending);
      }
    });
  }
  close() {
    return this.session.close();
  }
}
