import { z } from "zod";
import { PROGRAMS } from "@/lib/programs";
import { bookingUrl } from "@/lib/bookingHandoff";
import {
  cabin,
  number,
  ProviderError,
  type AwardResult,
  type ProviderContext,
} from "./types";
import { providerJson, pause } from "./http";
import { CABIN_ORDER, type SearchQuery } from "@/lib/types";
// These codes appear in the provider's official trigger sample. Additional
// contract-enabled programs are configured explicitly, never assumed supported.
const DEFAULT_CODES = "QF,AC,UA,AA,AS,AV,B6,VA,VS";
export function awardToolPrograms() {
  const codes = (process.env.AWARDTOOL_PROGRAMS || DEFAULT_CODES)
    .split(",")
    .map((c) => c.trim().toUpperCase());
  return PROGRAMS.filter((p) => codes.includes(p.iata)).map((p) => p.id);
}
const product = z.object({
  origin: z.string(),
  destination: z.string(),
  departure_time: z.string(),
  arrival_time: z.string(),
  airline_code: z.string(),
  flight_number: z.string(),
  aircraft: z.string().optional(),
  cabin_type: z.string().optional(),
});
const price = z.object({
  miles: z.number(),
  tax: z.number().nullish(),
  seats: z.number().nullish(),
  premium_cabin_percentage: z.number().nullish(),
});
const result = z.object({
  id: z.string(),
  ids: z.object({ flight_deduplicate_id: z.string() }).optional(),
  date: z.string(),
  program_code: z.string(),
  currency: z.string().nullish(),
  last_seen: z.number().optional(),
  cabin_prices: z.record(z.string(), price),
  fare: z.object({
    products: z.array(product),
    travel_minutes_total: z.number().nullish(),
  }),
});
const batch = z.object({
  status: z.number(),
  result: z.array(z.unknown()),
  finish: z.boolean(),
  program_done: z.array(z.string()),
  finish_reason: z.string().optional(),
});
export function parseAwardTool(
  raw: unknown,
  q: SearchQuery,
  now = new Date().toISOString(),
): AwardResult[] {
  const parsed = result.safeParse(raw);
  if (!parsed.success)
    throw new ProviderError("AwardTool changed its result format.");
  const r = parsed.data;
  const p = PROGRAMS.find((p) => p.iata === r.program_code);
  if (!p || r.date !== q.departDate) return [];
  const segments = r.fare.products.map((s) => ({
    origin: s.origin,
    destination: s.destination,
    departure: s.departure_time,
    arrival: s.arrival_time,
    airline: s.airline_code,
    flightNumber: s.flight_number,
    aircraft: s.aircraft,
    cabin: cabin(s.cabin_type),
  }));
  if (
    !segments.length ||
    segments[0].origin !== q.origin ||
    segments.at(-1)?.destination !== q.dest ||
    segments[0].departure.slice(0, 10) !== q.departDate
  )
    return [];
  const prices: AwardResult["prices"] = {};
  for (const [label, value] of Object.entries(r.cabin_prices)) {
    const c = cabin(label);
    const points = number(value.miles);
    const seats = number(value.seats);
    if (
      !c ||
      CABIN_ORDER.indexOf(c) < CABIN_ORDER.indexOf(q.minCabin) ||
      !points ||
      (seats && seats < q.pax)
    )
      continue;
    prices[c] = {
      cabin: c,
      points,
      cash: number(value.tax),
      currency: r.currency ?? null,
      seats: seats || null,
      mixedCabin:
        c !== "Y" &&
        value.premium_cabin_percentage != null &&
        value.premium_cabin_percentage < 100,
    };
  }
  if (!Object.keys(prices).length) return [];
  const observed =
    r.last_seen && r.last_seen > 0
      ? new Date(r.last_seen * 1000).toISOString()
      : now;
  const fresh = Date.parse(now) - Date.parse(observed) < 5 * 60000;
  return [
    {
      id: `awardtool_${p.id}_${r.ids?.flight_deduplicate_id ?? r.id}`,
      programId: p.id,
      origin: q.origin,
      destination: q.dest,
      date: q.departDate,
      kind: "flight",
      segments,
      duration: number(r.fare.travel_minutes_total),
      prices,
      source: "AwardTool",
      freshness: fresh ? "live" : "cached",
      observedAt: observed,
      bookingUrl: bookingUrl(p.id, q),
    },
  ];
}
export async function awardToolSearch(ids: string[], ctx: ProviderContext) {
  const api_key = process.env.AWARDTOOL_API_KEY;
  const q = ctx.query;
  const programs = PROGRAMS.filter((p) => ids.includes(p.id)).map(
    (p) => p.iata,
  );
  const started = (await providerJson(
    "https://apisv2.awardtoolapi.com/flight_trigger/search_real_time",
    {
      origin: q.origin,
      destination: q.dest,
      programs,
      cabins: ["Economy", "Premium Economy", "Business", "First"],
      date: q.departDate,
      pax: String(q.pax),
      api_key,
    },
    ctx.signal,
  )) as { task_id?: string; status?: number };
  if (started.status !== 200 || !started.task_id)
    throw new ProviderError("AwardTool could not start this search.");
  const done = new Set<string>();
  const seen = new Map<string, string>();
  const counts = new Map<string, number>();
  for (let attempt = 0; attempt < 24; attempt++) {
    await pause(attempt ? 2500 : 500, ctx.signal);
    const raw = await providerJson(
      "https://apisv2.awardtoolapi.com/flight_retrieval/search_result",
      { task_id: started.task_id, api_key },
      ctx.signal,
    );
    const data = batch.safeParse(raw);
    if (!data.success || data.data.status !== 200)
      throw new ProviderError("AwardTool returned an unexpected response.");
    const rows = data.data.result
      .flatMap((r) => parseAwardTool(r, q))
      .filter(
        (r) =>
          ids.includes(r.programId) && seen.get(r.id) !== JSON.stringify(r),
      );
    rows.forEach((r) => {
      if (!seen.has(r.id))
        counts.set(r.programId, (counts.get(r.programId) ?? 0) + 1);
      seen.set(r.id, JSON.stringify(r));
    });
    if (rows.length) ctx.emit({ type: "results", rows });
    for (const unit of data.data.program_done) {
      const parts = unit.split("|");
      const p = PROGRAMS.find((p) => p.iata === parts[1]);
      if (
        !p ||
        !ids.includes(p.id) ||
        parts[2] !== q.origin ||
        parts[3] !== q.dest ||
        parts[5] !== q.departDate.replaceAll("-", "")
      )
        continue;
      done.add(p.id);
    }
    if (data.data.finish) {
      for (const id of ids)
        ctx.emit({
          type: "coverage",
          coverage: {
            programId: id,
            state: counts.get(id)
              ? "success"
              : done.has(id)
                ? "empty"
                : "error",
            source: "AwardTool",
            message: done.has(id)
              ? undefined
              : "The provider did not complete this program.",
          },
        });
      return;
    }
  }
  for (const id of ids)
    ctx.emit({
      type: "coverage",
      coverage: {
        programId: id,
        state: counts.get(id) ? "success" : done.has(id) ? "empty" : "error",
        source: "AwardTool",
        message: done.has(id)
          ? undefined
          : "The provider timed out; any returned results are shown.",
      },
    });
}
