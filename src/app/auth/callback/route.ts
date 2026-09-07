import { NextRequest, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth-redirect";
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const client = await serverSupabase();
  if (code && client) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(safeNext(req.nextUrl.searchParams.get("next")), req.url),
      );
  }
  return NextResponse.redirect(new URL("/sign-in?error=link", req.url));
}
