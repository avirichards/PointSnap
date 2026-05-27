/**
 * Phase 2.5 — GET /api/auth/airline/connected
 *
 * Lists the current user's saved auth sessions (one row per program). The
 * worker is the source of truth (it owns the encrypted cookie blob); this
 * route proxies through with the resolved user identity.
 *
 * The worker's `/auth/connected` takes the user UUID as a `user_id` query
 * param. User identity isn't wired to a real auth layer yet — `resolveUserId`
 * centralizes that gap (see `_userId.ts`): it reads an explicit `userId`
 * (future auth path) or the `POINTSNAP_AUTH_DEV_USER_ID` dev fallback.
 *
 * When no user can be resolved we return an empty list (not a 401) so the
 * `/airlines` page renders every program in "not connected" state cleanly
 * — the page is informational even when signed out.
 */
import type { NextRequest } from "next/server";
import { resolveUserId } from "../_userId";

export const runtime = "nodejs";

interface WorkerConnectedResponse {
  rows: Array<{
    program_id: string;
    expires_at: string;
    last_used_at: string | null;
    last_search_ok: boolean | null;
  }>;
}

export async function GET(req: NextRequest) {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) {
    return Response.json(
      { message: "PYTHON_WORKER_URL not configured" },
      { status: 501 },
    );
  }

  const userId = resolveUserId(req);
  if (!userId) {
    // No identity yet — render the catalog as all-unconnected.
    return Response.json([]);
  }

  const url =
    `${base.replace(/\/$/, "")}/auth/connected?` +
    new URLSearchParams({ user_id: userId }).toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    return Response.json(
      { message: "worker /auth/connected not yet deployed" },
      { status: 501 },
    );
  }

  if (!res.ok) {
    return Response.json(
      { message: `worker returned ${res.status}` },
      { status: res.status },
    );
  }

  const json = (await res.json()) as WorkerConnectedResponse;
  // Snake_case → camelCase for the cockpit's consistency with the rest of
  // the search payload (see src/lib/types.ts).
  return Response.json(
    (json.rows ?? []).map((r) => ({
      programId: r.program_id,
      expiresAt: r.expires_at,
      lastUsedAt: r.last_used_at,
      lastSearchOk: r.last_search_ok,
    })),
  );
}
