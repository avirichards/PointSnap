import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { parseQuery, selectedPrograms } from "@/lib/award-search/query";
import { hasPaidProvider, runSearch } from "@/lib/award-search/engine";
import { allowSearch } from "@/lib/award-search/limit";
import { currentUser } from "@/lib/supabase/server";
import type { AwardEvent } from "@/lib/award-search/types";
export const runtime = "nodejs";
export const maxDuration = 210;
export async function GET(req: NextRequest) {
  let query, ids;
  try {
    query = parseQuery(req.nextUrl.searchParams);
    ids = selectedPrograms(req.nextUrl.searchParams);
  } catch {
    return Response.json(
      {
        message:
          "Choose two different airports, valid travel dates, and 1–9 passengers.",
      },
      { status: 400 },
    );
  }
  const paid = hasPaidProvider();
  const user = await currentUser();
  if (paid && !user)
    return Response.json(
      { message: "Sign in to search connected award-data services." },
      { status: 401 },
    );
  const identity =
    user?.id ??
    createHash("sha256")
      .update(req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local")
      .digest("hex")
      .slice(0, 24);
  try {
    if (!(await allowSearch(identity, paid)))
      return Response.json(
        { message: "Search limit reached. Please try again in 10 minutes." },
        { status: 429 },
      );
  } catch {
    return Response.json(
      { message: "Search is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
  const cancel = new AbortController();
  const signal = AbortSignal.any([
    req.signal,
    cancel.signal,
    // Smiles quotes every itinerary's taxes and payment choices sequentially.
    AbortSignal.timeout(ids.includes("G3_GOL_SMILES") ? 200000 : 110000),
  ]);
  const started = Date.now();
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AwardEvent) => {
        if (!closed && !signal.aborted)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
      };
      const heartbeat = setInterval(() => {
        if (!closed && !signal.aborted)
          controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 10000);
      try {
        await runSearch(ids, { query, signal, emit });
        if (!signal.aborted)
          emit({ type: "complete", durationMs: Date.now() - started });
      } catch {
        if (!signal.aborted)
          emit({
            type: "error",
            message:
              "Search interrupted. Results already received remain available.",
          });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          if (signal.aborted && !req.signal.aborted)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", message: "Search timed out. Results already received remain available." })}\n\n`,
              ),
            );
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      cancel.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
