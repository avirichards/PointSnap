/**
 * Phase 2.5 — POST /api/auth/airline/start
 *
 * Proxies to the worker's `/auth/start` endpoint. The worker spins up a
 * fresh BD Browser API session and returns the live-view URL the cockpit
 * embeds in an iframe. The worker URL stays server-side (env-only).
 *
 * If `PYTHON_WORKER_URL` isn't set, or the worker doesn't yet expose
 * `/auth/start`, we return 501 so the client can render a friendly
 * "not yet deployed" banner instead of a generic error.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

interface StartBody {
  programId?: string;
}

interface WorkerStartResponse {
  session_id: string;
  live_view_url: string;
  expires_at: string;
}

export async function POST(req: NextRequest) {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) {
    return Response.json(
      { message: "PYTHON_WORKER_URL not configured" },
      { status: 501 },
    );
  }

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return Response.json({ message: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.programId !== "string" || body.programId.length === 0) {
    return Response.json({ message: "programId required" }, { status: 400 });
  }

  const url = `${base.replace(/\/$/, "")}/auth/start`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ program_id: body.programId }),
      // /auth/start spins up a browser context — can be slow on cold start
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    return Response.json(
      { message: "worker /auth/start not yet deployed" },
      { status: 501 },
    );
  }

  if (!res.ok) {
    let detail = `worker returned ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string; message?: string };
      detail = j.detail ?? j.message ?? detail;
    } catch {
      // Body wasn't JSON.
    }
    return Response.json({ message: detail }, { status: res.status });
  }

  const json = (await res.json()) as WorkerStartResponse;
  return Response.json({
    sessionId: json.session_id,
    liveViewUrl: json.live_view_url,
    expiresAt: json.expires_at,
  });
}
