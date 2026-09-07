import type { Page, Response } from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import type { SearchQuery } from "../src/lib/types";
import {
  parseQatarNative,
  compactQatarPayload,
  qatarBookingUrl,
  validateQatarFlights,
  validateQatarRequest,
  type QatarFlight,
  type QatarPayload,
} from "../src/lib/award-search/qatar-native";
import { BrowserSearchError, type AmericanBrowserResult } from "./american";
import { createCollectorPage, prepareCollectorPage } from "./background-page";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";
import { ProviderError } from "../src/lib/award-search/types";

export type QatarBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "QR_PRIVILEGE";
};
const compact = (s: string) => s.replace(/\s+/g, " ").trim();
const fail = (message: string, stage = "reconcile", status = 503): never => {
  throw new BrowserSearchError(message, stage, status);
};
const signInRequired = () =>
  fail(
    "Qatar’s operator session needs sign-in or verification before award searches can resume.",
    "session",
    428,
  );
export function qatarNeedsSignIn(url: string, text: string) {
  return (
    /\/(?:login|u\/login)(?:[/.?]|$)/i.test(new URL(url).pathname) ||
    /you have been logged out|please log in again/i.test(text)
  );
}
async function checkSession(page: Page) {
  const text = await page.locator("body").innerText();
  if (qatarNeedsSignIn(page.url(), text)) signInRequired();
}

