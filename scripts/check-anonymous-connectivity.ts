/** Explicit, bounded network diagnosis. No accounts, user cookies or service secrets. */
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseAmerican } from "../src/lib/award-search/american";
import { ethiopianSearch } from "../src/lib/award-search/ethiopian";

const date = process.argv[2] ?? "2026-10-05";
const ua =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const report: Record<string, unknown>[] = [];
async function record(
  program: string,
  task: () => Promise<Record<string, unknown>>,
) {
  const start = Date.now();
  let result: Record<string, unknown>;
  try {
    result = await task();
  } catch (error) {
    result = {
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
  const row = { program, date, elapsedMs: Date.now() - start, ...result };
  report.push(row);
  console.log(JSON.stringify(row));
}

async function main() {
  await record("ET_SHEBAMILES", async () => {
    const rows = await ethiopianSearch(
      { origin: "ADD", dest: "NBO", departDate: date, pax: 1, minCabin: "Y" },
      AbortSignal.timeout(55000),
    );
    return {
      state: "success",
      itineraries: rows.length,
      fares: rows.reduce((n, row) => n + (row.fares?.length ?? 0), 0),
    };
  });

  await record("AA_AADVANTAGE", async () => {
    const base = "https://www.aa.com",
      jar = new Map<string, string>(),
      stages: Record<string, unknown>[] = [];
    const correlation = randomUUID();
    const q = {
      origin: "LAX",
      dest: "AUS",
      departDate: date,
      pax: 1,
      minCabin: "Y" as const,
    };
    async function request(
      stage: string,
      path: string,
      body?: string,
      form = false,
    ) {
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(25000),
        method: body === undefined ? "GET" : "POST",
        redirect: "manual",
        headers: {
          "User-Agent": ua,
          Accept: form ? "text/html" : "application/json",
          "Accept-Language": "en-US",
          ...(jar.size
            ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }
            : {}),
          ...(body === undefined
            ? {}
            : {
                "Content-Type": form
                  ? "application/x-www-form-urlencoded"
                  : "application/json",
                Origin: base,
                Referer: `${base}/booking/search/find-flights`,
                "X-CID": correlation,
                ...(jar.has("XSRF-TOKEN")
                  ? { "X-XSRF-TOKEN": decodeURIComponent(jar.get("XSRF-TOKEN")!) }
                  : {}),
              }),
        },
        body,
      });
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(";")[0],
          at = pair.indexOf("=");
        if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
      const html = await response.text();
      let data;
      try {
        data = JSON.parse(html);
      } catch {
        /* Normal booking document. */
      }
      const embedded = html.match(
        /<script[^>]*id="ng-state"[^>]*>([\s\S]*?)<\/script>/,
      )?.[1];
      if (embedded) data = JSON.parse(embedded)?.SearchData?.itineraryResult;
      let parsed: ReturnType<typeof parseAmerican> | undefined;
      if (data?.slices?.length) parsed = parseAmerican(data, q);
      stages.push({
        stage,
        status: response.status,
        bytes: html.length,
        errorCode: data?.error ?? null,
        challenge:
          /Challenge Validation|Pardon Our Interruption|Just a moment/.test(html),
        ...(parsed
          ? {
              itineraries: parsed.length,
              fares: parsed.reduce((n, r) => n + (r.fares?.length ?? 0), 0),
            }
          : {}),
      });
      return response.status;
    }
    const requestBody = {
      metadata: { selectedProducts: [], tripType: "OneWay", udo: {} },
      passengers: [{ type: "adult" }],
      requestHeader: { clientId: "AAcom" },
      slices: [
        {
          allCarriers: true,
          cabin: "",
          connectionCity: "",
          departureDate: date,
          destination: q.dest,
          destinationNearbyAirports: false,
          maxStops: null,
          origin: q.origin,
          originNearbyAirports: false,
        },
      ],
      tripOptions: {
        corporateBooking: false,
        fareType: "Lowest",
        locale: "en-US",
        pointOfSale: "US",
        searchType: "Award",
        enableBenefits: true,
      },
      loyaltyInfo: null,
      version: "",
      queryParams: {
        sliceIndex: 0,
        sessionId: "",
        solutionSet: "",
        solutionId: "",
        sort: "CARRIER",
      },
    };
    if ((await request("anonymous-home", "/homePage.do")) === 200) {
      jar.set("spa_session_id", correlation); // Ordinary client-generated correlation, not an account session.
      await request(
        "itinerary",
        "/booking/api/search/itinerary",
        JSON.stringify(requestBody),
      );
      await request(
        "booking-form",
        `/booking/choose-flights/1?sid=${randomUUID()}`,
        new URLSearchParams({
          searchRequest: JSON.stringify(requestBody),
        }).toString(),
        true,
      );
    }
    return { stages };
  });

  await record("QF_FF", async () => {
    const base = "https://flightrewardfinder.qantas.com";
    const response = await fetch(
      `${base}/api/search?${new URLSearchParams({ o: "SYD", d: "DXB", dr: `${date}I${date}`, p: "1" })}`,
      {
        headers: {
          "User-Agent": ua,
          Accept: "application/json",
          Referer: `${base}/`,
        },
        signal: AbortSignal.timeout(25000),
        redirect: "error",
      },
    );
    const text = await response.text();
    let keys: string[] | null = null;
    try {
      keys = Object.keys(JSON.parse(text));
    } catch {
      /* A challenge is not JSON inventory. */
    }
    return {
      status: response.status,
      bytes: text.length,
      jsonKeys: keys,
      challenge: /Just a moment|challenge-platform/.test(text),
    };
  });

  await mkdir("work", { recursive: true });
  await writeFile(
    "work/anonymous-connectivity.json",
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
