/**
 * POST /api/auth/airline/mfa
 *
 * Submits the MFA code the airline asked for. The worker types the code
 * into the airline's MFA form and resumes the login; the cockpit then goes
 * back to polling `/auth/status`.
 *
 * The cockpit sends `{ sessionId, code }`. The worker's `/auth/mfa` takes
 * `session_id` as a QUERY param and the code as a JSON body — the code is
 * never placed in a URL and never logged.
 *
 * The worker returns `{ ok: true }` on accept, or `409 { error }` when the
 * code can't be submitted (wrong code, session no longer at MFA, etc.). We
 * surface the 409 as a 409 with a `message` so the client can show it.
 *
 * Returns 501 if the worker endpoint doesn't exist yet so the UI can render
 * "service unavailable" cleanly.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

interface MfaBody {
  sessionId?: string;
  code?: string;
}

export async function POST(req: NextRequest) {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) {
    return Response.json(
      { message: "PYTHON_WORKER_URL not configured" },
      { status: 501 },
    );
  }

  let body: MfaBody;
  try {
    body = (await req.json()) as MfaBody;
  } catch {
    return Response.json({ message: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return Response.json({ message: "sessionId required" }, { status: 400 });
  }
  if (typeof body.code !== "string" || body.code.length === 0) {
    return Response.json({ message: "code required" }, { status: 400 });
  }

  const url =
    `${base.replace(/\/$/, "")}/auth/mfa?` +
    new URLSearchParams({ session_id: body.sessionId }).toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: body.code }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    // 404 = missing route OR unknown session. The worker's unknown-session
    // 404 carries an `error` field; FastAPI's missing-route 404 carries
    // `detail`.
    let unknownSession = false;
    try {
      const j = (await res.json()) as { error?: string };
      unknownSession = typeof j?.error === "string";
    } catch {
      // not JSON — treat as route-missing
    }
    if (unknownSession) {
      return Response.json(
        { message: "This login session expired — please reconnect." },
        { status: 409 },
      );
    }
    return Response.json(
      { message: "worker /auth/mfa not yet deployed" },
      { status: 501 },
    );
  }

  if (!res.ok) {
    // 409 (and any other failure) → bubble up the worker's `error` text as
    // `message` so the cockpit can show it inline next to the code field.
    let detail = `worker returned ${res.status}`;
    try {
      const j = (await res.json()) as {
        error?: string;
        detail?: string;
        message?: string;
      };
      detail = j.error ?? j.detail ?? j.message ?? detail;
    } catch {
      // Body wasn't JSON.
    }
    return Response.json({ message: detail }, { status: res.status });
  }

  return Response.json({ ok: true });
}
