import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from "playwright";
import { parseAmerican } from "../src/lib/award-search/american";
import type { SearchQuery } from "../src/lib/types";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { PersistentBrowserSession } from "./persistent-session";

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
  private persistentSession?: PersistentBrowserSession;
  private persistentPage?: Page;
  constructor(
    private options: {
      channel?: string;
      headless?: boolean;
      entry?: "homepage" | "direct" | "homepage-form";
      engine?: "chromium" | "firefox" | "webkit";
      temporaryProfile?: boolean;
      persistentProfile?: boolean;
    } = {},
    session?: PersistentBrowserSession,
  ) {
    if (session && (options.temporaryProfile || options.persistentProfile))
      throw new Error(
        "An injected session must own its own profile lifecycle.",
      );
    this.persistentSession = session;
    if (options.temporaryProfile && options.persistentProfile)
      throw new Error(
        "Choose either a temporary or persistent American profile.",
      );
    if (options.persistentProfile) {
      this.persistentSession = new PersistentBrowserSession(async () => {
        const engine = this.options.engine ?? "chromium";
        const channel = this.options.channel ?? "chromium";
        // Fixed app-owned location; never accept a personal-profile path.
        const profile = resolve(
          "work/browser-profiles",
          `american-persistent-${engine}-${channel.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        );
        await mkdir(profile, { recursive: true, mode: 0o700 });
        await chmod(profile, 0o700);
        return { chromium, firefox, webkit }[engine].launchPersistentContext(
          profile,
          {
            ...(engine === "chromium"
              ? { channel, chromiumSandbox: true }
              : {}),
            headless: this.options.headless ?? true,
            locale: "en-US",
            timeout: 30000,
          },
        );
      });
    }
  }

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
    await this.persistentSession?.close();
    const pending = this.browserPromise;
    this.browserPromise = undefined;
    await pending?.then((browser) => browser.close()).catch(() => {});
  }

  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<AmericanBrowserResult> {
    if (!this.persistentSession) return this.searchInContext(q, signal);
    try {
      return await this.persistentSession.run(signal, (context) =>
        this.searchInContext(q, signal, context),
      );
    } catch (error) {
      if (error instanceof BrowserSearchError) throw error;
      throw new BrowserSearchError(
        signal.aborted
          ? "The American browser search was cancelled or timed out."
          : "The dedicated American browser profile could not open or was closed.",
        signal.aborted ? "profile-queue" : "launch",
        signal.aborted ? 504 : 503,
        {
          persistentProfile: true,
          errorType: error instanceof Error ? error.name : "UnknownError",
        },
      );
    }
  }

  private async searchInContext(
    q: SearchQuery,
    signal: AbortSignal,
    persistentContext?: BrowserContext,
  ): Promise<AmericanBrowserResult> {
    const started = Date.now(),
      stages: BrowserStage[] = [];
    let stage = "launch";
    const mark = (next: string) => {
      stage = next;
      stages.push({ stage, elapsedMs: Date.now() - started });
    };
    let context: BrowserContext | undefined = persistentContext,
      page: Page | undefined,
      profile: string | undefined;
    const abort = () => {
      if (persistentContext) void page?.close().catch(() => {});
      else void context?.close().catch(() => {});
    };
    let onResponse: ((response: Response) => void) | undefined;
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    try {
      // Only this worker's anonymous state is reused. No personal profile,
      // imported login state or verification-cookie transport is accepted.
      if (persistentContext) {
        mark("dedicated-profile-ready");
      } else if (this.options.temporaryProfile) {
        const directory = resolve("work/browser-profiles");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        profile = await mkdtemp(resolve(directory, "american-"));
        const engine = this.options.engine ?? "chromium";
        context = await { chromium, firefox, webkit }[
          engine
        ].launchPersistentContext(profile, {
          ...(engine === "chromium"
            ? {
                channel: this.options.channel ?? "chromium",
                chromiumSandbox: true,
              }
            : {}),
          headless: this.options.headless ?? true,
          locale: "en-US",
          timeout: 30000,
        });
      } else {
        const browser = await this.browser();
        signal.throwIfAborted();
        context = await browser.newContext({ locale: "en-US" });
      }
      signal.throwIfAborted();
      if (!context)
        throw new BrowserSearchError("The browser did not open.", "launch");
      context.setDefaultTimeout(15000);
      page =
        persistentContext &&
        this.persistentPage &&
        !this.persistentPage.isClosed()
          ? this.persistentPage
          : await context.newPage();
      if (persistentContext) this.persistentPage = page;
      signal.throwIfAborted();
      onResponse = (response: Response) => {
        if (!response.request().isNavigationRequest()) return;
        const url = new URL(response.url());
        if (url.hostname === "www.aa.com")
          stages.push({
            stage: "document",
            elapsedMs: Date.now() - started,
            path: url.pathname,
            status: response.status(),
          });
      };
      page.on("response", onResponse);
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
      const [year, month, day] = q.departDate.split("-");
      if (this.options.entry === "homepage-form") {
        mark("homepage-route-and-passengers");
        for (const id of [
          "flightSearchForm.tripType.oneWay",
          "flightSearchForm.tripType.redeemMiles",
        ]) {
          const label = page.locator(`label[for="${id}"]:visible`);
          await label.waitFor({ state: "visible" });
          if (!(await page.locator(`[id="${id}"]`).isChecked()))
            await label.click();
        }
        for (const [id, code] of [
          ["originAirport", q.origin],
          ["destinationAirport", q.dest],
        ]) {
          const input = page.locator(
            `[id="reservationFlightSearchForm.${id}"]:visible`,
          );
          await input.fill(code);
          await input.press("Tab");
          if ((await input.inputValue()) !== code)
            throw new BrowserSearchError(
              "American did not accept the requested airport.",
              stage,
            );
        }
        await page
          .locator(
            '[id="flightSearchForm.adultOrSeniorPassengerCount"]:visible',
          )
          .selectOption(String(q.pax));
        await page
          .locator("#aa-leavingOn:visible")
          .fill(`${month}/${day}/${year}`);
        await page.locator("#aa-leavingOn:visible").press("Tab");
      } else {
        if (homepage) {
          // Follow the airline's own published link so redirects and ordinary
          // session initialization happen in the same anonymous browser.
          await page.locator("#advBookingSearch").click();
          mark("booking-form");
        }
        await page.locator("#trip-type").waitFor({ state: "visible" });
        mark("route-and-passengers");
        await page.locator("#trip-type").click();
        await page
          .getByRole("option", { name: "One way", exact: true })
          .click();
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
        await page
          .locator("#matOneWayDatePicker")
          .fill(`${month}/${day}/${year}`);
        await page.locator("#matOneWayDatePicker").press("Tab");
        await page.locator("#passenger-count").selectOption(String(q.pax));
        if (!(await page.locator("#redeem-miles").isChecked()))
          await page.locator("label[for='redeem-miles']").click();
        await page.locator("#cabin").selectOption("SHOW_ALL");
        await page.locator("#carriers").selectOption("ALL");
      }
      mark("submit-search");
      // The airline can show its ordinary cookie notice after the form loads.
      // Its panel covers Search in a desktop window; dismiss it through the UI.
      const cookieNotice = page.getByRole("button", {
        name: "Dismiss",
        exact: true,
      });
      if (await cookieNotice.isVisible()) await cookieNotice.click();
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
      if (page && onResponse) page.off("response", onResponse);
      if (persistentContext) {
        if (signal.aborted) await page?.close().catch(() => {});
      } else await context?.close().catch(() => {});
      if (profile) await rm(profile, { recursive: true, force: true });
    }
  }
}
