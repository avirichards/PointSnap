/**
 * Phase 2.5 — POST /api/auth/airline/start
 *
 * Proxies to the worker's `/auth/start` endpoint. The worker spins up a
 * fresh BD Browser API session, navigates to the airline's login page, and
 * returns the session id + a same-origin live-view URL the cockpit renders
 * as a screenshot stream (see ConnectAirlineModal / LiveSessionView).
 *
 * The worker URL stays server-side (env-only). The worker takes its params
 * as QUERY params (`program`, `user_id`) — not a JSON body — so this route
 * translates the cockpit's JSON body into the worker's query string.
 *
 * If `PYTHON_WORKER_URL` isn't set, or the worker doesn't yet expose
 * `/auth/start`, we return 501 so the client renders a friendly "not yet
 * deployed" banner instead of a generic error.
 */
import type { NextRequest } from "next/server";
import { noUserResponse, resolveUserId } from "../_userId";

export const runtime = "nodejs";

interface StartBody {
  programId?: string;
  userId?: string;
}

interface WorkerStartResponse {
  session_id: string;
  live_view_url: string;
  live_view_available?: boolean;
  live_view_kind?: string;
  viewport?: { w: number; h: number };
  expires_at: string;
  current_url?: string | null;
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

  const userId = resolveUserId(req, body.userId);
  if (!userId) return noUserResponse();

  // Worker takes program + user_id as QUERY params.
  const url =
    `${base.replace(/\/$/, "")}/auth/start?` +
    new URLSearchParams({ program: body.programId, user_id: userId }).toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      // /auth/start spins up a BD browser context — slow on cold start.
      signal: AbortSignal.timeout(90_000),
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
    liveViewAvailable: json.live_view_available ?? false,
    liveViewKind: json.live_view_kind ?? "stream",
    viewport: json.viewport ?? { w: 1366, h: 768 },
    expiresAt: json.expires_at,
    currentUrl: json.current_url ?? null,
  });
}
