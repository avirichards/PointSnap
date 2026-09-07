import { setTimeout as delay } from "node:timers/promises";
import type { Locator, Request, Response } from "playwright";
import {
  flyingBlueBase,
  flyingBlueBookingUrl,
  flyingBlueExpandedSchema,
  flyingBlueFlightKey,
  flyingBlueFlights,
  parseFlyingBlueNative,
  type FlyingBlueExpanded,
  type FlyingBlueItinerary,
  type FlyingBluePayload,
} from "../src/lib/award-search/flying-blue-native";
import type { SearchQuery } from "../src/lib/types";
import { BrowserSearchError, type AmericanBrowserResult } from "./american";
import { createCollectorPage, prepareCollectorPage } from "./background-page";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";

export type FlyingBlueBrowserResult = Omit<
  AmericanBrowserResult,
  "programId"
> & { programId: "AF_FLYINGBLUE" };
export interface FlyingBlueVisibleCard {
  text: string;
  clocks: string[];
  tabs: { label: string; text: string }[];
}
const compact = (s: string) => s.replace(/\s+/g, " ").trim();
function fail(message: string, stage = "reconcile"): never {
  throw new BrowserSearchError(message, stage, 503);
}
export function reconcileFlyingBlueCard(
  card: FlyingBlueVisibleCard,
  flight: FlyingBlueItinerary,
  q: SearchQuery,
) {
  const c = flight.activeConnection,
    first = c.segments[0],
    last = c.segments.at(-1)!;
  const text = compact(card.text);
  if (
    card.clocks.join("|") !==
      [
        first.departureDateTime.slice(11, 16),
        last.arrivalDateTime.slice(11, 16),
      ].join("|") ||
    !text.includes(q.origin) ||
    !text.includes(q.dest) ||
    !text.includes(
      `${Math.floor(c.duration / 60)}h${String(c.duration % 60).padStart(2, "0")}`,
    ) ||
    card.tabs.length !== flight.upsellCabinProducts.length
  )
    fail(
      "Flying Blue’s visible schedule or cabin count disagrees with its inventory.",
    );
  for (const {
    connections: [fare],
  } of flight.upsellCabinProducts) {
    const matches = card.tabs.filter((t) =>
      t.label.includes(`in ${fare.cabinClass} Class for flight `),
    );
    if (matches.length !== 1)
      fail("Flying Blue’s displayed cabin could not be uniquely matched.");
    const label = compact(matches[0].text);
    if (fare.price.amount === null) {
      if (!/not available/i.test(label) || /\d[\d,]* Miles/.test(label))
        fail("Flying Blue’s unavailable cabin disagrees with its inventory.");
    } else if (
      !label.includes(`${fare.price.amount.toLocaleString("en-US")} Miles`) ||
      !label.includes(`Price for ${q.pax} passenger`)
    )
      fail("Flying Blue’s displayed points or passenger total changed.");
  }
}
export function reconcileFlyingBlueFareHeadings(
  headings: string[],
  expanded: FlyingBlueExpanded,
  cabin: string,
) {
  const fares = expanded.upsellRecommendations
    .flatMap((r) => r.upsellFlightProducts)
    .filter((f) => f.activeConnectionUpsell.commercialCabin === cabin);
  const expected = fares
    .map((f) => {
      const a = f.activeConnectionUpsell;
      return compact(
        `${a.fareFamily.title} ${a.price.relevantPrice.toLocaleString("en-US")} Miles +${a.taxDetails.currency} ${a.taxDetails.relevantPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      ).replace(/\+([A-Z]{3})\s*/g, "+$1");
    })
    .sort();
  const actual = headings
    .map((h) => compact(h).replace(/\+\s*([A-Z]{3})\s*/g, "+$1"))
    .sort();
  if (!expected.length || JSON.stringify(actual) !== JSON.stringify(expected))
    fail(
      "Flying Blue’s expanded fare prices or exact fees do not match its returned choices.",
    );
}
export async function flyingBlueVisibleCard(
  card: Locator,
): Promise<FlyingBlueVisibleCard> {
  return {
    text: await card.innerText(),
    clocks: await card.locator("time").allTextContents(),
    tabs: await card
      .getByRole("tab")
      .evaluateAll((es) =>
        es.map((e) => ({
          label: e.getAttribute("aria-label") || "",
          text: e.textContent || "",
        })),
      ),
  };
}
function operation(r: Request): string | undefined {
  try {
    const u = new URL(r.url());
    if (u.hostname === "www.klm.com" && u.pathname === "/gql/v1")
      return r.postDataJSON()?.operationName;
  } catch {
    /* Not a recognized native inventory request. */
  }
}
async function responseBody(r: Response) {
  if (!r.ok())
    fail(
      `Flying Blue’s flight inventory returned HTTP ${r.status()}.`,
      "availability",
    );
  const b = await r.body();
  if (b.length > 24 * 1024 * 1024)
    fail(
      "Flying Blue’s response exceeded the validated size limit.",
      "availability",
    );
  const value = JSON.parse(b.toString("utf8"));
  if (value.errors?.length)
    fail("Flying Blue returned a flight-search error.", "availability");
  return value.data;
}
export class FlyingBlueBrowserRunner {
  constructor(
    private session: Pick<
      PersistentBrowserSession,
      "run" | "close"
    > = createDesktopChromeSession("flying-blue"),
  ) {}
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<FlyingBlueBrowserResult> {
    const started = Date.now();
    return this.session.run(signal, async (context) => {
      const page =
        context
          .pages()
          .find((p) => new URL(p.url()).hostname === "www.klm.com") ??
        (await createCollectorPage(context));
      page.setDefaultTimeout(12000);
      const pending = new Set<Promise<void>>();
      let base: ReturnType<typeof flyingBlueBase> | undefined,
        error: string | undefined,
        changedAt = 0;
      const response = (r: Response) => {
        if (operation(r.request()) !== "SearchResultAvailableOffersQuery")
          return;
        const task = (async () => {
          const data = await responseBody(r);
          base = flyingBlueBase(
            {
              type: "flying-blue-member-awards",
              request: r.request().postDataJSON().variables,
              result: data.availableOffers,
            },
            q,
          );
          changedAt = Date.now();
        })()
          .catch((e) => {
            error =
              e instanceof BrowserSearchError
                ? e.message
                : "Flying Blue’s returned route, flight or fare format could not be validated.";
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      };
      const aborted = () => {
        void page.close().catch(() => {});
      };
      page.on("response", response);
      signal.addEventListener("abort", aborted, { once: true });
      try {
        await prepareCollectorPage(page);
        const document = await page.goto(flyingBlueBookingUrl(q), {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await prepareCollectorPage(page);
        if (document && document.status() >= 400)
          fail(
            `Flying Blue’s booking page returned HTTP ${document.status()}.`,
            "entry",
          );
        const deadline = Date.now() + 55000;
        while (Date.now() < deadline) {
          signal.throwIfAborted();
          if (
            /login|authentication/i.test(new URL(page.url()).pathname) ||
            /login|auth\./i.test(new URL(page.url()).hostname) ||
            (await page.locator("input[type=password]:visible").count())
          )
            fail(
              "Flying Blue’s operator session needs sign-in or verification. Customers do not need to connect an airline account to search.",
              "auth_required",
            );
          if (error) fail(error, "availability");
          if (
            base &&
            !pending.size &&
            Date.now() - changedAt >= 1200 &&
            (await page.locator("bwsfc-flight-offer").count()) ===
              base.result.offerItineraries.length &&
            (await page
              .locator("bwsfc-flight-offer")
              .first()
              .getByRole("tab")
              .first()
              .isVisible())
          )
            break;
          await delay(200, undefined, { signal });
        }
        const confirmed = base;
        if (!confirmed || pending.size)
          fail(
            "Flying Blue’s award inventory did not finish loading.",
            "availability",
          );
        const cards = page.locator("bwsfc-flight-offer");
        const direct = confirmed.result.offerItineraries.filter(
            (f) => f.activeConnection.isDirect,
          ).length,
          connecting = confirmed.result.offerItineraries.length - direct;
        const headings = (await page.locator("h2").allTextContents()).map(
          compact,
        );
        if (
          (await cards.count()) !== confirmed.result.offerItineraries.length ||
          (direct && !headings.includes(`Direct flights (${direct})`)) ||
          (connecting &&
            !headings.includes(`Connecting flights (${connecting})`))
        )
          fail(
            "Flying Blue’s complete displayed flight count could not be confirmed.",
          );
        const expanded: FlyingBlueExpanded[] = [],
          remaining = new Map(
            confirmed.result.offerItineraries.map((f) => [
              flyingBlueFlightKey(f.activeConnection),
              f,
            ]),
          );
        for (let index = 0; index < (await cards.count()); index++) {
          signal.throwIfAborted();
          const card = cards.nth(index),
            visible = await flyingBlueVisibleCard(card);
          const tabs = card.getByRole("tab").filter({ hasText: "Miles" });
          if (!(await tabs.count()))
            fail(
              "Flying Blue listed a flight without a qualified available fare.",
            );
          const resultPromise = page.waitForResponse(
            (r) => operation(r.request()) === "SearchUpsellOffersQuery",
            { timeout: 25000 },
          );
          void resultPromise.catch(() => {});
          await tabs.first().press("Enter");
          const r = await resultPromise,
            data = await responseBody(r);
          const e = flyingBlueExpandedSchema.parse(data.upsellOffers);
          if (e.upsellRecommendations.length !== 1)
            fail(
              "Flying Blue returned an unqualified multi-itinerary fare expansion.",
            );
          const f = remaining.get(
            flyingBlueFlightKey(
              e.upsellRecommendations[0].activeFlightConnection,
            ),
          );
          if (!f)
            fail(
              "Flying Blue’s expanded flight did not match the remaining inventory.",
            );
          reconcileFlyingBlueCard(visible, f, q);
          for (const {
            connections: [fare],
          } of f.upsellCabinProducts) {
            if (fare.price.amount === null) continue;
            const tab = card.getByRole("tab", {
              name: `Learn more about the available fares in ${fare.cabinClass} Class for flight ${index + 1}.`,
              exact: true,
            });
            if ((await tab.getAttribute("aria-selected")) !== "true")
              await tab.press("Enter");
            await waitForFares(card, e, fare.cabinClass, signal);
          }
          expanded.push(e);
          remaining.delete(flyingBlueFlightKey(f.activeConnection));
        }
        if (remaining.size || error || pending.size || base !== confirmed)
          fail(
            error ||
              "Flying Blue’s inventory changed during fare verification.",
            "availability",
          );
        const payload: FlyingBluePayload = { ...confirmed, expanded };
        flyingBlueFlights(payload, q);
        const observedAt = new Date().toISOString(),
          rows = parseFlyingBlueNative(payload, q, observedAt);
        return {
          programId: "AF_FLYINGBLUE",
          query: q,
          observedAt,
          payload,
          complete: true,
          itineraryCount: rows.length,
          fareCount: rows.reduce((n, r) => n + (r.fares?.length ?? 0), 0),
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
          "Flying Blue’s native member award search could not be completed.",
          "collector",
        );
        failure.cause = e;
        throw failure;
      } finally {
        page.off("response", response);
        signal.removeEventListener("abort", aborted);
        await Promise.allSettled([...pending]);
      }
    });
  }
  close() {
    return this.session.close();
  }
}
async function waitForFares(
  card: Locator,
  expanded: FlyingBlueExpanded,
  cabin: string,
  signal: AbortSignal,
) {
  const deadline = Date.now() + 12000;
  let last: unknown;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      reconcileFlyingBlueFareHeadings(
        await card
          .locator("h3:visible")
          .filter({ hasText: "Miles" })
          .allTextContents(),
        expanded,
        cabin,
      );
      return;
    } catch (e) {
      last = e;
    }
    await delay(150, undefined, { signal });
  }
  throw last;
}
