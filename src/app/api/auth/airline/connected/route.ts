/**
 * Phase 2.5 — GET /api/auth/airline/connected
 *
 * Lists the current user's saved auth sessions (one row per program).
 * The worker is the source of truth (it owns the encrypted cookie blob);
 * this route proxies through with the user identity from the session.
 *
 * For now the user identity isn't wired through (Clerk auth shell isn't
 * complete — see src/app/sign-in/page.tsx). Once Clerk is live, this
 * route should forward `userId` from `auth()` to the worker as a header
 * or query param. Until then we proxy unauthenticated and the worker
 * returns an empty list.
 */
export const runtime = "nodejs";

interface WorkerConnectedResponse {
  rows: Array<{
    program_id: string;
    expires_at: string;
    last_used_at: string | null;
    last_search_ok: boolean | null;
  }>;
}

export async function GET() {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) {
    return Response.json(
      { message: "PYTHON_WORKER_URL not configured" },
      { status: 501 },
    );
  }

  const url = `${base.replace(/\/$/, "")}/auth/connected`;
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
    json.rows.map((r) => ({
      programId: r.program_id,
      expiresAt: r.expires_at,
      lastUsedAt: r.last_used_at,
      lastSearchOk: r.last_search_ok,
    })),
  );
}
