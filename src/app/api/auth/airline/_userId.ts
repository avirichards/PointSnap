import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";

// Identity comes exclusively from a verified session. Request IDs and shared
// development fallbacks must never grant access to stored airline credentials.
export async function resolveUserId(
  _req?: NextRequest,
  _bodyUserId?: unknown,
): Promise<string | null> {
  void _req;
  void _bodyUserId;
  return (await currentUser())?.id ?? null;
}
export function noUserResponse() {
  return Response.json(
    { message: "Sign in to manage saved airline accounts." },
    { status: 401 },
  );
}
