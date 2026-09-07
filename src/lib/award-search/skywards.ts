import { load } from "cheerio/slim";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { SearchQuery } from "@/lib/types";
import { skywardsPartnerUrl } from "@/lib/bookingHandoff";
import { ProviderError, type AwardResult, type AwardSegment } from "./types";

const base = "https://partnerrewards.emirates.com";
type SourceResult = {
  indexes?: {
    depiata?: string;
    arriata?: string;
    dateout?: number;
    outstops?: number;
  };
};
type Snapshot = {
  status?: number;
  results?: Record<string, SourceResult> | [];
};
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function localDate(label: string, reference: string) {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})$/.exec(label.trim());
  const month = match ? months.indexOf(match[2]) : -1;
  if (!match || month < 0)
    throw new ProviderError("Skywards returned an unreadable flight date.");
  const year = Number(reference.slice(0, 4));
  const anchor = Date.parse(reference + "T00:00:00Z");
  const dates = [year - 1, year, year + 1].map(
    (y) =>
      `${y}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`,
  );
  const result = dates.find((d) => {
    const time = Date.parse(d + "T00:00:00Z");
    return (
      Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === d &&
      time >= anchor &&
      time - anchor <= 4 * 86400000
    );
  });
  if (!result)
    throw new ProviderError(
      "Skywards returned a date outside the requested journey.",
    );
  return result;
}

