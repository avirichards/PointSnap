import { currentUser } from "@/lib/supabase/server";
import { workerConfigured, workerHeaders } from "@/lib/worker";
import { PROGRAM_IDS } from "@/lib/programs";
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json(
      { message: "Sign in to disconnect an airline." },
      { status: 401 },
    );
  const body = await req.json().catch(() => null);
  if (!body || !PROGRAM_IDS.includes(body.programId))
    return Response.json({ message: "Choose an airline." }, { status: 400 });
  if (!workerConfigured())
    return Response.json(
      { message: "Airline services are unavailable." },
      { status: 503 },
    );
  try {
    const url = `${process.env.PYTHON_WORKER_URL!.replace(/\/$/, "")}/auth/disconnect?${new URLSearchParams({ user_id: user.id, program: body.programId })}`;
    const result = await fetch(url, {
      method: "POST",
      headers: workerHeaders(user.id),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error();
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { message: "Could not disconnect. Please try again." },
      { status: 502 },
    );
  }
}
