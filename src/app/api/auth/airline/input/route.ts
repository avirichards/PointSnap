/**
 * Phase 2.5 — POST /api/auth/airline/input?sessionId=...
 *
 * Proxies a batch of cockpit input events to the worker's `/auth/input`,
 * which dispatches them onto the live BD browser session via CDP
 * `Input.dispatch{Mouse,Key}Event` / `Input.insertText`.
 *
 * The cockpit's `<LiveSessionView>` captures mouse + keyboard events on its
 * canvas, coalesces rapid moves, and POSTs `{ events: [...] }` here. We
 * forward the body verbatim — the worker validates each event shape.
 *
 * Kept deliberately thin + fast: this is on the interaction hot path, so a
 * short timeout and minimal translation matter.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const base = process.env.PYTHON_WORKER_URL;
  if (!base) {
    return Response.json(
      { message: "PYTHON_WORKER_URL not configured" },
      { status: 501 },
    );
  }

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ message: "sessionId required" }, { status: 400 });
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return Response.json({ message: "invalid body" }, { status: 400 });
  }

  const url = `${base.replace(/\/$/, "")}/auth/input?session_id=${encodeURIComponent(sessionId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker fetch failed";
    return Response.json({ message }, { status: 502 });
  }

  if (res.status === 404) {
    return Response.json(
      { message: "worker /auth/input not deployed" },
      { status: 501 },
    );
  }

  if (!res.ok) {
    return Response.json(
      { message: `worker returned ${res.status}` },
      { status: res.status },
    );
  }

  const json = (await res.json()) as { dispatched?: number };
  return Response.json({ ok: true, dispatched: json.dispatched ?? 0 });
}
