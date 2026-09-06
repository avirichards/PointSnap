import { mkdir, writeFile } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { z } from "zod";
import type { SearchQuery } from "../src/lib/types";
import { southwestBookingUrl } from "../src/lib/bookingHandoff";
import {
  parseSouthwest,
  southwestPayloadSchema,
  southwestResponseSchema,
  southwestObservationCounts,
  validateSouthwestRequest,
  SOUTHWEST_FAMILIES,
} from "../src/lib/award-search/southwest";
import { ProviderError } from "../src/lib/award-search/types";
import {
  BrowserSearchError,
  type AmericanBrowserResult,
  type BrowserStage,
} from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";

export type SouthwestBrowserResult = Omit<
  AmericanBrowserResult,
  "programId"
> & { programId: "WN_RAPID_REWARDS" };
type Payload = z.infer<typeof southwestPayloadSchema>;
export class SouthwestBrowserRunner {
  constructor(
    private session: PersistentBrowserSession = createDesktopChromeSession(
      "southwest",
    ),
  ) {}
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<SouthwestBrowserResult> {
    const started = Date.now(),
      stages: BrowserStage[] = [];
    return this.session.run(signal, async (context) => {
      const points = await this.collect(context, q, signal, "POINTS");
      stages.push({
        stage: "points",
        status: 200,
        elapsedMs: Date.now() - started,
        itineraries: southwestObservationCounts(points.response).itineraries,
      });
      let cash: Payload["cash"];
      try {
        cash = await this.collect(context, q, signal, "USD");
        // A malformed cash comparison must not discard a validated award list.
        parseSouthwest(
          { type: "southwest-points-cash", points, cash },
          q,
          points.observedAt,
        );
        stages.push({
          stage: "cash",
          status: 200,
          elapsedMs: Date.now() - started,
          itineraries: southwestObservationCounts(cash.response).itineraries,
        });
      } catch {
        signal.throwIfAborted();
        cash = undefined;
        stages.push({
          stage: "cash-unavailable",
          elapsedMs: Date.now() - started,
        });
      }
      const payload: Payload = {
        type: "southwest-points-cash",
        points,
        ...(cash ? { cash } : {}),
      };
      const rows = parseSouthwest(payload, q, points.observedAt);
      return {
        programId: "WN_RAPID_REWARDS",
        query: q,
        observedAt: points.observedAt,
        complete: true,
        itineraryCount: rows.length,
        fareCount: rows.reduce((n, r) => n + r.fares!.length, 0),
        stages,
        payload,
      };
    });
  }
  private async collect(
    context: BrowserContext,
    q: SearchQuery,
    signal: AbortSignal,
    currency: "POINTS" | "USD",
  ): Promise<Payload["points"]> {
    signal.throwIfAborted();
    const page = await context.newPage();
    const abort = () => {
      void page.close().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await page.bringToFront();
      const pending = page.waitForResponse(
        (r) => {
          const url = new URL(r.url());
          return (
            url.hostname === "www.southwest.com" &&
            url.pathname ===
              "/api/air-booking/v1/air-booking/page/air/booking/shopping" &&
            r.request().method() === "POST"
          );
        },
        { timeout: currency === "POINTS" ? 45000 : 25000 },
      );
      void pending.catch(() => {});
      await page.goto(southwestBookingUrl(q, currency), {
        waitUntil: "domcontentloaded",
        timeout: 40000,
      });
      const response = await pending;
      if (!response.ok())
        throw new BrowserSearchError(
          `Southwest’s ${currency === "POINTS" ? "award" : "cash"} search returned HTTP ${response.status()}.`,
          "availability",
          response.status() === 429 ? 429 : 502,
        );
      const request = validateSouthwestRequest(
        response.request().postDataJSON(),
        q,
        currency,
      );
      const body = await response.body();
      if (body.byteLength > 16 * 1024 * 1024)
        throw new BrowserSearchError(
          "Southwest’s response exceeded the collection limit.",
          "availability",
        );
      const raw = JSON.parse(body.toString("utf8"));
      if (
        raw.errors?.length ||
        raw.links?.next ||
        raw.meta?.hasMore ||
        raw.meta?.nextPage
      )
        throw new BrowserSearchError(
          "Southwest returned an error or an unfinished flight list.",
          "completeness",
        );
      const parsed = southwestResponseSchema.safeParse(raw);
      if (!parsed.success)
        throw new BrowserSearchError(
          "Southwest’s flight or fare response changed; complete results could not be read.",
          "parse",
        );
      const counts = southwestObservationCounts(parsed.data);
      await page.waitForFunction(
        (n) =>
          document.querySelectorAll(
            'button[aria-label^="Information for flight number"]',
          ).length === n,
        counts.itineraries,
        { timeout: 20000 },
      );
      if (
        (await page.locator("button.fare-button--button").count()) !==
        counts.choices
      )
        throw new BrowserSearchError(
          "Southwest’s rendered fare choices did not match its response.",
          "completeness",
        );
      if (
        !(await page.getByText("Log in", { exact: true }).first().isVisible())
      )
        throw new BrowserSearchError(
          "Southwest’s anonymous search state could not be confirmed.",
          "session",
        );
      if (currency === "POINTS") {
        const labels = await page
          .locator('button[aria-label*="fare "][aria-label*="PTS"]')
          .evaluateAll((els) =>
            els.map((e) => e.getAttribute("aria-label") ?? ""),
          );
        if (labels.length !== counts.fares)
          throw new BrowserSearchError(
            "Southwest’s displayed points fares did not match its available offers.",
            "completeness",
          );
        for (const [family, name] of Object.entries(SOUTHWEST_FAMILIES)) {
          const expected =
            parsed.data.data.searchResults.airProducts[0].details.filter(
              (d) =>
                d.fareProducts.ADULT[family + "RED"]?.availabilityStatus ===
                "AVAILABLE",
            ).length;
          if (
            labels.filter((l) => l.startsWith(name + " fare ")).length !==
            expected
          )
            throw new BrowserSearchError(
              "Southwest’s fare-family labels changed.",
              "parse",
            );
        }
      }
      if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
        await mkdir("work/browser-probes", { recursive: true });
        await writeFile(
          `work/browser-probes/southwest-${currency}-reference.txt`,
          await page.locator("body").innerText(),
          { mode: 0o600 },
        );
        await page.screenshot({
          path: `work/browser-probes/southwest-${currency}-reference.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
      return {
        request,
        response: parsed.data,
        observedAt: new Date().toISOString(),
      };
    } catch (e) {
      signal.throwIfAborted();
      if (e instanceof BrowserSearchError) throw e;
      if (e instanceof ProviderError)
        throw new BrowserSearchError(e.message, "parse");
      throw new BrowserSearchError(
        "Southwest’s anonymous search could not finish. No partial flight list was substituted.",
        "browser",
      );
    } finally {
      signal.removeEventListener("abort", abort);
      await page.close().catch(() => {});
    }
  }
  close() {
    return this.session.close();
  }
}
