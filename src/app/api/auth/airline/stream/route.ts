/**
 * Phase 2.5 — GET /api/auth/airline/stream?sessionId=...
 *
 * Proxies the worker's `/auth/stream` Server-Sent-Events feed of the live
 * BD browser session. The worker pushes ~3 fps base64 JPEG frames (plus
 * url / state / bye events); the cockpit's `<LiveSessionView>` opens an
 * EventSource on this route and paints each frame onto a canvas.
 *
 * We proxy the SSE response body straight through (`res.body` is a
 * ReadableStream) so frames stream incrementally — no buffering. This is
 * the same transport the `/api/search` route uses, just relayed from the
 * worker rather than generated locally.
 *
 * Why a proxy at all (vs. the browser connecting to the worker directly):
 * the worker URL is server-side-only (`PYTHON_WORKER_URL`) and must not be
 * exposed to the client. Relaying through this route keeps it private and
 * keeps the live-view same-origin (no CORS / mixed-content concerns).
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
// Never cache or buffer a live stream.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) {
    return Response.json(
      { message: "PYTHON_WORKER_URL not configured" },
      { status: 501 },
    );
  }

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ message: "sessionId required" }, { status: 400 });
  }

  const url = `${base.replace(/\/$/, "")}/auth/stream?session_id=${encodeURIComponent(sessionId)}`;

  let res: Response;
  try {
    // Abort the upstream fetch when the browser disconnects (modal closed),
    // so the worker's frame loop sees the disconnect and stops capturing.
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal: req.signal,
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    return Response.json(
      { message: "worker /auth/stream not deployed" },
      { status: 501 },
    );
  }

  if (!res.ok || !res.body) {
    return Response.json(
      { message: `worker stream returned ${res.status}` },
      { status: res.status || 502 },
    );
  }

  // Relay the SSE body straight through.
  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
