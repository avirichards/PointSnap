import type { NextRequest } from "next/server";
import {
  groupedMockResults,
  MOCK_PROGRAMS_AT_LAUNCH,
} from "@/lib/mockSearch";
import type { SearchQuery, SearchStreamEvent } from "@/lib/types";

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
      // 3-5s after each scrape, bumping confidence for top results
      const shadowTask = (async () => {
        for (const programId of programs) {
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
