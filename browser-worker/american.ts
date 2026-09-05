import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { parseAmerican } from "../src/lib/award-search/american";
import type { SearchQuery } from "../src/lib/types";

export type BrowserStage = {
  stage: string;
  elapsedMs: number;
  status?: number;
  path?: string;
};
export class BrowserSearchError extends Error {
  constructor(
    message: string,
    public stage: string,
    public status = 502,
    public evidence: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function americanPayload(state: unknown): unknown {
  const data =
    state && typeof state === "object"
      ? (state as Record<string, unknown>).SearchData
      : null;
  const candidate =
    data && typeof data === "object"
      ? (data as Record<string, unknown>).itineraryResult
      : null;
  if (!candidate || typeof candidate !== "object")
    throw new BrowserSearchError(
      "American did not supply flight data.",
      "results",
    );
  const p = candidate as Record<string, unknown>;
  // Exclude the surrounding page state, search session, analytics and accounts.
  const allowed = [
    "error",
    "responseMetadata",
    "slices",
    "totalCount",
    "hasMore",
    "nextPage",
    "nextCursor",
    "continuationToken",
  ];
  const result = Object.fromEntries(
    allowed.filter((key) => key in p).map((key) => [key, p[key]]),
  );
  if (p.responseMetadata && typeof p.responseMetadata === "object") {
    const meta = p.responseMetadata as Record<string, unknown>;
    const fields = [
      "searchType",
      "tripType",
      "roundTrip",
      "sliceCount",
      "pricedSliceIndex",
      "origin",
      "destination",
      "departureDate",
      "cached",
      "totalCount",
      "hasMore",
      "nextPage",
      "nextCursor",
      "continuationToken",
    ];
    result.responseMetadata = Object.fromEntries(
      fields.filter((key) => key in meta).map((key) => [key, meta[key]]),
    );
  }
  return result;
}

export interface AmericanBrowserResult {
  programId: "AA_AADVANTAGE";
  query: SearchQuery;
  complete: true;
  observedAt: string;
  payload: unknown;
  itineraryCount: number;
  fareCount: number;
  stages: BrowserStage[];
}

export class AmericanBrowserRunner {
  private browserPromise?: Promise<Browser>;
  constructor(
    private options: {
      channel?: string;
      headless?: boolean;
      entry?: "homepage" | "direct";
      engine?: "chromium" | "firefox" | "webkit";
    } = {},
  ) {}

  private async browser(): Promise<Browser> {
    const engine = this.options.engine ?? "chromium";
    this.browserPromise ??= { chromium, firefox, webkit }[engine]
      .launch({
        ...(engine === "chromium"
          ? {
              channel: this.options.channel ?? "chromium",
              chromiumSandbox: true,
            }
          : {}),
        headless: this.options.headless ?? true,
        timeout: 30000,
      })
      .catch((error) => {
        this.browserPromise = undefined;
        throw error;
      });
    const browser = await this.browserPromise;
    if (!browser.isConnected()) {
      this.browserPromise = undefined;
      throw new BrowserSearchError(
        "The browser process disconnected before the search.",
        "launch",
        503,
      );
    }
    return browser;
  }

  async close() {
    const pending = this.browserPromise;
    this.browserPromise = undefined;
    await pending?.then((browser) => browser.close()).catch(() => {});
  }

  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<AmericanBrowserResult> {
    const started = Date.now(),
      stages: BrowserStage[] = [];
    let stage = "launch";
    const mark = (next: string) => {
      stage = next;
      stages.push({ stage, elapsedMs: Date.now() - started });
    };
    let context: BrowserContext | undefined, page: Page | undefined;
    const abort = () => {
      void context?.close().catch(() => {});
    };
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const browser = await this.browser();
      signal.throwIfAborted();
      // Every request gets a fresh anonymous context. No personal browser profile,
      // imported login state, stealth patches or verification-cookie transport.
      context = await browser.newContext({ locale: "en-US" });
      signal.throwIfAborted();
      context.setDefaultTimeout(15000);
      page = await context.newPage();
      page.on("response", (response) => {
        if (!response.request().isNavigationRequest()) return;
        const url = new URL(response.url());
        if (url.hostname === "www.aa.com")
          stages.push({
            stage: "document",
            elapsedMs: Date.now() - started,
            path: url.pathname,
            status: response.status(),
          });
      });
      const homepage = this.options.entry !== "direct";
      mark(homepage ? "homepage" : "booking-form");
      const entryResponse = await page.goto(
        homepage
          ? "https://www.aa.com/"
          : "https://www.aa.com/booking/search/find-flights",
        {
          waitUntil: "domcontentloaded",
          timeout: 40000,
        },
      );
      if (entryResponse && entryResponse.status() >= 400)
        throw new BrowserSearchError(
          "American did not accept the browser entry request.",
          stage,
          503,
        );
      if (homepage) {
        // Follow the airline's own published link so redirects and ordinary
        // session initialization happen in the same anonymous browser.
        await page.locator("#advBookingSearch").click();
        mark("booking-form");
      }
      await page.locator("#trip-type").waitFor({ state: "visible" });
      mark("route-and-passengers");
      await page.locator("#trip-type").click();
      await page.getByRole("option", { name: "One way", exact: true }).click();
      for (const [input, checkbox, code] of [
        ["matOriginAirport", "origin-nearby-airports", q.origin],
        ["matDestinationAirport", "destination-nearby-airports", q.dest],
      ]) {
        await page.locator(`#${input}`).fill(code);
        if (await page.locator(`#${checkbox}`).isChecked())
          await page.locator(`label[for="${checkbox}"]`).click();
        await page
          .getByRole("option", { name: new RegExp(`^${code} -`) })
          .click();
        if ((await page.locator(`#${input}`).inputValue()) !== code)
          throw new BrowserSearchError(
            "American did not accept the requested airport.",
            stage,
          );
      }
      const [year, month, day] = q.departDate.split("-");
      await page
        .locator("#matOneWayDatePicker")
        .fill(`${month}/${day}/${year}`);
      await page.locator("#matOneWayDatePicker").press("Tab");
      await page.locator("#passenger-count").selectOption(String(q.pax));
      if (!(await page.locator("#redeem-miles").isChecked()))
        await page.locator("label[for='redeem-miles']").click();
      await page.locator("#cabin").selectOption("SHOW_ALL");
      await page.locator("#carriers").selectOption("ALL");
      mark("submit-search");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.waitForURL(/\/booking\/choose-flights\/1(?:\?|$)/, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      mark("read-flight-response");
      const data = page.locator("script#ng-state");
      await data.waitFor({ state: "attached", timeout: 10000 });
      const raw = await data.textContent();
      if (!raw || raw.length > 16000000)
        throw new BrowserSearchError(
          "American returned an unreadable flight response.",
          stage,
        );
      const payload = americanPayload(JSON.parse(raw)),
        observedAt = new Date().toISOString();
      const rows = parseAmerican(payload, q, observedAt);
      mark("validated-complete-response");
      return {
        programId: "AA_AADVANTAGE",
        query: q,
        complete: true,
        observedAt,
        payload,
        itineraryCount: rows.length,
        fareCount: rows.reduce((n, row) => n + (row.fares?.length ?? 0), 0),
        stages,
      };
    } catch (error) {
      const title = (await page?.title().catch(() => "")) ?? "";
      const excerpt =
        (await page
          ?.locator("body")
          .innerText({ timeout: 1000 })
          .then((body) => body.slice(0, 1600))
          .catch(() => "")) ?? "";
      const verification =
        /challenge validation|verify you are|access denied|pardon our interruption|unusual traffic|captcha/i.test(
          `${title} ${excerpt}`,
        );
      const evidence = {
        stages,
        title: title.slice(0, 200),
        path: page ? new URL(page.url()).pathname : undefined,
        verification,
        errorType: error instanceof Error ? error.name : "UnknownError",
        launchIssue:
          stage === "launch" && error instanceof Error
            ? /sandbox/i.test(error.message)
              ? "sandbox-unavailable"
              : /executable.*doesn.t exist|browser.*not found/i.test(
                    error.message,
                  )
                ? "browser-not-installed"
                : "browser-launch-failed"
            : undefined,
      };
      // Raw browser errors can contain session-bearing URLs; keep them private.
      if (signal.aborted)
        throw new BrowserSearchError(
          "The American browser search was cancelled or timed out.",
          stage,
          504,
          evidence,
        );
      if (verification)
        throw new BrowserSearchError(
          "American requested browser verification. This search could not complete automatically.",
          stage,
          503,
          evidence,
        );
      if (error instanceof BrowserSearchError)
        throw new BrowserSearchError(
          error.message,
          error.stage,
          error.status,
          evidence,
        );
      throw new BrowserSearchError(
        `American's browser search could not complete at ${stage}. No availability was inferred.`,
        stage,
        502,
        evidence,
      );
    } finally {
      signal.removeEventListener("abort", abort);
      await context?.close().catch(() => {});
    }
  }
}
