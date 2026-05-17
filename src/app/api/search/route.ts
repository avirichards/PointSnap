import type { NextRequest } from "next/server";
import {
  groupedMockResults,
  MOCK_PROGRAMS_AT_LAUNCH,
} from "@/lib/mockSearch";
import type {
  SearchQuery,
  SearchResultRow,
  SearchStreamEvent,
} from "@/lib/types";

export const runtime = "nodejs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function send(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: SearchStreamEvent,
) {
  controller.enqueue(
    new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
  );
}

/**
 * Programs served by the Python worker bridge (see python-workers/).
 * For these the route does a real HTTP call to ${PYTHON_WORKER_URL}/search
 * instead of emitting from the mock dataset; if the env var is unset or the
 * call fails, the program falls back to the mock so the cockpit never goes
 * blank for it. Day-1: only Virgin Atlantic, hard-coded JFK→LHR response.
 */
const WORKER_PROGRAMS = new Set<string>(["VS_FLYING_CLUB"]);

async function fetchWorkerResults(
  programId: string,
  query: SearchQuery,
): Promise<SearchResultRow[]> {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) throw new Error("PYTHON_WORKER_URL unset");
  const url = new URL("/search", base);
  url.searchParams.set("program", programId);
  url.searchParams.set("origin", query.origin);
  url.searchParams.set("dest", query.dest);
  url.searchParams.set("date", query.departDate);
  url.searchParams.set("pax", String(query.pax));
  url.searchParams.set("minCabin", query.minCabin);
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Worker ${programId} returned ${res.status}`);
  }
  const body = (await res.json()) as { rows?: SearchResultRow[] };
  return body.rows ?? [];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query: SearchQuery = {
    origin: (searchParams.get("origin") ?? "JFK").toUpperCase(),
    dest: (searchParams.get("dest") ?? "NRT").toUpperCase(),
    departDate:
      searchParams.get("departDate") ??
      new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
    returnDate: searchParams.get("returnDate") ?? undefined,
    pax: Math.max(1, Number(searchParams.get("pax") ?? "1")),
    minCabin: (searchParams.get("minCabin") ?? "Y") as SearchQuery["minCabin"],
  };

  const grouped = groupedMockResults(query);
  const programs = MOCK_PROGRAMS_AT_LAUNCH.filter((p) => grouped.has(p));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const start = Date.now();
      const searchId = `s_${start.toString(36)}`;

      send(controller, {
        type: "meta",
        searchId,
        programs: [...MOCK_PROGRAMS_AT_LAUNCH],
        pax: query.pax,
      });

      // Per-program latencies modeled on the architecture doc's p95 budgets:
      // easy curl_cffi <2s, login curl_cffi <4s, mixed <6s, Patchright <9s, AC <11s
      const latencyMs: Record<string, number> = {
        VS_FLYING_CLUB: 600,
        AS_MILEAGEPLAN: 900,
        BA_AVIOS: 1100,
        AV_LIFEMILES: 1300,
        AF_FLYINGBLUE: 1600,
        UA_MP: 2200,
        TK_MILES_SMILES: 2800,
        NH_ANA: 3400,
        AA_AADVANTAGE: 4800,
        DL_SKYMILES: 5500,
        CX_CATHAY: 6800,
        AC_AEROPLAN: 9200,
        LH_MILES_MORE: 10800,
      };

      const tasks = MOCK_PROGRAMS_AT_LAUNCH.map(async (programId) => {
        // Real worker path — Python bridge handles the scrape (hard-coded
        // for day-1) and returns rows in SearchResultRow shape. Fall back
        // to mock on missing env var or any worker error so the cockpit
        // stays populated even if the worker is down.
        if (WORKER_PROGRAMS.has(programId) && process.env.PYTHON_WORKER_URL) {
          try {
            const rows = await fetchWorkerResults(programId, query);
            if (rows.length > 0) {
              send(controller, { type: "partial", programId, rows });
            }
            send(controller, {
              type: "program_done",
              programId,
              status: rows.length > 0 ? "success" : "partial",
            });
            return;
          } catch (err) {
            console.error(`Worker call for ${programId} failed:`, err);
            send(controller, {
              type: "program_done",
              programId,
              status: "failed",
            });
            return;
          }
        }

        await sleep(latencyMs[programId] ?? 3000);
        const rows = grouped.get(programId);
        if (rows && rows.length > 0) {
          send(controller, { type: "partial", programId, rows });
        }
        send(controller, {
          type: "program_done",
          programId,
          status: rows && rows.length > 0 ? "success" : "partial",
        });
      });

      // Shadow-confirm upgrade waves — simulate Temporal saga results landing
      // 3-5s after each scrape, bumping confidence for top results. Skip the
      // worker-backed programs: their rows aren't in the mock map, so the
      // simulated confidence bump would fire against an unknown resultId.
      const shadowTask = (async () => {
        for (const programId of programs) {
          if (WORKER_PROGRAMS.has(programId)) continue;
          await sleep((latencyMs[programId] ?? 3000) + 3500);
          const rows = grouped.get(programId);
          if (!rows) continue;
          // bump confidence on the top row of each program
          const top = rows[0];
          if (top && top.confidenceScore < 90) {
            const newScore = Math.min(96, top.confidenceScore + 12);
            send(controller, {
              type: "confidence_update",
              resultId: top.id,
              newScore,
              reason: "shadow_confirm",
            });
          }
        }
      })();

      await Promise.all([...tasks, shadowTask]);

      const totalRows = [...grouped.values()].reduce(
        (acc, list) => acc + list.length,
        0,
      );
      send(controller, {
        type: "complete",
        totalRows,
        durationMs: Date.now() - start,
      });
      controller.close();
    },
    cancel() {
      // Client disconnected — nothing to clean up for mock.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