/** Watch both the native response and Qatar's explicit expired-session dialog. */
async function requestCabin(
  page: Page,
  q: SearchQuery,
  cabin: "E" | "B",
  signal: AbortSignal,
): Promise<Response> {
  let response: Response | undefined;
  const capture = (r: Response) => {
    const u = new URL(r.url());
    if (
      u.hostname === "www.qatarairways.com" &&
      u.pathname === "/dapi/public/bff/web/flight-search/award-flight-offers" &&
      r.request().method() === "POST"
    )
      response = r;
  };
  page.on("response", capture);
  const deadline = Date.now() + 80000;
  try {
    await page.goto(qatarBookingUrl(q, cabin), {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    while (!response && Date.now() < deadline) {
      signal.throwIfAborted();
      await checkSession(page);
      if (!response) await delay(500, undefined, { signal });
    }
    signal.throwIfAborted();
    return (
      response ??
      fail(
        "Qatar did not return its award inventory before the search deadline.",
        "availability",
      )
    );
  } finally {
    page.off("response", capture);
  }
}
export function qatarScopeFlights(
  flights: QatarFlight[],
  scope: "ECONOMY" | "PREMIUM",
) {
  const cabins =
    scope === "ECONOMY" ? ["ECONOMY", "BUSINESS"] : ["BUSINESS", "FIRST"];
  return flights.filter((f) =>
    f.fareOffers.some((a) => cabins.includes(a.cabinType)),
  );
}
export function reconcileQatarCard(
  text: string,
  details: string,
  flight: QatarFlight,
  scope: "ECONOMY" | "PREMIUM",
) {
  const body = compact(text),
    detail = compact(details),
    first = flight.segments[0],
    last = flight.segments.at(-1)!,
    duration = body.match(/\b(\d+)h(?:\s+(\d+)m)?\b/);
  if (
    !body.includes(first.departure.dateTime.slice(11, 16)) ||
    !body.includes(last.arrival.dateTime.slice(11, 16)) ||
    !body.includes(first.departure.origin.iataCode) ||
    !body.includes(last.arrival.destination.iataCode) ||
    !duration ||
    Number(duration[1]) * 60 + Number(duration[2] ?? 0) !==
      flight.duration / 60 ||
    flight.segments.some(
      (s) => !new RegExp(`\\b${s.flightNumber}\\b`).test(detail),
    )
  )
    fail("Qatar’s visible flight details do not match the native itinerary.");
  const cabins =
    scope === "ECONOMY" ? ["ECONOMY", "BUSINESS"] : ["BUSINESS", "FIRST"];
  for (const cabin of cabins) {
    const fares = flight.fareOffers.filter((a) => a.cabinType === cabin),
      label = cabin[0] + cabin.slice(1).toLowerCase();
    if (fares.length) {
      const price = Math.min(...fares.map((a) => a.price.base)).toLocaleString(
        "en-US",
      );
      if (!body.includes(`${label} ${price} Avios`))
        fail("Qatar’s displayed cabin price does not match its native quote.");
    } else if (!body.includes(`${label} Not available`))
      fail("Qatar’s displayed cabin availability changed.");
  }
}
async function reconcile(
  page: Page,
  flights: QatarFlight[],
  q: SearchQuery,
  scope: "ECONOMY" | "PREMIUM",
) {
  const expected = qatarScopeFlights(flights, scope);
  if (!expected.length) {
    await page.waitForURL(
      /\/app\/booking\/(?:award-calendar|redemption)(?:\?|$)/,
      { timeout: 25000 },
    );
    const u = new URL(page.url());
    if (
      u.searchParams.get("fromStation") !== q.origin ||
      u.searchParams.get("toStation") !== q.dest ||
      u.searchParams.get("departing") !== q.departDate ||
      u.searchParams.get("adults") !== String(q.pax)
    )
      fail("Qatar’s empty cabin response changed the requested search.");
    return;
  }
  const cards = page.locator(".flight-result-card");
  await cards.nth(expected.length - 1).waitFor({ timeout: 30000 });
  const countText = await page.locator("body").innerText();
  if (
    (await cards.count()) !== expected.length ||
    !new RegExp(`\\b${expected.length} results?\\b`).test(countText) ||
    !countText.includes(`${q.pax} passenger`)
  )
    fail(
      "Qatar’s visible result count or passenger count does not match its native response.",
    );
  const remaining = new Set(expected);
  for (let i = 0; i < expected.length; i++) {
    const card = cards.nth(i),
      text = await card.innerText();
    await card.locator("a.flight-card__footer__cta__wrap__link").click();
    const close = page.locator("icon.close-icon:visible");
    await close.waitFor();
    const detail = await close.evaluate(
      (e) =>
        (e.closest(".side-sheet-container") as HTMLElement | null)?.innerText ??
        (e.closest("section") as HTMLElement | null)?.innerText ??
        "",
    );
    const matches = [...remaining].filter((f) =>
      f.segments.every((s) =>
        new RegExp(`\\b${s.flightNumber}\\b`).test(detail),
      ),
    );
    if (matches.length !== 1)
      fail("Qatar’s expanded flight details could not be uniquely matched.");
    reconcileQatarCard(text, detail, matches[0], scope);
    remaining.delete(matches[0]);
    await close.press("Enter");
    await close.waitFor({ state: "hidden" });
  }
}

/** Reuse only the app-owned member profile; operator sign-in remains separate. */
export class QatarBrowserRunner {
  constructor(
    private session: Pick<
      PersistentBrowserSession,
      "run" | "close"
    > = createDesktopChromeSession("qatar"),
  ) {}
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<QatarBrowserResult> {
    const started = Date.now();
    return this.session
      .run<QatarBrowserResult>(signal, async (context) => {
        const page = context.pages()[0] ?? (await createCollectorPage(context));
        page.setDefaultTimeout(15000);
        await prepareCollectorPage(page);
        await checkSession(page);
        const abort = () => {
          void page.close().catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
          const searches: QatarPayload["searches"] = [];
          for (const [cabin, scope] of [
            ["E", "ECONOMY"],
            ["B", "PREMIUM"],
          ] as const) {
            signal.throwIfAborted();
            const response = await requestCabin(page, q, cabin, signal);
            signal.throwIfAborted();
            if (!response.ok())
              fail(
                `Qatar’s award request returned HTTP ${response.status()}.`,
                "availability",
                [401, 403].includes(response.status())
                  ? 428
                  : response.status() === 429
                    ? 429
                    : 503,
              );
            const request = validateQatarRequest(
              response.request().postDataJSON(),
              q,
              scope,
            );
            const buffer = await response.body();
            if (buffer.byteLength > 16 * 1024 * 1024)
              fail(
                "Qatar’s native response exceeded the collection limit.",
                "availability",
              );
            const raw = JSON.parse(buffer.toString("utf8"));
            if (
              raw.errors?.length ||
              raw.links?.next ||
              raw.meta?.hasMore ||
              raw.meta?.nextPage
            )
              fail(
                "Qatar returned an error or an unfinished inventory page.",
                "completeness",
              );
            const data = validateQatarFlights(raw, q);
            await reconcile(page, data.flightOffers, q, scope);
            searches.push({ request, response: data });
          }
          const observedAt = new Date().toISOString(),
            payload: QatarPayload = {
              type: "qatar-native-cabin-searches",
              searches,
            };
          const rows = parseQatarNative(payload, q, observedAt);
          return {
            programId: "QR_PRIVILEGE",
            query: q,
            complete: true,
            observedAt,
            itineraryCount: rows.length,
            fareCount: rows.reduce((n, r) => n + (r.fares?.length ?? 0), 0),
            payload: compactQatarPayload(payload),
            stages: [
              {
                stage: "qatar-native-cabin-searches",
                elapsedMs: Date.now() - started,
              },
            ],
          };
        } finally {
          signal.removeEventListener("abort", abort);
        }
      })
      .catch((error: unknown) => {
        signal.throwIfAborted();
        if (error instanceof ProviderError)
          fail(error.message, "parse", error.status);
        throw error;
      });
  }
  close() {
    return this.session.close();
  }
}
