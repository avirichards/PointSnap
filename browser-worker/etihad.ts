import { createCollectorPage, prepareCollectorPage } from "./background-page";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import type { SearchQuery } from "../src/lib/types";
import {
  etihadBookingUrl,
  etihadResponseSchema,
  etihadPayloadSchema,
  parseEtihad,
} from "../src/lib/award-search/etihad";
import { ProviderError } from "../src/lib/award-search/types";
import {
  BrowserSearchError,
  type AmericanBrowserResult,
  type BrowserStage,
} from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";

export type EtihadBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "EY_GUEST";
};
const requestSchema = z.object({
  commercialFareFamilies: z.array(z.string()),
  itineraries: z
    .array(
      z.object({
        originLocationCode: z.string(),
        destinationLocationCode: z.string(),
        departureDateTime: z.string(),
        isRequestedBound: z.literal(true),
      }),
    )
    .length(1),
  travelers: z.array(z.object({ passengerTypeCode: z.literal("ADT") })),
  searchPreferences: z.object({
    showMilesPrice: z.literal(true),
    showSoldOut: z.literal(true),
    maxFlightCombinationsPerBound: z.number().int().positive(),
  }),
});

export function validateEtihadRequest(
  value: unknown,
  q: SearchQuery,
  cabins: string[],
) {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success)
    throw new BrowserSearchError(
      "Etihad did not request a complete anonymous award search.",
      "request",
    );
  const r = parsed.data,
    itinerary = r.itineraries[0];
  if (
    r.commercialFareFamilies.join(",") !== cabins.join(",") ||
    r.travelers.length !== q.pax ||
    itinerary.originLocationCode !== q.origin ||
    itinerary.destinationLocationCode !== q.dest ||
    itinerary.departureDateTime !== q.departDate + "T00:00:00.000"
  )
    throw new BrowserSearchError(
      "Etihad requested a different route, date, party or cabin.",
      "request",
    );
  return r.searchPreferences.maxFlightCombinationsPerBound;
}

