import type { NextRequest } from "next/server";
import {
  groupedMockResults,
  MOCK_PROGRAMS_AT_LAUNCH,
} from "@/lib/mockSearch";
import { itineraryHash, operatingFlightKey } from "@/lib/itineraryHash";
import { chartFallback } from "@/lib/chartFallback";
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
 * Hard-coded VS Flying Club result for JFK→LHR. Day-1 proof that the
 * cockpit can render a "real-scrape-shaped" row alongside the mock
 * dataset before the actual Patchright scraper lands in session 5+.
 *
 * The Python plugin equivalent lives at `python-workers/vs/search.py` —
 * keep them in sync until session 5 replaces this with real scrape
 * output. Returns null for any non-JFK→LHR query so the cockpit falls
 * back to the mock VS row (JFK→NRT).
 *
 * Schedule modeled on VS3 (B789): JFK 18:30 EDT → LHR 06:15 BST next
 * day (22:30Z → 05:15Z+1, ~6h45m). Cabin prices reflect the real VS
 * one-way chart (Y 10k + $420 YQ, J 47.5k + $720 YQ).
 */
function vsHardcodedRow(query: SearchQuery): SearchResultRow | null {
  if (query.origin !== "JFK" || query.dest !== "LHR") return null;

  const depart = new Date(`${query.departDate}T22:30:00Z`);
  const arrive = new Date(depart.getTime() + (6 * 60 + 45) * 60_000);

  const segment = {
    segmentOrder: 0,
    operatingAirlineIata: "VS",
    marketingAirlineIata: "VS",
    flightNumber: "3",
    originIata: "JFK",
    destIata: "LHR",
    departAt: depart.toISOString(),
    arriveAt: arrive.toISOString(),
    aircraftIcao: "B789",
    segmentCabin: "J" as const,
    fareClass: "I",
  };

  const hash = itineraryHash({
    programId: "VS_FLYING_CLUB",
    pax: query.pax,
    departDate: query.departDate,
    segments: [segment],
  });

  const now = new Date().toISOString();

  return {
    id: `VS_FLYING_CLUB_${hash.slice(0, 12)}`,
    itineraryHash: hash,
    programId: "VS_FLYING_CLUB",
    programName: "Virgin Atlantic",
    originIata: "JFK",
    destIata: "LHR",
    departDate: query.departDate,
    arriveDate: arrive.toISOString().slice(0, 10),
    totalDurationMin: 6 * 60 + 45,
    numSegments: 1,
    segments: [segment],
    cabinPrices: {
      Y: {
        cabin: "Y",
        seatsRemaining: 9,
        milesPerPax: 10_000,
        surchargeUsdPerPax: 420,
        taxesUsdPerPax: 51,
        cppMicroAtObs: null,
      },
      J: {
        cabin: "J",
        seatsRemaining: 4,
        milesPerPax: 47_500,
        surchargeUsdPerPax: 720,
        taxesUsdPerPax: 51,
        cppMicroAtObs: null,
      },
    },
    confidenceScore: 72,
    observedAt: now,
    lastSeenAt: now,
    operatingFlightKey: operatingFlightKey("VS", "3", segment.departAt),
  };
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
  const vsReal = vsHardcodedRow(query);

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

      // Track chart-only rows for the final totalRows count.
      let chartFallbackCount = 0;

      const tasks = MOCK_PROGRAMS_AT_LAUNCH.map(async (programId) => {
        await sleep(latencyMs[programId] ?? 3000);

        // VS gets the hard-coded "real-shape" row when JFK→LHR is searched;
        // otherwise falls through to the mock dataset like every other program.
        if (programId === "VS_FLYING_CLUB" && vsReal) {
          send(controller, { type: "partial", programId, rows: [vsReal] });
          send(controller, {
            type: "program_done",
            programId,
            status: "success",
          });
          return;
        }

        const rows = grouped.get(programId);
        if (rows && rows.length > 0) {
          send(controller, { type: "partial", programId, rows });
          send(controller, { type: "program_done", programId, status: "success" });
          return;
        }

        // No mock data for this program × route — try the chart fallback so
        // the cockpit can show a "Chart-only" estimate instead of nothing.
        try {
          const fb = await chartFallback({
            programId,
            origin: query.origin,
            dest: query.dest,
            departDate: query.departDate,
            pax: query.pax,
          });
          if (fb) {
            chartFallbackCount++;
            send(controller, { type: "partial", programId, rows: [fb] });
            send(controller, {
              type: "program_done",
              programId,
              status: "success",
            });
            return;
          }
        } catch {
          // DB unavailable or schema error — fall through to partial status.
        }

        send(controller, { type: "program_done", programId, status: "partial" });
      });

      // Shadow-confirm upgrade waves — simulate Temporal saga results landing
      // 3-5s after each scrape, bumping confidence for top results.
      const shadowTask = (async () => {
        for (const programId of programs) {
          // Skip VS when we shipped the inline hard-coded row — the simulated
          // confidence bump would fire against an unknown resultId.
          if (programId === "VS_FLYING_CLUB" && vsReal) continue;
          await sleep((latencyMs[programId] ?? 3000) + 3500);
          const rows = grouped.get(programId);
          if (!rows) continue;
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

      const mockRows = [...grouped.values()].reduce(
        (acc, list) => acc + list.length,
        0,
      );
      send(controller, {
        type: "complete",
        totalRows: mockRows + (vsReal ? 1 : 0) + chartFallbackCount,
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
