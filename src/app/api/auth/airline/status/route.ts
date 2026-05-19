/**
 * Phase 2.5 — GET /api/auth/airline/status?sessionId=...
 *
 * Short-poll wrapper around the worker's `/auth/status`. Polled every 2s
 * by ConnectAirlineModal. Returns 501 if the worker endpoint doesn't
 * exist yet so the UI can render "service unavailable" cleanly.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

interface WorkerStatusResponse {
  state: "awaiting_login" | "captured" | "expired" | "failed";
  error?: string;
  cookies_expire_at?: string;
}

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

  const url = `${base.replace(/\/$/, "")}/auth/status?session_id=${encodeURIComponent(sessionId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    return Response.json(
      { message: "worker /auth/status not yet deployed" },
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

  const json = (await res.json()) as WorkerStatusResponse;
  return Response.json({
    state: json.state,
    error: json.error,
    cookiesExpireAt: json.cookies_expire_at,
  });
}