/** Submit the ordinary public AWARD entry in an isolated app-owned browser. */
export class EtihadBrowserRunner {
  constructor(
    private session: PersistentBrowserSession = createDesktopChromeSession(
      "etihad",
    ),
  ) {}
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<EtihadBrowserResult> {
    const started = Date.now(),
      stages: BrowserStage[] = [];
    return this.session.run(signal, async (context) => {
      const page = await createCollectorPage(context);
      page.setDefaultTimeout(15000);
      const abort = () => {
        void page.close().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        const searches: z.infer<typeof etihadPayloadSchema>["searches"] = [];
        for (const [cabin, cabins] of [
          ["E", ["ECONOMY", "BUSINESS"]],
          ["B", ["BUSINESS", "FIRST"]],
        ] as const) {
          signal.throwIfAborted();
          await prepareCollectorPage(page);
          const responsePromise = page.waitForResponse(
            (r) => {
              const u = new URL(r.url());
              return (
                u.hostname === "api-des.etihad.com" &&
                u.pathname === "/airlines/EY/v2/search/air-bounds" &&
                r.request().method() === "POST"
              );
            },
            { timeout: 70000 },
          );
          // Attach a rejection handler immediately if navigation itself fails.
          void responsePromise.catch(() => {});
          await page.goto(etihadBookingUrl(q, cabin), {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          const response = await responsePromise;
          if (!response.ok())
            throw new BrowserSearchError(
              `Etihad's award request returned HTTP ${response.status()}.`,
              "availability",
              response.status() === 429 ? 429 : 502,
            );
          const limit = validateEtihadRequest(
            response.request().postDataJSON(),
            q,
            [...cabins],
          );
          const body = await response.body();
          if (body.byteLength > 16 * 1024 * 1024)
            throw new BrowserSearchError(
              "Etihad's award response exceeded the collection limit.",
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
              "Etihad returned an error or an unfinished results page.",
              "availability",
            );
          const decoded = etihadResponseSchema.safeParse(raw);
          if (
            !decoded.success &&
            process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1"
          ) {
            await mkdir("work/browser-probes", { recursive: true });
            await writeFile(
              "work/browser-probes/etihad-flight-shape.json",
              JSON.stringify(
                {
                  flights: raw.dictionaries?.flight,
                  aircraft: raw.dictionaries?.aircraft,
                },
                null,
                2,
              ),
              { mode: 0o600 },
            );
          }
          if (!decoded.success)
            throw new BrowserSearchError(
              "Etihad's flight or fare response changed; complete results could not be read.",
              "parse",
              502,
              {
                issues: decoded.error.issues
                  .slice(0, 8)
                  .map((i) => ({ path: i.path, code: i.code })),
              },
            );
          const data = decoded.data;
          if (data.data.airBoundGroups.length >= limit)
            throw new BrowserSearchError(
              "Etihad reached its itinerary limit; additional flight combinations may be missing.",
              "completeness",
            );
          await page
            .getByText("Values are displayed in miles", { exact: true })
            .waitFor({ timeout: 25000 });
          if (
            !(await page
              .getByRole("button", { name: "Log in", exact: true })
              .isVisible())
          )
            throw new BrowserSearchError(
              "Etihad's anonymous search state could not be confirmed.",
              "session",
            );
          const expected = data.data.airBoundGroups.filter((g) =>
            g.airBounds.some((f) =>
              f.availabilityDetails.every(
                (a) => a.quota >= q.pax && a.statusCode === "HK",
              ),
            ),
          ).length;
          if (expected)
            await page
              .getByRole("button", { name: "Details", exact: true })
              .first()
              .waitFor();
          for (let clicks = 0; clicks < 100; clicks++) {
            const details = page.getByRole("button", {
              name: "Details",
              exact: true,
            });
            const count = await details.count();
            if (count === expected) break;
            const more = page.getByRole("button", {
              name: "Show more flights",
              exact: true,
            });
            if (!(await more.isVisible())) break;
            await more.click();
            await details.nth(count).waitFor();
          }
          if (
            (await page
              .getByRole("button", { name: "Details", exact: true })
              .count()) !== expected ||
            (await page
              .getByRole("button", { name: "Show more flights", exact: true })
              .isVisible())
          )
            throw new BrowserSearchError(
              "Etihad's displayed flight list did not match the collected inventory.",
              "completeness",
            );
          if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
            await mkdir("work/browser-probes", { recursive: true });
            await writeFile(
              `work/browser-probes/etihad-${cabin}-reference.txt`,
              await page.locator("body").innerText(),
              { mode: 0o600 },
            );
            await page.screenshot({
              path: `work/browser-probes/etihad-${cabin}-reference.png`,
              fullPage: true,
            });
          }
          searches.push({ cabins: [...cabins], limit, response: data });
          stages.push({
            stage: `${cabin}-awards`,
            status: response.status(),
            elapsedMs: Date.now() - started,
            itineraries: expected,
          });
        }
        const payload = { type: "etihad-cabin-searches" as const, searches };
        const observedAt = new Date().toISOString(),
          rows = parseEtihad(payload, q, observedAt);
        return {
          programId: "EY_GUEST",
          query: q,
          complete: true,
          observedAt,
          payload,
          itineraryCount: rows.length,
          fareCount: rows.reduce((n, r) => n + r.fares!.length, 0),
          stages,
        };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof BrowserSearchError) throw error;
        if (error instanceof ProviderError)
          throw new BrowserSearchError(error.message, "parse");
        // Browser exception stacks may include request headers; never forward them.
        throw new BrowserSearchError(
          "Etihad's anonymous search could not finish. No partial flight list was substituted.",
          "browser",
        );
      } finally {
        signal.removeEventListener("abort", abort);
        await page.close().catch(() => {});
      }
    });
  }
  close() {
    return this.session.close();
  }
}
