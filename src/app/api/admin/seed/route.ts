import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One-shot seed endpoint. Hit once after legacy database migrations have been applied.
 * Idempotent — safe to re-run; all inserts use ON CONFLICT DO NOTHING.
 *
 * Auth: `Authorization: Bearer <SEED_TOKEN>` must match env var `SEED_TOKEN`.
 * If SEED_TOKEN is not set in the environment, the endpoint returns 503 and
 * refuses to run (fail-safe). Set SEED_TOKEN in Vercel env vars before calling.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expected = process.env.SEED_TOKEN;

  if (!expected) {
    return NextResponse.json(
      { error: "SEED_TOKEN not configured. Set it in Vercel env vars first." },
      { status: 503 },
    );
  }
  if (
    Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Dynamically import so the seed code (and its postgres-js connection) isn't
  // pulled into every other route's bundle.
  const { runSeed } = await import("@/db/seed/run");

  try {
    const summary = await runSeed();
    return NextResponse.json({ ok: true, summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[seed] failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
