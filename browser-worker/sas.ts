import { mkdir, writeFile } from "node:fs/promises";
import type { SearchQuery } from "../src/lib/types";
import { sasBookingUrl } from "../src/lib/bookingHandoff";
import {
  parseSas,
  sasResponseSchema,
  sasObservationCounts,
  validateSasRequest,
} from "../src/lib/award-search/sas";
import { ProviderError } from "../src/lib/award-search/types";
import { BrowserSearchError, type AmericanBrowserResult } from "./american";
import { createDesktopChromeSession } from "./desktop-chrome";
import type { PersistentBrowserSession } from "./persistent-session";

export type SasBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "SK_EUROBONUS";
};
export class SasBrowserRunner {
  constructor(
    private session: PersistentBrowserSession = createDesktopChromeSession(
      "sas",
    ),
  ) {}
  async search(q: SearchQuery, signal: AbortSignal): Promise<SasBrowserResult> {
    const started = Date.now();
    return this.session.run(signal, async (context) => {
      const page = await context.newPage();
      const abort = () => {
        void page.close().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        await page.bringToFront();
        const pending = page.waitForResponse(
          (r) => {
            const u = new URL(r.url());
            return (
              u.hostname === "www.flysas.com" &&
              u.pathname === "/api/offers/flights" &&
              r.request().method() === "GET"
            );
          },
          { timeout: 45000 },
        );
        void pending.catch(() => {});
        await page.goto(sasBookingUrl(q), {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        const response = await pending;
        if (!response.ok())
          throw new BrowserSearchError(
            `SAS's award search returned HTTP ${response.status()}.`,
            "availability",
            response.status() === 429 ? 429 : 502,
          );
        const request = validateSasRequest(
          Object.fromEntries(new URL(response.url()).searchParams),
          q,
        );
        const bytes = await response.body();
        if (bytes.byteLength > 16 * 1024 * 1024)
          throw new BrowserSearchError(
            "SAS's flight response exceeded the collection limit.",
            "availability",
          );
        const raw = JSON.parse(bytes.toString("utf8"));
        if (
          raw.errors?.length ||
          raw.meta?.hasMore ||
          raw.meta?.nextPage ||
          (Array.isArray(raw.links) &&
            raw.links.some((x: { rel?: string }) =>
              /next|page/i.test(x.rel ?? ""),
            ))
        )
          throw new BrowserSearchError(
            "SAS returned an error or an unfinished flight list.",
            "completeness",
          );
        const body = sasResponseSchema.safeParse(raw);
        if (!body.success)
          throw new BrowserSearchError(
            "SAS's flight or price format changed.",
            "parse",
          );
        const payload = {
            type: "sas-points" as const,
            request,
            response: body.data,
          },
          observedAt = new Date().toISOString();
        const rows = parseSas(payload, q, observedAt),
          counts = sasObservationCounts(body.data);
        await page
          .getByRole("table", { name: "Select flights", exact: true })
          .waitFor({ timeout: 20000 });
        for (let n = 0; n < 30; n++) {
          const more = page.getByRole("link", { name: /^Show more flights/ });
          if (!(await more.isVisible())) break;
          await more.click();
        }
        const buttons = page.getByRole("button", {
          name: /^Flight \d+ of \d+/,
        });
        if (
          (await buttons.count()) !== counts.itineraries ||
          !(await page
            .getByRole("radio", { name: "Points", exact: true })
            .isChecked()) ||
          (await page.locator("#cep-pax-input").inputValue()) !==
            `${q.pax} adult${q.pax === 1 ? "" : "s"}`
        )
          throw new BrowserSearchError(
            "SAS's displayed flights or passenger count did not match its response.",
            "completeness",
          );
        if (
          !(await page.getByText("Login", { exact: true }).first().isVisible())
        )
          throw new BrowserSearchError(
            "SAS's anonymous search state could not be confirmed.",
            "session",
          );
        // Reconcile every displayed fare family, including those behind the cabin expansion.
        let displayedFares = 0;
        for (const f of Object.values(body.data.outboundFlights)) {
          signal.throwIfAborted();
          const row = page.locator(`#grid-outboundF${f.id}`);
          const cell = row.locator("td.flight-products").first();
          if ((await cell.getAttribute("aria-expanded")) !== "true")
            await cell.click();
          const cards = page.locator(
            `li[product-detail-card-layout][id^="outboundF${f.id}-"]`,
          );
          await cards.first().waitFor({ timeout: 5000 });
          await page.waitForFunction(
            ({ prefix, n }) => {
              const cards = [
                ...document.querySelectorAll(
                  `li[product-detail-card-layout][id^="${prefix}"]`,
                ),
              ];
              return (
                cards.length === n &&
                cards.every((e) =>
                  (
                    e
                      .querySelector(".product-fare[aria-label]")
                      ?.getAttribute("aria-label") ?? ""
                  ).match(/\d/),
                )
              );
            },
            {
              prefix: `outboundF${f.id}-`,
              n: Object.values(f.cabins).reduce(
                (n, c) =>
                  n +
                  Object.values(c).reduce(
                    (m, f) => m + Object.keys(f.products).length,
                    0,
                  ),
                0,
              ),
            },
            { timeout: 5000 },
          );
          const visible = await cards.evaluateAll((els) =>
            els.map((e) => ({
              name: (
                e
                  .querySelector('button[aria-label$=" FARE RULES"]')
                  ?.getAttribute("aria-label") ?? ""
              )
                .replace(/ FARE RULES$/, "")
                .trim()
                .replace(/\s+/g, " "),
              points: Number(
                (
                  e
                    .querySelector(".product-fare[aria-label]")
                    ?.getAttribute("aria-label") ?? ""
                ).replace(/\D/g, ""),
              ),
            })),
          );
          const expected = Object.values(f.cabins).flatMap((c) =>
            Object.values(c).flatMap((family) =>
              Object.values(family.products).map((p) => ({
                name: p.productName,
                points: p.price.pricePerPassengerType[0].price.points,
              })),
            ),
          );
          const canonical = (items: { name: string; points: number }[]) =>
            JSON.stringify(items.map((x) => `${x.name}:${x.points}`).sort());
          if (canonical(visible) !== canonical(expected)) {
            if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
              await mkdir("work/browser-probes", { recursive: true });
              await writeFile(
                "work/browser-probes/sas-mismatch.json",
                JSON.stringify({
                  id: f.id,
                  visible,
                  expected,
                  cards: await cards.evaluateAll((els) =>
                    els.map((e) => ({
                      header: e.querySelector("header")?.outerHTML,
                      labels: [...e.querySelectorAll("button[aria-label]")].map(
                        (b) => b.getAttribute("aria-label"),
                      ),
                    })),
                  ),
                }),
                { mode: 0o600 },
              );
            }
            throw new BrowserSearchError(
              "SAS's displayed fare families did not match all returned offers.",
              "completeness",
            );
          }
          displayedFares += visible.length;
        }
        if (displayedFares !== counts.fares)
          throw new BrowserSearchError(
            "SAS's displayed fare count was incomplete.",
            "completeness",
          );
        if (process.env.POINTSNAP_SAVE_PUBLIC_FIXTURE === "1") {
          await mkdir("work/browser-probes", { recursive: true });
          await writeFile(
            "work/browser-probes/sas-reference.txt",
            await page.locator("body").innerText(),
            { mode: 0o600 },
          );
          await page.screenshot({
            path: "work/browser-probes/sas-reference.png",
            fullPage: true,
          });
        }
        return {
          programId: "SK_EUROBONUS",
          query: q,
          observedAt,
          complete: true,
          itineraryCount: rows.length,
          fareCount: counts.fares,
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
        if (e instanceof BrowserSearchError) throw e;
        if (e instanceof ProviderError)
          throw new BrowserSearchError(e.message, "parse");
        throw new BrowserSearchError(
          "SAS's browser search could not complete.",
          "availability",
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
