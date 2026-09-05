import { currentUser } from "@/lib/supabase/server";
export async function GET() {
  const user = await currentUser();
  return Response.json(
    user
      ? { email: user.email, isStaff: user.app_metadata?.role === "staff" }
      : null,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