export function parseSkywards(
  html: string,
  q: SearchQuery,
  expected: Record<string, SourceResult>,
  observedAt = new Date().toISOString(),
): AwardResult[] {
  const $ = load(html);
  const seen = new Set<string>();
  const rows: AwardResult[] = [];
  for (const element of $(".bf_rsitem").toArray()) {
    const item = $(element);
    const sourceId = item.find('input[name="outFlight"]').attr("value");
    if (!sourceId || !Object.hasOwn(expected, sourceId) || seen.has(sourceId))
      continue;
    const index = expected[sourceId].indexes;
    if (
      index?.depiata !== q.origin ||
      index?.arriata !== q.dest ||
      index?.dateout !== Date.parse(q.departDate + "T00:00:00Z") / 1000
    )
      throw new ProviderError("Skywards returned a different route or date.");
    const miles = /^(\d[\d,]*)\s+Miles$/.exec(
      item.find(".bf_price").text().trim(),
    );
    const total = miles ? Number(miles[1].replaceAll(",", "")) : NaN;
    if (
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      item.find(".bf_fltclass span").text().trim() !== "Economy"
    )
      throw new ProviderError(
        "Skywards returned an unrecognized award price or cabin.",
      );
    const segments: AwardSegment[] = [];
    let duration: number | null = null;
    for (const el of item.find(".bf_fleginfo").toArray()) {
      const leg = $(el);
      const flightNumber = leg.find(".bf_fcol_fnum").text().trim();
      const dep = leg.find(".bf_legdept");
      const arr = leg.find(".bf_legarrv");
      const departureTime = dep.find(".bf_time").text().trim();
      const arrivalTime = arr.find(".bf_time").text().trim();
      const origin = dep.find(".bf_aptc").text().trim();
      const destination = arr.find(".bf_aptc").text().trim();
      if (
        !/^(U2|LS)\d+$/.test(flightNumber) ||
        !/^[A-Z]{3}$/.test(origin) ||
        !/^[A-Z]{3}$/.test(destination) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(departureTime) ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)
      )
        throw new ProviderError(
          "Skywards returned an unrecognized partner flight.",
        );
      segments.push({
        origin,
        destination,
        departure: `${localDate(dep.find(".bf_date").text(), q.departDate)}T${departureTime}:00`,
        arrival: `${localDate(arr.find(".bf_date").text(), q.departDate)}T${arrivalTime}:00`,
        airline: flightNumber.slice(0, 2),
        airlineName: leg.find(".bf_airlogo img").attr("alt") ?? null,
        flightNumber,
        cabin: "Y",
      });
      const text = leg.find(".bf_legduration").text();
      const hours = /([\d]+)\s*hr/.exec(text),
        minutes = /([\d]+)\s*min/.exec(text);
      if (hours || minutes)
        duration = Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
    }
    if (
      !segments.length ||
      segments[0].origin !== q.origin ||
      segments.at(-1)?.destination !== q.dest ||
      segments[0].departure?.slice(0, 10) !== q.departDate ||
      (typeof index.outstops === "number" &&
        segments.length !== index.outstops + 1)
    )
      throw new ProviderError(
        "Skywards did not supply the complete itinerary.",
      );
    const fareName = item.find(".bf_frbrand").first().text().trim();
    const price = {
      cabin: "Y" as const,
      points: total / q.pax,
      partyPoints: total,
      quotedPassengers: q.pax,
      cash: 0,
      currency: null,
      feesIncludedInPoints: true,
      seats: null,
      mixedCabin: false,
      fareName,
      segmentCabins: segments.map(() => "Y" as const),
    };
    const key =
      segments.map((s) => `${s.flightNumber}@${s.departure}`).join("|") +
      `:${fareName}:${total}`;
    rows.push({
      id: `EK_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
      programId: "EK_SKYWARDS",
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration: segments.length === 1 ? duration : null,
      prices: { Y: price },
      source: "Skywards · easyJet & Jet2 partners",
      freshness: "live",
      observedAt,
      bookingUrl: skywardsPartnerUrl(q),
    });
    seen.add(sourceId);
  }
  if (seen.size !== Object.keys(expected).length)
    throw new ProviderError(
      "Skywards did not return every requested flight price. Please retry.",
    );
  return rows;
}

export async function skywardsSearch(
  q: SearchQuery,
  outerSignal: AbortSignal,
): Promise<AwardResult[]> {
  if (q.minCabin !== "Y") return [];
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(55000)]);
  const cookies = new Map<string, string>();
  async function request(url: URL | string, init: RequestInit = {}) {
    const target = new URL(url);
    if (target.origin !== base)
      throw new ProviderError(
        "Skywards returned an unexpected search location.",
      );
    const headers = new Headers(init.headers);
    if (cookies.size)
      headers.set(
        "Cookie",
        [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      );
    const response = await fetch(target, {
      ...init,
      headers,
      signal,
      redirect: "manual",
      cache: "no-store",
    });
    for (const value of response.headers.getSetCookie()) {
      const match = /^([^=;\s]+)=([^;]*)/.exec(value);
      if (match) cookies.set(match[1], match[2]);
    }
    if (!response.ok && ![302, 303].includes(response.status))
      throw new ProviderError(
        `Skywards partner search is unavailable (HTTP ${response.status}).`,
        response.status,
      );
    return response;
  }
  const initial = await request(skywardsPartnerUrl(q));
  const location = initial.headers.get("location");
  await initial.body?.cancel();
  if (!location)
    throw new ProviderError(
      "Skywards did not start an anonymous partner search.",
    );
  const resultsUrl = new URL(location, base);
  if (
    resultsUrl.origin !== base ||
    !/^\/results\/[a-f\d-]+$/i.test(resultsUrl.pathname) ||
    resultsUrl.search
  )
    throw new ProviderError("Skywards returned an unexpected search location.");
  const shell = await request(resultsUrl);
  const page = await shell.text();
  if (!shell.ok || !page.includes("bf_flow") || !page.includes("bf_results"))
    throw new ProviderError("Skywards did not open the partner search.");
  const accumulated: Record<string, SourceResult> = {};
  let complete = false;
  for (let i = 0; i < 40; i++) {
    const poll = new URL(resultsUrl);
    poll.search = new URLSearchParams({
      i: String(i),
      m: "checkStatus",
      ...(i === 0 ? { preload: "1" } : {}),
    }).toString();
    const response = await request(poll, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!response.ok)
      throw new ProviderError("Skywards partner search session expired.");
    const data = (await response.json()) as Snapshot;
    if (
      typeof data.status !== "number" ||
      data.status < 0 ||
      (data.results !== undefined &&
        (data.results === null || typeof data.results !== "object"))
    )
      throw new ProviderError(
        "Skywards partner search did not complete successfully.",
      );
    for (const [id, row] of Object.entries(data.results ?? {})) {
      if (!/^[a-f\d-]+$/i.test(id) || !row || typeof row !== "object")
        throw new ProviderError(
          "Skywards returned an unexpected flight response.",
        );
      if (
        !row.indexes ||
        !/^[A-Z]{3}$/.test(row.indexes.depiata ?? "") ||
        !/^[A-Z]{3}$/.test(row.indexes.arriata ?? "") ||
        !Number.isFinite(row.indexes.dateout)
      )
        throw new ProviderError(
          "Skywards did not identify the route and date for every result.",
        );
      accumulated[id] = row;
    }
    if (data.status === 2 || data.status === 10) {
      complete = true;
      break;
    }
    if (data.status !== 0 && data.status !== 1)
      throw new ProviderError("Skywards returned an unknown search state.");
    await delay(1000, undefined, { signal });
  }
  if (!complete)
    throw new ProviderError(
      "Skywards partner search timed out before every result arrived.",
    );
  const entries = Object.entries(accumulated).filter(
    ([, row]) =>
      row.indexes?.depiata === q.origin &&
      row.indexes?.arriata === q.dest &&
      row.indexes?.dateout === Date.parse(q.departDate + "T00:00:00Z") / 1000,
  );
  const rows: AwardResult[] = [];
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const body = new URLSearchParams({
      m: "renderResults",
      pagetype: "results",
      inSlidebox: "false",
      inAddprod: "false",
      pricemode: "t",
      sortmode: "sort_price",
      viewmode: "list",
    });
    for (const [id] of batch) body.append("results[]", id);
    const response = await request(resultsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
    });
    if (!response.ok)
      throw new ProviderError(
        "Skywards partner search session expired before pricing.",
      );
    rows.push(
      ...parseSkywards(await response.text(), q, Object.fromEntries(batch)),
    );
  }
  return rows;
}
