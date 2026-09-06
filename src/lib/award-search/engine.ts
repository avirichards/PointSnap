import { directSearch, DIRECT_PROGRAMS } from "./direct";
import { SEATS_SOURCES, seatsSearch } from "./seats";
import { awardToolPrograms, awardToolSearch } from "./awardtool";
import { ProviderError, type ProviderContext, type AwardResult } from "./types";
import { CABIN_ORDER } from "@/lib/types";
import { SOURCE_INFO } from "./source-info";
import { browserPrograms, browserSearch } from "./browser";
export function hasPaidProvider() {
  return !!(process.env.SEATS_AERO_API_KEY || process.env.AWARDTOOL_API_KEY);
}
export function providerCoverage() {
  const at = process.env.AWARDTOOL_API_KEY ? awardToolPrograms() : [];
  return [
    ...new Set([
      ...DIRECT_PROGRAMS,
      ...browserPrograms(),
      ...at,
      ...(process.env.SEATS_AERO_API_KEY ? Object.keys(SEATS_SOURCES) : []),
    ]),
  ];
}
export function filterResults(
  rows: AwardResult[],
  ctx: Pick<ProviderContext, "query">,
) {
  const { query: q } = ctx;
  const accepts = (p: NonNullable<AwardResult["fares"]>[number]) =>
    Number.isFinite(p.points) &&
    p.points > 0 &&
    CABIN_ORDER.indexOf(p.cabin) >= CABIN_ORDER.indexOf(q.minCabin) &&
    (p.seats === null || p.seats >= q.pax);
  return rows
    .filter(
      (r) =>
        r.origin === q.origin &&
        r.destination === q.dest &&
        r.date === q.departDate,
    )
    .map((r) => ({
      ...r,
      fares: r.fares?.filter(accepts),
      calendarQuote:
        r.kind === "calendar" &&
        q.minCabin === "Y" &&
        r.calendarQuote &&
        Number.isFinite(r.calendarQuote.points) &&
        r.calendarQuote.points > 0 &&
        (r.calendarQuote.seats === null || r.calendarQuote.seats >= q.pax)
          ? r.calendarQuote
          : undefined,
      prices: Object.fromEntries(
        Object.entries(r.prices).filter(
          ([c, p]) =>
            p &&
            p.points > 0 &&
            Number.isFinite(p.points) &&
            CABIN_ORDER.indexOf(c as typeof q.minCabin) >=
              CABIN_ORDER.indexOf(q.minCabin) &&
            (p.seats === null || p.seats >= q.pax),
        ),
      ),
    }))
    .filter((r) => Object.keys(r.prices).length > 0 || !!r.calendarQuote);
}
export async function runSearch(ids: string[], ctx: ProviderContext) {
  if (ctx.signal.aborted) return;
  ctx.emit({ type: "meta", programs: ids });
  const browserIds = browserPrograms();
  const commercial: string[] = process.env.AWARDTOOL_API_KEY
    ? awardToolPrograms()
    : [];
  const batchIds = ids.filter(
    (id) =>
      !DIRECT_PROGRAMS.includes(id) &&
      !browserIds.includes(id) &&
      commercial.includes(id),
  );
  const singles = ids.filter((id) => !batchIds.includes(id));
  let index = 0;
  const report = (id: string, error: unknown) =>
    ctx.emit({
      type: "coverage",
      coverage: {
        programId: id,
        state: "error",
        message:
          error instanceof ProviderError
            ? error.message
            : "This program could not be reached. Try again shortly.",
      },
    });
  const singleWorker = async () => {
    while (index < singles.length && !ctx.signal.aborted) {
      const id = singles[index++];
      let source = "";
      let sourceNotice = "";
      if (
        !DIRECT_PROGRAMS.includes(id) &&
        !browserIds.includes(id) &&
        !(process.env.SEATS_AERO_API_KEY && SEATS_SOURCES[id])
      ) {
        ctx.emit({
          type: "coverage",
          coverage: {
            programId: id,
            state: "unavailable",
            message: "No live data connection is enabled for this program.",
          },
        });
        continue;
      }
      try {
        let rows: AwardResult[];
        if (browserIds.includes(id)) {
          source =
            id === "G3_GOL_SMILES"
              ? "Smiles · airline browser"
              : id === "DL_SKYMILES"
                ? "Delta · airline browser"
                : "American AAdvantage · direct airline";
          rows = await browserSearch(ctx.query, ctx.signal, id, (notice) => {
            sourceNotice = notice;
          });
        } else if (DIRECT_PROGRAMS.includes(id)) {
          try {
            source = "Direct airline";
            rows = await directSearch(id, ctx.query, ctx.signal, (early) => {
              const rows = filterResults(early, ctx);
              if (rows.length && !ctx.signal.aborted)
                ctx.emit({ type: "results", rows });
            });
          } catch (error) {
            if (ctx.signal.aborted) throw error;
            if (process.env.SEATS_AERO_API_KEY && SEATS_SOURCES[id]) {
              source = "Seats.aero";
              rows = await seatsSearch(id, ctx.query, ctx.signal);
            } else throw error;
          }
        } else {
          source = "Seats.aero";
          rows = await seatsSearch(id, ctx.query, ctx.signal);
        }
        rows = filterResults(rows, ctx);
        if (rows.length) ctx.emit({ type: "results", rows });
        ctx.emit({
          type: "coverage",
          coverage: {
            programId: id,
            state: rows.length ? "success" : "empty",
            source,
            message:
              source === "Direct airline" || browserIds.includes(id)
                ? [sourceNotice, SOURCE_INFO[id]?.detail]
                    .filter(Boolean)
                    .join(" ") || undefined
                : undefined,
            inventory:
              source === "Direct airline"
                ? (SOURCE_INFO[id]?.inventory ?? "flights")
                : "flights",
          },
        });
      } catch (error) {
        if (!ctx.signal.aborted) report(id, error);
      }
    }
  };
  const batchTask = batchIds.length
    ? awardToolSearch(batchIds, {
        ...ctx,
        emit: (e) =>
          ctx.emit(
            e.type === "results"
              ? { ...e, rows: filterResults(e.rows, ctx) }
              : e,
          ),
      }).catch((e) => {
        if (!ctx.signal.aborted) batchIds.forEach((id) => report(id, e));
      })
    : Promise.resolve();
  await Promise.all([
    batchTask,
    ...Array.from({ length: Math.min(4, singles.length) }, singleWorker),
  ]);
}
