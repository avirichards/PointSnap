/** Bounded anonymous transport comparisons. Never uses personal browser state. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Impit } from "impit";
import { directSearch } from "../src/lib/award-search/direct";

const date = "2026-10-05";
const ua =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const originalFetch = globalThis.fetch;
const report: Record<string, unknown>[] = [];
async function record(
  program: string,
  variant: string,
  task: () => Promise<Record<string, unknown>>,
) {
  const started = Date.now();
  let result: Record<string, unknown>;
  try {
    result = await task();
  } catch (error) {
    result = {
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
  const row = {
    program,
    variant,
    date,
    elapsedMs: Date.now() - started,
    ...result,
  };
  report.push(row);
  console.log(JSON.stringify(row));
}

function freshSession() {
  const cookies = new Map<
    string,
    {
      pair: string;
      domain: string;
      hostOnly: boolean;
      path: string;
      expires: number;
    }
  >();
  const stages: Record<string, unknown>[] = [];
  async function request(
    stage: string,
    urlString: string,
    init: RequestInit = {},
    redirects = 0,
  ) {
    const url = new URL(urlString);
    const cookie = [...cookies.values()]
      .filter(
        (c) =>
          c.expires > Date.now() &&
          (url.hostname === c.domain ||
            (!c.hostOnly && url.hostname.endsWith(`.${c.domain}`))) &&
          (url.pathname === c.path ||
            url.pathname.startsWith(
              c.path.endsWith("/") ? c.path : `${c.path}/`,
            )),
      )
      .map((c) => c.pair)
      .join("; ");
    const headers = new Headers(init.headers);
    headers.set("User-Agent", ua);
    if (cookie) headers.set("Cookie", cookie);
    const response = await originalFetch(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(";");
      const attrs = new Map(
        attributes.map((value) => {
          const at = value.indexOf("=");
          return [
            value
              .slice(0, at < 0 ? undefined : at)
              .trim()
              .toLowerCase(),
            at < 0 ? "" : value.slice(at + 1).trim(),
          ];
        }),
      );
      const domain =
        attrs.get("domain")?.replace(/^\./, "").toLowerCase() || url.hostname;
      if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))
        continue;
      const path =
        attrs.get("path") ||
        url.pathname.slice(0, url.pathname.lastIndexOf("/")) ||
        "/";
      const expires = attrs.has("max-age")
        ? Date.now() + 1000 * Number(attrs.get("max-age"))
        : attrs.has("expires")
          ? Date.parse(attrs.get("expires")!)
          : Infinity;
      cookies.set(`${domain}:${path}:${pair.split("=")[0]}`, {
        pair,
        domain,
        path,
        expires,
        hostOnly: !attrs.has("domain"),
      });
    }
    const text = await response.text();
    let data: Record<string, unknown> | undefined;
    try {
      data = JSON.parse(text);
    } catch {
      /* A document is not flight JSON. */
    }
    stages.push({
      stage,
      status: response.status,
      bytes: text.length,
      challenge:
        /captcha|cpr_chlge|Challenge Validation|Pardon Our Interruption|Access Denied|Just a moment/i.test(
          text,
        ),
      errorCode: data?.code ?? data?.error ?? null,
      ...(response.headers.get("location")
        ? {
            redirectTo: (() => {
              const to = new URL(response.headers.get("location")!, url);
              return to.origin + to.pathname;
            })(),
          }
        : {}),
    });
    // A normal same-origin GET redirect can be followed with this request's
    // own cookie jar. Never move authorization headers to another origin.
    if (
      [301, 302, 303, 307, 308].includes(response.status) &&
      response.headers.get("location") &&
      (!init.method || init.method === "GET") &&
      redirects < 3
    ) {
      const target = new URL(response.headers.get("location")!, url);
      if (target.origin === url.origin && target.protocol === "https:")
        return request(stage + "-redirect", target.href, init, redirects + 1);
    }
    return { response, text, data };
  }
  return { request, stages };
}

