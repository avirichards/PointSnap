import { noUserResponse, resolveUserId } from "../_userId";
import { workerHeaders, workerConfigured } from "@/lib/worker";
/**
 * GET /api/auth/airline/status?sessionId=...
 *
 * Short-poll wrapper around the worker's `/auth/status`. Polled every ~2s
 * by ConnectAirlineModal. Returns 501 if the worker endpoint doesn't exist
 * yet so the UI can render "service unavailable" cleanly.
 *
 * The worker takes `session_id` as a query param and returns snake_case;
 * we translate to camelCase for the cockpit, including the MFA prompt text
 * and the context screenshot.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

interface WorkerStatusResponse {
  session_id?: string;
  program_id?: string;
  state:
    | "working"
    | "mfa_required"
    | "captured"
    | "invalid_credentials"
    | "failed"
    | "expired";
  current_url?: string | null;
  mfa_prompt?: string | null;
  screenshot_b64?: string | null;
  stored_row_id?: string | null;
  error?: string | null;
  expires_at_unix?: number;
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return noUserResponse();
  const base = process.env.PYTHON_WORKER_URL;
  if (!base || !workerConfigured()) {
    return Response.json(
      { message: "Airline services are not configured yet." },
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
      headers: workerHeaders(userId),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    // Worker returns 404 both when the route is missing AND when the
    // session id is unknown. Tell them apart by body shape: the worker's
    // unknown-session 404 carries an `error` field; FastAPI's missing-route
    // 404 carries `detail`.
    let unknownSession = false;
    try {
      const j = (await res.json()) as { error?: string };
      unknownSession = typeof j?.error === "string";
    } catch {
      // not JSON — treat as route-missing
    }
    if (unknownSession) {
      return Response.json({ state: "expired", error: "session_not_found" });
    }
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
    currentUrl: json.current_url ?? null,
    mfaPrompt: json.mfa_prompt ?? null,
    screenshotB64: json.screenshot_b64 ?? null,
    storedRowId: json.stored_row_id ?? null,
    error: json.error ?? null,
  });
}
