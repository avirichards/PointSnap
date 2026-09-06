import {
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from "playwright";
import { missingDeltaBrands, parseDelta } from "../src/lib/award-search/delta";
import type { SearchQuery } from "../src/lib/types";
import { ProviderError } from "../src/lib/award-search/types";
import {
  BrowserSearchError,
  type AmericanBrowserResult,
  type BrowserStage,
} from "./american";

async function fillAirport(
  page: Page,
  kind: "Origin" | "Destination",
  code: string,
) {
  await page
    .getByRole("button", {
      name: new RegExp(`^${kind},|^One Way Route Picker ${kind}$`),
    })
    .click();
  await page.getByRole("textbox", { name: kind, exact: true }).fill(code);
  await page.getByRole("option", { name: new RegExp(`^${code} `) }).click();
  await page
    .getByRole("button", { name: new RegExp(`^${kind}, ${code},`) })
    .waitFor();
}

async function selectDate(page: Page, date: string) {
  await page.getByRole("button", { name: /^Flight Date Field,/ }).click();
  const target = new Date(`${date}T12:00:00Z`);
  const label = target.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const cell = page.locator(`button[role="gridcell"][aria-label="${label}"]`);
  for (let moved = 0; !(await cell.count()); moved++) {
    if (moved >= 12) throw new Error("date-outside-picker");
    const heading = await page
      .getByRole("dialog", { name: "Choose Dates" })
      .getByRole("heading")
      .first()
      .innerText();
    const firstMonth = Date.parse(`1 ${heading} 12:00:00 GMT`);
    if (!Number.isFinite(firstMonth)) throw new Error("unrecognized-calendar");
    await page
      .getByRole("button", {
        name:
          target.getTime() < firstMonth ? /^Previous month,/ : /^Next month,/,
      })
      .click();
  }
  await cell.click();
  await page
    .getByRole("button", { name: /^Date Picker .* Done Button$/ })
    .click();
}

export type DeltaBrowserResult = Omit<AmericanBrowserResult, "programId"> & {
  programId: "DL_SKYMILES";
};

async function loadBrands(
  codes: string[],
  signal: AbortSignal,
): Promise<unknown[]> {
  if (!codes.length) return [];
  if (codes.length > 100)
    throw new BrowserSearchError(
      "Delta's brand catalog exceeded the validated limit.",
      "catalog",
    );
  const query = `query ($appId:String!,$channelId:String!,$pageId:String!,$brandProductMapping:AWSJSON!){getBrandData(appId:$appId,channelId:$channelId,pageId:$pageId,brandProductMapping:$brandProductMapping){brandsAndProducts{brands{id parentBrandId shortBrandPrimaryName{text}}}}}`;
  const response = await fetch("https://content-api.delta.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "GUEST",
      Origin: "https://www.delta.com",
    },
    body: JSON.stringify({
      query,
      variables: {
        appId: "SHO",
        channelId: "ECOMM",
        pageId: "PRODUCT-MODAL",
        brandProductMapping: JSON.stringify({
          brandAndProducts: codes.map((id) => ({
            brand: { id },
            products: [],
          })),
        }),
      },
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok)
    throw new BrowserSearchError(
      "Delta's cabin catalog could not be reached.",
      "catalog",
      503,
    );
  const data = await response.json(),
    brands = data?.data?.getBrandData?.brandsAndProducts?.brands;
  if (
    data.errors?.length ||
    !Array.isArray(brands) ||
    brands.length !== codes.length ||
    codes.some(
      (code) =>
        brands.filter((b: { id?: string }) => b.id === code).length !== 1,
    )
  )
    throw new BrowserSearchError(
      "Delta did not define every returned cabin brand.",
      "catalog",
    );
  return brands;
}
type DataPage = {
  page: number;
  gqlOffersSets: unknown[];
  responseProperties: {
    resultsPageNum: number;
    resultsPerRequestNum: number;
    pageResultCnt: number;
    tripTypeText: string;
  };
  pricingOptions: unknown;
};

function isOffersResponse(response: Response, expectedPage: number) {
  const url = new URL(response.url());
  if (
    url.hostname !== "offer-api-prd.delta.com" ||
    url.pathname !== "/prd/rm-offer-gql"
  )
    return false;
  try {
    return (
      response.request().postDataJSON()?.variables?.offerSearchCriteria
        ?.offersCriteria?.resultsPageNum === expectedPage
    );
  } catch {
    return false;
  }
}

/** Read only public flight data returned to this worker's own anonymous browser. */
async function readPage(
  response: Response,
  q: SearchQuery,
  page: number,
): Promise<DataPage> {
  if (!response.ok())
    throw new BrowserSearchError(
      `Delta's offers request returned HTTP ${response.status()}.`,
      "offers",
      503,
    );
  const request = response.request().postDataJSON()
    ?.variables?.offerSearchCriteria;
  const criteria = request?.offersCriteria,
    flight = criteria?.flightRequestCriteria,
    route = flight?.searchOriginDestination?.[0];
  if (
    !criteria ||
    criteria.resultsPageNum !== page ||
    criteria.resultsPerRequestNum !== 20 ||
    JSON.stringify(criteria.pricingCriteria?.priceableIn) !== '["MILES"]' ||
    !Array.isArray(request.customers) ||
    request.customers.length !== q.pax ||
    request.customers.some(
      (p: { passengerTypeCode: string }) => p.passengerTypeCode !== "ADT",
    ) ||
    flight.searchOriginDestination.length !== 1 ||
    route.origins?.length !== 1 ||
    route.destinations?.length !== 1 ||
    route.origins[0]?.airportCode !== q.origin ||
    route.destinations[0]?.airportCode !== q.dest ||
    route.departureLocalTs?.slice(0, 10) !== q.departDate ||
    criteria.preferences?.nonStopOnly !== false ||
    criteria.preferences?.refundableOnly !== false ||
    criteria.preferences?.excludeBrandTypes?.length !== 0
  )
    throw new BrowserSearchError(
      "Delta's browser submitted a different search or restrictive fare filters.",
      "request",
    );
  const body = await response.body();
  if (body.length > 16 * 1024 * 1024)
    throw new BrowserSearchError(
      "Delta's response exceeded the validated size limit.",
      "offers",
    );
  const json = JSON.parse(body.toString("utf8"));
  if (json.errors?.length || !json.data?.gqlSearchOffers)
    throw new BrowserSearchError("Delta returned an offers error.", "offers");
  const offer = json.data.gqlSearchOffers,
    props = offer.offerDataList?.responseProperties;
  if (
    !props ||
    !Array.isArray(offer.gqlOffersSets) ||
    props.resultsPageNum !== page ||
    !Number.isSafeInteger(props.pageResultCnt) ||
    props.pageResultCnt < 0 ||
    props.pageResultCnt > 100 ||
    !Number.isSafeInteger(props.resultsPerRequestNum) ||
    props.resultsPerRequestNum < 0
  )
    throw new BrowserSearchError(
      "Delta's pagination metadata could not be verified.",
      "pagination",
    );
  // Discard flight-selection/session identifiers, advertising and account data.
  return JSON.parse(
    JSON.stringify(
      {
        page,
        gqlOffersSets: offer.gqlOffersSets,
        responseProperties: {
          resultsPageNum: props.resultsPageNum,
          resultsPerRequestNum: props.resultsPerRequestNum,
          pageResultCnt: props.pageResultCnt,
          tripTypeText: props.tripTypeText,
        },
        pricingOptions: offer.offerDataList.pricingOptions,
      },
      (key, value) =>
        [
          "offerId",
          "solutionId",
          "secondarySolutionRefIds",
          "seatReferenceId",
          "offerSetId",
        ].includes(key)
          ? undefined
          : value,
    ),
  );
}

export class DeltaBrowserRunner {
  private pendingBrowser?: Promise<Browser>;
  constructor(
    private options: {
      onObservation?: (payload: unknown) => Promise<void>;
    } = {},
  ) {}
  private browser() {
    this.pendingBrowser ??= webkit
      .launch({ headless: true, timeout: 30000 })
      .catch((error) => {
        this.pendingBrowser = undefined;
        throw error;
      });
    return this.pendingBrowser;
  }
  async close() {
    const pending = this.pendingBrowser;
    this.pendingBrowser = undefined;
    await pending?.then((b) => b.close()).catch(() => {});
  }
  async search(
    q: SearchQuery,
    signal: AbortSignal,
  ): Promise<DeltaBrowserResult> {
    signal.throwIfAborted();
    const started = Date.now(),
      stages: BrowserStage[] = [];
    let stage = "launch",
      context: BrowserContext | undefined,
      page: Page | undefined;
    const mark = (next: string) => {
      stage = next;
      stages.push({ stage, elapsedMs: Date.now() - started });
    };
    const abort = () => {
      void context?.close().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const browser = await this.browser();
      signal.throwIfAborted();
      if (!browser.isConnected()) {
        this.pendingBrowser = undefined;
        throw new BrowserSearchError(
          "Delta's browser disconnected.",
          stage,
          503,
        );
      }
      context = await browser.newContext({
        locale: "en-US",
        viewport: { width: 1440, height: 1000 },
      });
      signal.throwIfAborted();
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("response", (r) => {
        if (r.request().isNavigationRequest())
          stages.push({
            stage: "document",
            elapsedMs: Date.now() - started,
            path: new URL(r.url()).pathname,
            status: r.status(),
          });
      });
      mark("open-booking");
      await page.goto("https://www.delta.com/flightsearch/book-a-flight", {
        waitUntil: "domcontentloaded",
        timeout: 35000,
      });
      await page
        .getByRole("button", { name: "Find Flights", exact: true })
        .waitFor({ timeout: 35000 });
      const notice = page.getByRole("button", {
        name: "I understand",
        exact: true,
      });
      if (await notice.isVisible()) await notice.click();
      mark("fill-search");
      await fillAirport(page, "Origin", q.origin);
      await fillAirport(page, "Destination", q.dest);
      await page.getByRole("combobox", { name: /^Trip Type,/ }).click();
      await page
        .getByRole("option", { name: /^One Way(?: , selected)?$/ })
        .click();
      await selectDate(page, q.departDate);
      const passengers = page.getByRole("combobox", {
        name: /^Passenger Count,/,
      });
      if (
        (await passengers.getAttribute("aria-label")) !==
        `Passenger Count, ${q.pax}`
      ) {
        await passengers.click();
        await page
          .getByRole("option", {
            name: new RegExp(`^${q.pax} Passengers?(?: , selected)?$`),
          })
          .click();
      }
      for (const [name, desired] of [
        ["Shop with Miles", true],
        ["Include Basic", true],
        ["My Dates are Flexible", false],
        ["Include Nearby Airports", false],
      ] as const) {
        const input = page.getByRole("checkbox", { name, exact: true });
        if ((await input.isChecked()) !== desired) {
          const id = await input.getAttribute("id");
          if (!id || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id))
            throw new BrowserSearchError(
              "Delta's fare control changed.",
              stage,
            );
          await page.locator(`label[for="${id}"]`).click();
        }
        if ((await input.isChecked()) !== desired)
          throw new BrowserSearchError(
            "Delta's fare filters could not be set.",
            stage,
          );
      }
      mark("submit-miles-search");
      const firstResponse = page.waitForResponse(
        (r) => isOffersResponse(r, 1),
        { timeout: 35000 },
      );
      // Handle rejected wait promises even when the initiating click itself fails.
      void firstResponse.catch(() => {});
      await page
        .getByRole("button", { name: "Find Flights", exact: true })
        .click();
      const pages = [await readPage(await firstResponse, q, 1)];
      const expected = pages[0].responseProperties.pageResultCnt;
      for (let next = 2; next <= expected; next++) {
        signal.throwIfAborted();
        mark(`offers-page-${next}`);
        const more = page.getByRole("button", {
          name: "See More Results",
          exact: true,
        });
        await more.waitFor({ state: "visible", timeout: 15000 });
        const response = page.waitForResponse(
          (r) => isOffersResponse(r, next),
          { timeout: 25000 },
        );
        void response.catch(() => {});
        await more.click();
        pages.push(await readPage(await response, q, next));
      }
      signal.throwIfAborted();
      mark("validate-complete-results");
      const observedAt = new Date().toISOString(),
        payload = {
          query: {
            origin: q.origin,
            dest: q.dest,
            departDate: q.departDate,
            pax: q.pax,
          },
          priceType: "MILES",
          pages,
        };
      const completePayload = {
        ...payload,
        brandDefinitions: await loadBrands(missingDeltaBrands(payload), signal),
      };
      await this.options.onObservation?.(completePayload);
      const rows = parseDelta(completePayload, q, observedAt);
      return {
        programId: "DL_SKYMILES",
        query: q,
        complete: true,
        observedAt,
        payload: completePayload,
        itineraryCount: rows.length,
        fareCount: rows.reduce((n, r) => n + (r.fares?.length || 0), 0),
        stages,
      };
    } catch (error) {
      if (signal.aborted)
        throw new BrowserSearchError(
          "Delta's browser search was cancelled or timed out.",
          stage,
          504,
        );
      if (error instanceof BrowserSearchError) throw error;
      if (error instanceof ProviderError)
        throw new BrowserSearchError(error.message, stage, error.status);
      const visible = await page
        ?.locator("body")
        .innerText({ timeout: 1000 })
        .catch(() => "");
      const code = visible?.match(/#(SFAF\d{3,8})\b/)?.[1];
      throw new BrowserSearchError(
        code
          ? `Delta displayed processing error ${code}.`
          : /Access Denied|verify you are human|Challenge Validation|unusual activity/i.test(
                visible || "",
              )
            ? "Delta requires browser verification before returning flights."
            : `Delta's browser search could not complete at ${stage}.`,
        stage,
        503,
      );
    } finally {
      signal.removeEventListener("abort", abort);
      await context?.close().catch(() => {});
    }
  }
}
