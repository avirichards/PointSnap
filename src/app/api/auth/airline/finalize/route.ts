/**
 * POST /api/auth/airline/finalize
 *
 * Tears down a worker auth session — the cockpit calls this when the
 * connect modal closes or is cancelled. The worker shuts down the browser
 * session it was driving.
 *
 * The cockpit sends `{ sessionId }`. The worker's `/auth/finalize` takes
 * `session_id` as a QUERY param.
 *
 * Idempotent on the worker side — safe to call from the modal's cleanup
 * hook even if the session already finished (captured / failed / expired).
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

interface FinalizeBody {
  sessionId?: string;
}

export async function POST(req: NextRequest) {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) {
    return Response.json(
      { message: "PYTHON_WORKER_URL not configured" },
      { status: 501 },
    );
  }

  let body: FinalizeBody;
  try {
    body = (await req.json()) as FinalizeBody;
  } catch {
    return Response.json({ message: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return Response.json({ message: "sessionId required" }, { status: 400 });
  }

  const url =
    `${base.replace(/\/$/, "")}/auth/finalize?` +
    new URLSearchParams({ session_id: body.sessionId }).toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    // 404 from /auth/finalize means the session id is unknown to the
    // worker (already torn down / never existed). That's a benign no-op
    // for the cockpit's cleanup hook — report ok rather than an error.
    return Response.json({ ok: true });
  }

  if (!res.ok) {
    return Response.json(
      { message: `worker returned ${res.status}` },
      { status: res.status },
    );
  }

  return Response.json({ ok: true });
}
