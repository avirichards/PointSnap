/**
 * POST /api/auth/airline/start
 *
 * Proxies to the worker's `/auth/start` endpoint. The worker spins up a
 * fresh browser session, navigates to the airline's login page, and fills
 * in the credentials the cockpit forwarded. It returns the session id +
 * the initial state; the cockpit then polls `/auth/status`.
 *
 * The worker URL stays server-side (env-only). The worker takes `program`
 * and `user_id` as QUERY params and the credentials as a JSON body — so
 * this route resolves the user, builds the query string, and forwards
 * `{username,password}` as the request body. The password is never placed
 * in a URL and never logged.
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
  username?: string;
  password?: string;
  userId?: string;
}

interface WorkerStartResponse {
  session_id: string;
  program_id?: string;
  program_label?: string;
  state?: string;
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
  if (typeof body.username !== "string" || body.username.length === 0) {
    return Response.json({ message: "username required" }, { status: 400 });
  }
  if (typeof body.password !== "string" || body.password.length === 0) {
    return Response.json({ message: "password required" }, { status: 400 });
  }

  const userId = resolveUserId(req, body.userId);
  if (!userId) return noUserResponse();

  // Worker takes program + user_id as QUERY params; credentials in the body.
  const url =
    `${base.replace(/\/$/, "")}/auth/start?` +
    new URLSearchParams({ program: body.programId, user_id: userId }).toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: body.username,
        password: body.password,
      }),
      // /auth/start spins up a browser context — slow on cold start.
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
    state: json.state ?? "working",
    expiresAt: json.expires_at,
  });
}
