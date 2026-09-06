import { SMILES_QUOTE_SCRIPT } from "./smiles-quote-script";
import {
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type { SearchQuery } from "../src/lib/types";
import {
  parseSmiles,
  smilesPayloadSchema,
} from "../src/lib/award-search/smiles";
import { ProviderError } from "../src/lib/award-search/types";
import {
  BrowserSearchError,
  type AmericanBrowserResult,
  type BrowserStage,
} from "./american";

export type SmilesBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "G3_GOL_SMILES";
};
type RawFare = {
  uid: string;
  uidupsell?: string;
  type: string;
  offer?: number;
  miles: number;
  money: number;
};
type RawFlight = { uid: string; sourceGDS: string; fareList: RawFare[] };

async function date(page: Page, value: string) {
  const d = new Date(value + "T12:00:00Z");
  const label = `Choose ${d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} as your check-in date. It’s available.`;
  const calendar = page.getByRole("application", {
    name: "Calendar",
    exact: true,
  });
  await calendar.waitFor();
  const cell = calendar
    .getByRole("button", { name: label, exact: true })
    .filter({ visible: true });
  for (let n = 0; !(await cell.count()); n++) {
    if (n >= 12)
      throw new BrowserSearchError(
        "Smiles did not offer this date in its calendar.",
        "date",
      );
    // React Dates wraps the actual arrow button in a zero-size role=button div.
    // Click the visible child, as a person using this calendar would.
    await calendar
      .getByRole("button", {
        name: "Move forward to switch to the next month.",
        exact: true,
      })
      .locator("button")
      .click();
  }
  await cell.click();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
}

