import { createCollectorPage, prepareCollectorPage } from "./background-page";
import { setTimeout as delay } from "node:timers/promises";
import type { Page, Request, Response } from "playwright";
import {
  parseVirginNative,
  virginBookingUrl,
  virginFlights,
  virginMinutes,
  virginPayloadSchema,
  type VirginPayload,
} from "../src/lib/award-search/virgin-native";
import type { SearchQuery } from "../src/lib/types";
import { BrowserSearchError, type AmericanBrowserResult } from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";

export type VirginBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "VS_FLYING_CLUB";
};
export interface VirginVisibleCard {
  text: string;
  clocks: string[];
  fareButtons: { text: string; disabled: boolean }[];
}
const compact = (s: string) => s.replace(/\s+/g, " ").trim();
const fail = (message: string, stage = "reconcile"): never => {
  throw new BrowserSearchError(message, stage, 503);
};
const fareNames = {
  "AWARD-ECONOMY": "Economy Classic",
  "AWARD-COMFORT-PLUS-PREMIUM-ECONOMY": "Premium",
  "AWARD-BUSINESS-FIRST": "Upper Class",
};
const dateLabel = (s: string) =>
  new Date(s.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
export function reconcileVirginCards(
  cards: VirginVisibleCard[],
  payload: VirginPayload,
  q: SearchQuery,
  countText: string,
) {
  const fs = virginFlights(payload, q).result.slice.flightsAndFares;
  const count = countText.match(/Showing\s+(\d+)\s+of\s+(\d+)\s+flights/i);
  if (
    !count ||
    Number(count[1]) !== fs.length ||
    Number(count[2]) !== fs.length ||
    cards.length !== fs.length
  )
    fail(
      "Virgin’s displayed result count does not match its complete flight response.",
    );
  const remaining = new Set(fs);
  for (const card of cards) {
    const text = compact(card.text);
    const matches = [...remaining].filter((f) => {
      const n = virginMinutes(f.flight.duration);
      const dominant = f.flight.segments.find((s) => s.legs[0].isDominantLeg);
      return (
        card.clocks.join("|") ===
          [
            f.flight.departure.slice(11, 16),
            f.flight.arrival.slice(11, 16),
          ].join("|") &&
        text.includes(`${Math.floor(n / 60)}h ${n % 60}m`) &&
        !!dominant &&
        text.includes(dominant.flightNumber)
      );
    });
    if (matches.length !== 1)
      fail("Virgin’s displayed itinerary could not be uniquely matched.");
    const f = matches[0];
    remaining.delete(f);
    if (
      !text.includes(dateLabel(f.flight.departure)) ||
      !text.includes(dateLabel(f.flight.arrival)) ||
      !text.includes(
        `One way for ${q.pax} ${q.pax === 1 ? "person" : "people"}`,
      ) ||
      !text.includes(q.origin) ||
      !text.includes(q.dest) ||
      !text.includes(
        f.flight.segments.length === 1
          ? "Direct"
          : `${f.flight.segments.length - 1} change`,
      )
    )
      fail(
        "Virgin’s visible route, local dates, stops or passenger count changed.",
      );
    if (card.fareButtons.length !== f.fares.length)
      fail("Virgin’s displayed cabin count is incomplete.");
    for (const fare of f.fares) {
      const fareName =
        fare.fareSegments?.find((s) => s.isDominantLeg)?.cabinName ??
        fareNames[fare.fareFamilyType];
      const buttons = card.fareButtons.filter((b) =>
        compact(b.text).startsWith(fareName),
      );
      if (buttons.length !== 1)
        fail("Virgin’s cabin fare could not be matched.");
      const b = buttons[0],
        label = compact(b.text);
      if (fare.availability === "SOLD_OUT") {
        if (!b.disabled || !label.includes("Not available"))
          fail("Virgin’s sold-out cabin disagrees with the response.");
      } else {
        const p = fare.price!;
        // Native cards round the entire party's cash charge UP to whole USD.
        // Keep the exact source cents in PointSnap, not this rounded display.
        if (p.currency !== "USD")
          fail(
            "Virgin’s display currency needs an additional validated reconciliation rule.",
          );
        const expected = `${fareName} ${Number(p.awardPoints).toLocaleString("en-US")} +US$${Math.ceil(p.amountIncludingTax).toLocaleString("en-US")}`;
        if (b.disabled || label.replace(/\+\s+/g, "+") !== expected)
          fail(
            "Virgin’s displayed points or fees do not match its returned fare.",
          );
      }
    }
  }
  if (remaining.size) fail("Virgin did not display every returned flight.");
}
export async function virginVisibleCards(
  page: Page,
): Promise<VirginVisibleCard[]> {
  return page.locator("main article").evaluateAll((elements) =>
    elements
      .filter((e) => (e as HTMLElement).innerText.includes("Flight details"))
      .map((e) => ({
        text: (e as HTMLElement).innerText,
        clocks: [...e.querySelectorAll("h5")].map(
          (h) => h.textContent?.trim() || "",
        ),
        fareButtons: [...e.querySelectorAll("button")]
          .filter((b) =>
            /^(Economy Classic|Economy Standard|Main Cabin|Premium|Upper Class|First Class)/.test(
              b.innerText.trim(),
            ),
          )
          .map((b) => ({ text: b.innerText, disabled: b.disabled })),
      })),
  );
}
function isSearch(r: Request) {
  const u = new URL(r.url());
  if (
    u.hostname !== "www.virginatlantic.com" ||
    u.pathname !== "/flights/search/api/graphql"
  )
    return false;
  try {
    return !!r.postDataJSON()?.variables?.request?.flightSearchRequest;
  } catch {
    return false;
  }
}
export class VirginBrowserRunner {
  constructor(
    private session: Pick<
      PersistentBrowserSession,
      "run" | "close"
    > = createDesktopChromeSession("virgin-atlantic"),
  ) {}
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<VirginBrowserResult> {
    const started = Date.now();
    return this.session.run(signal, async (context) => {
      const page =
        context
          .pages()
          .find((p) =>
            /virginatlantic\.com$/.test(new URL(p.url()).hostname),
          ) ?? (await createCollectorPage(context));
      page.setDefaultTimeout(12000);
      const inflight = new Set<Request>(),
        pending = new Set<Promise<void>>();
      let payload: VirginPayload | undefined,
        lastInventory = 0,
        error: string | undefined;
      const request = (r: Request) => {
        if (isSearch(r)) {
          inflight.add(r);
          lastInventory = Date.now();
        }
      };
      const finished = (r: Request) => inflight.delete(r);
      const failed = (r: Request) => {
        if (isSearch(r)) {
          inflight.delete(r);
          error = "Virgin’s inventory request did not finish.";
        }
      };
      const response = (r: Response) => {
        if (!isSearch(r.request())) return;
        const task = (async () => {
          if (!r.ok()) {
            error = `Virgin’s flight inventory returned HTTP ${r.status()}.`;
            return;
          }
          const bytes = await r.body();
          if (bytes.length > 24 * 1024 * 1024) {
            error = "Virgin’s inventory exceeded the validated size limit.";
            return;
          }
          const raw = JSON.parse(bytes.toString("utf8"));
          if (raw.errors?.length || !raw.data?.searchOffers?.result) {
            error = "Virgin returned a flight-search error.";
            return;
          }
          const parsed = virginPayloadSchema.safeParse({
            type: "virgin-member-awards",
            request: r.request().postDataJSON().variables.request,
            result: raw.data.searchOffers.result,
          });
          if (!parsed.success) {
            error = "Virgin’s returned flight, cabin or fare format changed.";
            return;
          }
          virginFlights(parsed.data, q);
          payload = parsed.data;
          lastInventory = Date.now();
        })()
          .catch(() => {
            error = "Virgin’s award response could not be fully validated.";
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      };
      const abort = () => {
        void page.close().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      page.on("request", request);
      page.on("requestfinished", finished);
      page.on("requestfailed", failed);
      page.on("response", response);
      try {
        // This is the actual public search URL produced by Virgin's booking form.
        // The browser keeps its own member session and follows all normal redirects.
        await prepareCollectorPage(page);
        // Preserve an operator's in-progress verification. A customer search
        // must not navigate away from it and cause another login/code challenge.
        if (
          new URL(page.url()).hostname === "identity.virginatlantic.com" ||
          (await page.locator("input[type=password]:visible").count())
        )
          fail(
            "Virgin’s operator session needs sign-in or verification. Customers do not need to connect an airline account to search.",
            "auth_required",
          );
        const document = await page.goto(virginBookingUrl(q), {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        if (document && document.status() >= 400)
          fail(
            `Virgin’s booking page returned HTTP ${document.status()}.`,
            "entry",
          );
        const deadline = Date.now() + 65000;
        while (Date.now() < deadline) {
          signal.throwIfAborted();
          if (
            new URL(page.url()).hostname === "identity.virginatlantic.com" ||
            (await page.locator("input[type=password]:visible").count())
          )
            fail(
              "Virgin’s operator session needs sign-in or verification. Customers do not need to connect an airline account to search.",
              "auth_required",
            );
          if (error) fail(error, "availability");
          if (
            payload &&
            !inflight.size &&
            !pending.size &&
            Date.now() - lastInventory >= 1500 &&
            (await page.getByRole("main").innerText()).match(
              /Showing\s+\d+\s+of\s+\d+\s+flights/i,
            )
          )
            break;
          await delay(250, undefined, { signal });
        }
        const confirmed = payload;
        if (!confirmed || inflight.size || pending.size)
          throw new BrowserSearchError(
            "Virgin’s award inventory did not finish loading.",
            "availability",
          );
        const observedAt = new Date().toISOString();
        reconcileVirginCards(
          await virginVisibleCards(page),
          confirmed,
          q,
          await page.getByRole("main").innerText(),
        );
        if (error || inflight.size || pending.size || payload !== confirmed)
          fail(
            error || "Virgin’s inventory changed during verification.",
            "availability",
          );
        const rows = parseVirginNative(confirmed, q, observedAt);
        return {
          programId: "VS_FLYING_CLUB",
          query: q,
          observedAt,
          payload: confirmed,
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
        throw new BrowserSearchError(
          "Virgin’s native member award search could not be completed.",
          "collector",
        );
      } finally {
        signal.removeEventListener("abort", abort);
        page.off("request", request);
        page.off("requestfinished", finished);
        page.off("requestfailed", failed);
        page.off("response", response);
        await Promise.allSettled([...pending]);
      }
    });
  }
  close() {
    return this.session.close();
  }
}
