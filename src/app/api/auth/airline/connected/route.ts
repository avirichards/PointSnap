import { workerHeaders, workerConfigured } from "@/lib/worker";
/** List legacy saved sessions using only the verified Supabase identity. */
import type { NextRequest } from "next/server";
import { noUserResponse, resolveUserId } from "../_userId";

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
  const userId = await resolveUserId(req);
  if (!userId) return noUserResponse();
  const base = process.env.PYTHON_WORKER_URL;
  if (!base || !workerConfigured()) {
    return Response.json(
      { message: "Airline services are not configured yet." },
      { status: 501 },
    );
  }

  const url =
    `${base.replace(/\/$/, "")}/auth/connected?` +
    new URLSearchParams({ user_id: userId }).toString();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: workerHeaders(userId),
      cache: "no-store",
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
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
