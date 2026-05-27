/**
 * Phase 2.5 — server-side user-identity resolver for the `/auth/airline/*`
 * proxy routes.
 *
 * The worker's `program_auth_sessions` table keys every saved session by a
 * Supabase `auth.users(id)` UUID — the worker REQUIRES a valid UUID on
 * `/auth/start` and `/auth/connected`. The cockpit, however, does not yet
 * have an auth system wired (no Clerk middleware, no Supabase auth client —
 * see `src/app/sign-in/page.tsx`, still in shell mode). So there is no
 * real per-request user identity to forward yet.
 *
 * This helper centralizes that gap in ONE place so the four proxy routes
 * don't each reinvent it. Resolution order:
 *
 *   1. An explicit `userId` on the request (query param or JSON body) —
 *      this is what a real auth layer will pass once it lands. Validated
 *      as a UUID before it's trusted.
 *   2. `POINTSNAP_AUTH_DEV_USER_ID` env var — a real `auth.users` UUID set
 *      for development / verification so the T5' flow can be exercised
 *      end-to-end against the live DB before auth ships. Same pattern the
 *      rest of the cockpit uses for "feature wired, auth shell incomplete".
 *
 * Returns null when neither yields a valid UUID — the caller then returns
 * a 401-style "sign in to connect airlines" response rather than calling
 * the worker with a bogus id (which the worker would 400 anyway, and which
 * could otherwise write a row under the wrong identity).
 *
 * When the auth layer lands, the only change needed is to make step 1 read
 * the authenticated session (e.g. Clerk `auth()` → Supabase user id) — the
 * four routes stay untouched.
 */
import type { NextRequest } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Resolve the acting user's Supabase UUID for an auth-airline proxy call.
 *
 * @param req         the incoming request (used for the `userId` query param)
 * @param bodyUserId  optional `userId` lifted from an already-parsed JSON body
 *                    (POST routes parse the body once and pass it in, so we
 *                    don't consume the stream twice)
 */
export function resolveUserId(
  req: NextRequest,
  bodyUserId?: unknown,
): string | null {
  // 1. Explicit identity on the request — the future auth-layer path.
  if (isUuid(bodyUserId)) return bodyUserId;
  const queryUserId = new URL(req.url).searchParams.get("userId");
  if (isUuid(queryUserId)) return queryUserId;

  // 2. Development fallback — a real auth.users UUID set via Fly/Vercel env
  //    so the flow is verifiable before the auth layer ships.
  const devUserId = process.env.POINTSNAP_AUTH_DEV_USER_ID;
  if (isUuid(devUserId)) return devUserId;

  return null;
}

/** Shared 401 body for routes that can't resolve a user. */
export function noUserResponse(): Response {
  return Response.json(
    {
      message:
        "Sign in to connect an airline. (Auth is still rolling out — set " +
        "POINTSNAP_AUTH_DEV_USER_ID to exercise this before it ships.)",
    },
    { status: 401 },
  );
}
