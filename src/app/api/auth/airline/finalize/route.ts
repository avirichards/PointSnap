/**
 * Phase 2.5 — POST /api/auth/airline/finalize
 *
 * Tears down a worker auth session. The worker captures cookies (if it has
 * them) and stores the encrypted blob in `program_auth_sessions`.
 *
 * The cockpit sends `{ sessionId, state }` where `state` is "completed" or
 * "cancelled". The worker's `/auth/finalize` takes QUERY params:
 *   - `session_id` (required)
 *   - `force_capture` (0|1) — when the user explicitly clicks "I'm done"
 *     but the post-login URL never matched a known success substring, we
 *     ask the worker to capture cookies anyway. We map state==="completed"
 *     → force_capture=1 (best-effort last-chance capture); "cancelled" →
 *     force_capture=0 (just tear down).
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

  // completed → last-chance force capture; cancelled → plain teardown.
  const forceCapture = body.state === "completed" ? "1" : "0";
  const url =
    `${base.replace(/\/$/, "")}/auth/finalize?` +
    new URLSearchParams({
      session_id: body.sessionId,
      force_capture: forceCapture,
    }).toString();

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
    return Response.json({ ok: true, note: "session already gone" });
  }

  if (!res.ok) {
    return Response.json(
      { message: `worker returned ${res.status}` },
      { status: res.status },
    );
  }

  const json = (await res.json()) as {
    state?: string;
    stored_row_id?: string | null;
  };
  return Response.json({
    ok: true,
    state: json.state,
    storedRowId: json.stored_row_id ?? null,
  });
}
