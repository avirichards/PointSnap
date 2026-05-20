/**
 * Phase 4 — GET /api/programs-meta
 *
 * Server-side proxy to the worker's `/programs/meta` endpoint. Keeps
 * `PYTHON_WORKER_URL` off the client (same pattern as `/api/search` and
 * `/api/auth/airline/*`).
 *
 * The cockpit's search-form date picker calls this to learn each
 * program's award booking window (max days from today a search is
 * valid) and greys out clearly out-of-window dates.
 *
 * Degrades gracefully: if the worker URL isn't configured or the
 * endpoint isn't deployed, returns an empty program list so the picker
 * simply falls back to an unbounded calendar instead of erroring.
 */
export const runtime = "nodejs";

/** Worker `/programs/meta` response shape (already camelCase). */
interface WorkerProgramsMeta {
  programs: Array<{ programId: string; maxDaysOut: number }>;
  defaultMaxDaysOut: number;
}

/** Fallback used whenever the worker can't answer — unbounded calendar. */
const EMPTY: WorkerProgramsMeta = { programs: [], defaultMaxDaysOut: 330 };

const HEADERS = {
  "Content-Type": "application/json",
  // Booking windows shift at most once in a blue moon; cache hard at the
  // edge so the picker doesn't round-trip the worker on every page load.
  "Cache-Control":
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
} as const;

export async function GET() {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) {
    return Response.json(EMPTY, { headers: HEADERS });
  }

  const url = `${base.replace(/\/$/, "")}/programs/meta`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Worker offline / DNS / timeout — fall back to an unbounded calendar.
    return Response.json(EMPTY, { headers: HEADERS });
  }

  if (!res.ok) {
    // 404 (endpoint not deployed yet) or any 5xx — same graceful fallback.
    return Response.json(EMPTY, { headers: HEADERS });
  }

  let json: WorkerProgramsMeta;
  try {
    json = (await res.json()) as WorkerProgramsMeta;
  } catch {
    return Response.json(EMPTY, { headers: HEADERS });
  }

  // Defensive: only forward a well-formed payload.
  if (!Array.isArray(json.programs)) {
    return Response.json(EMPTY, { headers: HEADERS });
  }

  return Response.json(
    {
      programs: json.programs,
      defaultMaxDaysOut:
        typeof json.defaultMaxDaysOut === "number"
          ? json.defaultMaxDaysOut
          : EMPTY.defaultMaxDaysOut,
    },
    { headers: HEADERS },
  );
}