/** Fresh anonymous browser, then the same read-only quote endpoints used by its public form. */
export class SmilesBrowserRunner {
  private pending?: Promise<Browser>;
  constructor(
    private options: {
      onObservation?: (payload: unknown) => Promise<void>;
    } = {},
  ) {}
  private async browser() {
    this.pending ??= webkit
      .launch({ headless: true, timeout: 30000 })
      .catch((e) => {
        this.pending = undefined;
        throw e;
      });
    return this.pending;
  }
  async close() {
    const pending = this.pending;
    this.pending = undefined;
    await pending?.then((b) => b.close()).catch(() => {});
  }
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<SmilesBrowserResult> {
    let context: BrowserContext | undefined,
      page: Page | undefined,
      stage = "launch";
    const started = Date.now(),
      stages: BrowserStage[] = [];
    const mark = (next: string) => {
      stage = next;
      stages.push({ stage, elapsedMs: Date.now() - started });
    };
    const abort = () => {
      void context?.close().catch(() => {});
    };
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    try {
      context = await (
        await this.browser()
      ).newContext({
        locale: "pt-BR",
        viewport: { width: 1440, height: 1000 },
      });
      signal.throwIfAborted();
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      mark("open-search");
      await page.goto("https://www.smiles.com.br/portal/passagens", {
        waitUntil: "domcontentloaded",
        timeout: 35000,
      });
      await page
        .getByRole("textbox", { name: "Origem", exact: true })
        .waitFor({ timeout: 30000 });
      const reject = page.getByRole("button", {
        name: /^Reject All$|^Rejeitar todos$/i,
      });
      if (await reject.isVisible()) await reject.click();
      mark("fill-route");
      await page
        .getByRole("button", {
          name: "Ida e volta arrow_drop_down",
          exact: true,
        })
        .click();
      await page
        .getByRole("menuitem", { name: "Somente ida", exact: true })
        .click();
      await page.getByRole("textbox", { name: "Origem", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Digite o local de origem", exact: true })
        .fill(q.origin);
      await page
        .getByRole("button", { name: new RegExp(`^flight .* ${q.origin}$`) })
        .click();
      await page
        .getByRole("textbox", {
          name: "Digite o local de destino",
          exact: true,
        })
        .fill(q.dest);
      await page
        .getByRole("button", { name: new RegExp(`^flight .* ${q.dest}$`) })
        .click();
      mark("date");
      await date(page, q.departDate);
      if (q.pax > 1) {
        await page
          .getByRole("button", {
            name: "person 1 pessoa adulta arrow_drop_down",
            exact: true,
          })
          .click();
        for (let n = 1; n < q.pax; n++)
          await page
            .getByRole("button", { name: "add", exact: true })
            .first()
            .click();
        await page
          .getByRole("button", { name: "Confirmar", exact: true })
          .click();
      }
      mark("submit-search");
      const responsePromise = context.waitForEvent("response", {
        predicate: (r) =>
          new URL(r.url()).hostname ===
            "api-air-flightsearch-blue.smiles.com.br" &&
          new URL(r.url()).pathname === "/v1/airlines/search",
        timeout: 40000,
      });
      void responsePromise.catch(() => {});
      await page
        .getByRole("button", { name: "Buscar voos", exact: true })
        .click();
      const response = await responsePromise;
      if (!response.ok())
        throw new BrowserSearchError(
          `Smiles's search returned HTTP ${response.status()}.`,
          stage,
          503,
        );
      const submitted = new URL(response.url()).searchParams;
      if (
        submitted.get("originAirportCode") !== q.origin ||
        submitted.get("destinationAirportCode") !== q.dest ||
        submitted.get("departureDate") !== q.departDate ||
        submitted.get("adults") !== String(q.pax) ||
        submitted.get("children") !== "0" ||
        submitted.get("infants") !== "0" ||
        submitted.get("memberNumber") !== "" ||
        submitted.get("forceCongener") !== "false" ||
        !["ALL", "ECONOMIC"].includes(submitted.get("cabin") || "")
      )
        throw new BrowserSearchError(
          "Smiles submitted a different route, traveler count or restricted search.",
          stage,
        );
      const bytes = await response.body();
      if (bytes.length > 16000000)
        throw new BrowserSearchError(
          "Smiles returned more data than this connection can validate.",
          stage,
        );
      const raw = JSON.parse(bytes.toString("utf8"));
      const flights: RawFlight[] =
        raw.requestedFlightSegmentList?.[0]?.flightList;
      if (
        !Array.isArray(flights) ||
        raw.requestedFlightSegmentList.length !== 1 ||
        flights.length > 500
      )
        throw new BrowserSearchError(
          "Smiles did not supply a complete one-way flight list.",
          stage,
        );
      page = context
        .pages()
        .find((p) =>
          new URL(p.url()).pathname.startsWith("/mfe/emissao-passagem/"),
        );
      if (!page)
        throw new BrowserSearchError(
          "Smiles did not open its flight results.",
          stage,
        );
      mark("all-results-pages");
      await page
        .getByRole("button", { name: "Selecionar tarifa", exact: true })
        .first()
        .waitFor({ timeout: 25000 });
      const more = page.getByRole("button", {
        name: "Mostrar mais passagens",
        exact: true,
      });
      for (let moves = 0; await more.isVisible(); moves++) {
        if (moves >= flights.length)
          throw new BrowserSearchError(
            "Smiles pagination did not advance.",
            stage,
          );
        const before = await page
          .getByRole("button", { name: "Selecionar tarifa", exact: true })
          .count();
        await more.click();
        await page.waitForFunction(
          (n) =>
            [...document.querySelectorAll("button")].filter(
              (b) => b.textContent?.trim() === "Selecionar tarifa",
            ).length > n,
          before,
          { timeout: 10000 },
        );
      }
      const displayedFlightCount = await page
          .getByRole("button", { name: "Selecionar tarifa", exact: true })
          .count(),
        endOfResults = await page
          .getByText("Chegamos ao fim das passagens de ida", { exact: true })
          .isVisible();
      if (displayedFlightCount !== flights.length || !endOfResults)
        throw new BrowserSearchError(
          "Smiles did not confirm the end of every flight result.",
          stage,
        );
      signal.throwIfAborted();
      mark("all-fares-and-travel-fees");
      const quoteArguments = {
        flights: flights.map((f) => ({
          uid: f.uid,
          sourceGDS: f.sourceGDS,
          fareList: f.fareList.map((v) => ({
            uid: v.uid,
            uidupsell: v.uidupsell,
            type: v.type,
            offer: v.offer,
            miles: v.miles,
            money: v.money,
          })),
        })),
        pax: q.pax,
      };
      const extensions = await page.evaluate(
        `(${SMILES_QUOTE_SCRIPT})(${JSON.stringify(quoteArguments)})`,
      );
      signal.throwIfAborted();
      mark("validate-complete-quotes");
      const candidate = {
        query: {
          origin: q.origin,
          dest: q.dest,
          departDate: q.departDate,
          pax: q.pax,
        },
        requestedCabin: submitted.get("cabin"),
        response: raw,
        displayedFlightCount,
        endOfResults,
        extensions,
      };
      const decoded = smilesPayloadSchema.safeParse(candidate);
      if (!decoded.success)
        throw new BrowserSearchError(
          "Smiles returned an incomplete or unrecognized fare response.",
          stage,
        );
      const payload = decoded.data,
        observedAt = new Date().toISOString();
      const rows = parseSmiles(payload, q, observedAt);
      await this.options.onObservation?.(payload);
      return {
        programId: "G3_GOL_SMILES",
        query: q,
        complete: true,
        observedAt,
        payload,
        itineraryCount: rows.length,
        fareCount: rows.reduce((n, r) => n + (r.fares?.length || 0), 0),
        stages,
      };
    } catch (error) {
      if (signal.aborted)
        throw new BrowserSearchError(
          "Smiles's browser search was cancelled or timed out.",
          stage,
          504,
        );
      if (error instanceof BrowserSearchError) throw error;
      if (error instanceof ProviderError)
        throw new BrowserSearchError(error.message, stage, error.status);
      throw new BrowserSearchError(
        `Smiles's browser search could not complete at ${stage}.`,
        stage,
        503,
        {
          error:
            error instanceof Error ? error.message.slice(0, 500) : "unknown",
        },
      );
    } finally {
      signal.removeEventListener("abort", abort);
      await context?.close().catch(() => {});
    }
  }
}
