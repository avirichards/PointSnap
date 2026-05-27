import type { NextRequest } from "next/server";
import type {
  SearchQuery,
  SearchResultRow,
  SearchStreamEvent,
} from "@/lib/types";

export const runtime = "nodejs";

const PROGRAMS: readonly string[] = [
  "VS_FLYING_CLUB",
  "AS_MILEAGEPLAN",
  "BA_AVIOS",
  "AV_LIFEMILES",
  "AF_FLYINGBLUE",
  "UA_MP",
  "TK_MILES_SMILES",
  "NH_ANA",
  "AA_AADVANTAGE",
  "DL_SKYMILES",
  "CX_CATHAY",
  "AC_AEROPLAN",
  "LH_MILES_MORE",
] as const;

const WORKER_TIMEOUT_MS = 60_000;

async function fetchWorkerResults(
  programId: string,
  query: SearchQuery,
): Promise<SearchResultRow[]> {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) return [];
  const url =
    `${base.replace(/\/$/, "")}/search?` +
    new URLSearchParams({
      program: programId,
      origin: query.origin,
      dest: query.dest,
      date: query.departDate,
      pax: String(query.pax),
      minCabin: query.minCabin,
    }).toString();

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), WORKER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      console.warn(`worker ${programId} returned ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { rows?: SearchResultRow[] };
    return Array.isArray(json.rows) ? json.rows : [];
  } catch (err) {
    console.warn(`worker ${programId} fetch failed:`, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

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
    dest: (searchParams.get("dest") ?? "LHR").toUpperCase(),
    departDate:
      searchParams.get("departDate") ??
      new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
    returnDate: searchParams.get("returnDate") ?? undefined,
    pax: Math.max(1, Number(searchParams.get("pax") ?? "1")),
    minCabin: (searchParams.get("minCabin") ?? "Y") as SearchQuery["minCabin"],
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const start = Date.now();
      const searchId = `s_${start.toString(36)}`;

      send(controller, {
        type: "meta",
        searchId,
        programs: [...PROGRAMS],
        pax: query.pax,
      });

      let totalRows = 0;

      const tasks = PROGRAMS.map(async (programId) => {
        const rows = await fetchWorkerResults(programId, query);
        if (rows.length > 0) {
          totalRows += rows.length;
          send(controller, { type: "partial", programId, rows });
          send(controller, {
            type: "program_done",
            programId,
            status: "success",
          });
        } else {
          send(controller, {
            type: "program_done",
            programId,
            status: "partial",
          });
        }
      });

      await Promise.all(tasks);

      send(controller, {
        type: "complete",
        totalRows,
        durationMs: Date.now() - start,
      });
      controller.close();
    },
    cancel() {
      // Client disconnected — nothing to clean up.
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
