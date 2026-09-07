import { serverSupabase } from "@/lib/supabase/server";
import { savedFlightSchema, tripAction } from "@/lib/trips";
const headers = { "Cache-Control": "private, no-store" };
const fail = (message: string, status: number) =>
  Response.json({ message }, { status, headers });
async function context() {
  const db = await serverSupabase();
  if (!db) return null;
  const {
    data: { user },
  } = await db.auth.getUser();
  return user ? { db, user } : null;
}
export async function GET() {
  const ctx = await context();
  if (!ctx) return fail("Sign in to save trips to your account.", 401);
  const [trips, flights] = await Promise.all([
    ctx.db
      .from("trips")
      .select("id,name,created_at")
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false }),
    ctx.db
      .from("trip_flights")
      .select("id,trip_id,leg,snapshot,created_at")
      .eq("user_id", ctx.user.id)
      .order("created_at"),
  ]);
  if (trips.error || flights.error)
    return fail(
      "Saved trips are temporarily unavailable. Your existing trips have not changed.",
      503,
    );
  return Response.json(
    {
      owner: ctx.user.id,
      trips: trips.data,
      flights: flights.data.filter(
        (f) => savedFlightSchema.safeParse(f.snapshot).success,
      ),
    },
    { headers },
  );
}
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    return fail("This request must come from PointSnap.", 403);
  const ctx = await context();
  if (!ctx) return fail("Sign in to save trips to your account.", 401);
  const raw = await req.text();
  if (raw.length > 100000)
    return fail("This flight contains too much data to save.", 400);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("Invalid trip request.", 400);
  }
  const input = tripAction.safeParse(json);
  if (!input.success)
    return fail("Check the trip name and flight details.", 400);
  const body = input.data;
  if (body.action === "save") {
    let tripId = body.tripId;
    let created = false;
    if (!tripId) {
      const { data, error } = await ctx.db
        .from("trips")
        .insert({ user_id: ctx.user.id, name: body.name })
        .select("id")
        .single();
      if (error || !data) return fail("Could not create your trip.", 503);
      tripId = data.id;
      created = true;
    }
    const { error } = await ctx.db
      .from("trip_flights")
      .insert({
        user_id: ctx.user.id,
        trip_id: tripId,
        leg: body.leg,
        snapshot: body.snapshot,
      });
    if (error) {
      if (created)
        await ctx.db
          .from("trips")
          .delete()
          .eq("user_id", ctx.user.id)
          .eq("id", tripId!);
      return fail("Could not save this flight. Please try again.", 503);
    }
  } else if (body.action === "rename") {
    const { error } = await ctx.db
      .from("trips")
      .update({ name: body.name })
      .eq("user_id", ctx.user.id)
      .eq("id", body.tripId);
    if (error) return fail("Could not rename your trip.", 503);
  } else {
    const { error } = await ctx.db
      .from(body.action === "removeFlight" ? "trip_flights" : "trips")
      .delete()
      .eq("user_id", ctx.user.id)
      .eq("id", body.id);
    if (error) return fail("Could not remove this item.", 503);
  }
  return Response.json({ ok: true }, { headers });
}