async function main() {
  await mkdir("work", { recursive: true });
  // Runs serially in this diagnostic process. The application itself is never
  // changed by these transport overrides; working cookies remain request-local.
  for (const [program, origin, dest] of [["ET_SHEBAMILES", "ADD", "NBO"]]) {
    for (const variant of ["browser-header", "compatible-http"]) {
      await record(program, variant, async () => {
        const client = new Impit({ browser: "chrome", timeout: 45000 });
        globalThis.fetch = (async (
          input: string | URL | Request,
          init: RequestInit = {},
        ) => {
          const headers = new Headers(init.headers);
          headers.set("User-Agent", ua);
          return variant === "browser-header"
            ? originalFetch(input, { ...init, headers })
            : client.fetch(input.toString(), { ...init, headers } as Parameters<
                Impit["fetch"]
              >[1]);
        }) as typeof fetch;
        try {
          const rows = await directSearch(
            program,
            { origin, dest, departDate: date, pax: 1, minCabin: "Y" },
            AbortSignal.timeout(55000),
          );
          return {
            state: rows.length ? "success" : "empty",
            itineraries: rows.length,
            fares: rows.reduce(
              (n, r) => n + (r.fares?.length ?? Object.keys(r.prices).length),
              0,
            ),
          };
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    }
  }

  await record("UA_MP", "host-network-current-anonymous", async () => {
    const { request, stages } = freshSession();
    const base = "https://www.united.com";
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: base,
      Referer: `${base}/en/us/fsr/choose-flights`,
    };
    const tokenResponse = await request(
      "anonymous-token",
      `${base}/api/token/anonymous`,
      { headers },
    );
    const token = (
      tokenResponse.data?.data as { token?: { hash?: string } } | undefined
    )?.token?.hash;
    if (tokenResponse.response.ok && token) {
      const body = JSON.parse(
        await readFile("scripts/diagnostics/united-request.json", "utf8"),
      );
      body.Trips[0].DepartDate = date;
      const result = await request(
        "award-search",
        `${base}/api/flight/FetchFlights`,
        {
          method: "POST",
          headers: { ...headers, "x-authorization-api": `bearer ${token}` },
          body: JSON.stringify(body),
        },
      );
      if (result.response.ok && result.data)
        await writeFile(
          "work/hosted-united-response.json",
          JSON.stringify(result.data),
        );
    }
    return { stages };
  });

  await record("DL_SKYMILES", "host-network-current-guest", async () => {
    const { request, stages } = freshSession();
    const base = "https://www.delta.com";
    await request("home", base + "/");
    await request("booking-entry", base + "/flightsearch/book-a-flight");
    const criteria = {
      productGroups: [{ productCategoryCode: "FLIGHTS" }],
      offersCriteria: {
        resultsPageNum: 1,
        resultsPerRequestNum: 20,
        preferences: {
          refundableOnly: false,
          showGlobalRegionalUpgradeCertificate: true,
          nonStopOnly: false,
          excludeBrandTypes: [],
        },
        pricingCriteria: { priceableIn: ["MILES"] },
        flightRequestCriteria: {
          currentTripIndexId: "0",
          sortableOptionId: null,
          selectedOfferId: "",
          searchOriginDestination: [
            {
              departureLocalTs: `${date}T00:00:00`,
              destinations: [{ airportCode: "JFK" }],
              origins: [{ airportCode: "LAX" }],
            },
          ],
          additionalCriteriaMap: { rollOutTag: "GBB" },
        },
      },
      customers: [{ passengerTypeCode: "ADT", passengerId: "1" }],
    };
    const query = await readFile(
      "scripts/diagnostics/delta-offers.graphql",
      "utf8",
    );
    const result = await request(
      "guest-award-offers",
      "https://offer-api-prd.delta.com/prd/rm-offer-gql",
      {
        method: "POST",
        headers: {
          Authorization: "GUEST",
          "Content-Type": "application/json",
          Accept: "application/json",
          TransactionId: `${randomUUID()}_${Date.now()}`,
          applicationId: "DC",
          "x-app-type": "dcom-shop",
          "x-app-route": "search",
          channelId: "DCOM",
          Airline: "DL",
          Origin: base,
          Referer: `${base}/flightsearch/search-results`,
        },
        body: JSON.stringify({
          query,
          variables: { offerSearchCriteria: criteria },
        }),
      },
    );
    if (result.response.ok && result.data)
      await writeFile(
        "work/hosted-delta-response.json",
        JSON.stringify(result.data),
      );
    return { stages };
  });

  await record("WN_RAPID", "host-network-current-booker", async () => {
    const { request, stages } = freshSession();
    const base = "https://www.southwest.com";
    const body = JSON.parse(
      await readFile("scripts/diagnostics/southwest-request.json", "utf8"),
    );
    body.departureDate = date;
    const landing = `${base}/air/booking/select-depart.html?${new URLSearchParams({ ...body, departureTimeOfDay: "ALL_DAY", returnTimeOfDay: "ALL_DAY" })}`;
    await request("home", base + "/");
    await request("booking-entry", landing);
    const config = await request(
      "public-current-config",
      base + "/swa-ui/bootstrap/air-booking/1/data.js",
    );
    const match = config.text.match(
      /"swa-bootstrap-air-booking\/api-keys":\[function\(require,module,exports\)\{\s*module.exports = ([^;]+);/,
    );
    if (match) {
      const key = JSON.parse(match[1]).prod; // Public application marker, never a member key.
      const result = await request(
        "award-shopping",
        base + "/api/air-booking/v1/air-booking/page/air/booking/shopping",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-api-key": key,
            "X-app-id": "air-booking",
            "X-app-version": "112.0.3",
            "X-channel-id": "southwest",
            "X-user-experience-id": randomUUID(),
            Origin: base,
            Referer: landing,
          },
          body: JSON.stringify(body),
        },
      );
      if (result.response.ok && result.data)
        await writeFile(
          "work/hosted-southwest-response.json",
          JSON.stringify(result.data),
        );
    }
    return { stages };
  });
  await mkdir("work", { recursive: true });
  await writeFile(
    "work/airline-transport.json",
    JSON.stringify(
      { checkedAt: new Date().toISOString(), runtime: process.version, report },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Diagnostic failed");
  process.exitCode = 1;
});
