/**
 * Phase 2.5 — POST /api/auth/airline/finalize
 *
 * Tears down a worker auth session. The worker captures cookies (if it
 * has them) and stores the encrypted blob in `program_auth_sessions`;
 * `state` distinguishes user-cancelled from cockpit-detected completion.
 *
 * Idempotent on the worker side — safe to call from the modal's cleanup
 * hook even if the modal already finalized via the captured branch.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

interface FinalizeBody {
  sessionId?: string;
  state?: "cancelled" | "completed";
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

  if (
    typeof body.sessionId !== "string" ||
    !["cancelled", "completed"].includes(body.state ?? "")
  ) {
    return Response.json(
      { message: "sessionId + state ('cancelled'|'completed') required" },
      { status: 400 },
    );
  }

  const url = `${base.replace(/\/$/, "")}/auth/finalize`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: body.sessionId,
        state: body.state,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    return Response.json(
      { message: "worker /auth/finalize not yet deployed" },
      { status: 501 },
    );
  }

  if (!res.ok) {
    return Response.json(
      { message: `worker returned ${res.status}` },
      { status: res.status },
    );
  }

  return Response.json({ ok: true });
}
