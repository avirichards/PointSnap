import { serverSupabase } from "@/lib/supabase/server";
import { balanceInput, cardInput, WALLET_ASSETS } from "@/lib/wallet";
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
  if (!ctx) return fail("Sign in to view your wallet.", 401);
  const [entries, cards] = await Promise.all([
    ctx.db
      .from("wallet_entries")
      .select("asset_id,kind,balance,expires_on")
      .eq("user_id", ctx.user.id)
      .order("asset_id"),
    ctx.db
      .from("wallet_cards")
      .select("id,name")
      .eq("user_id", ctx.user.id)
      .order("name"),
  ]);
  if (entries.error || cards.error)
    return fail(
      "Your wallet is temporarily unavailable. Please try again later.",
      503,
    );
  return Response.json(
    { entries: entries.data, cards: cards.data },
    { headers },
  );
}
export async function POST(req: Request) {
  const ctx = await context();
  if (!ctx) return fail("Sign in to edit your wallet.", 401);
  const body = await req.json().catch(() => null);
  if (body?.type === "card") {
    const input = cardInput.safeParse(body);
    if (!input.success)
      return fail("Enter a card nickname of 1–80 characters.", 400);
    const { error } = await ctx.db
      .from("wallet_cards")
      .upsert(
        { user_id: ctx.user.id, name: input.data.name },
        { onConflict: "user_id,name" },
      );
    return error
      ? fail("Could not save this card. Try again.", 503)
      : Response.json({ ok: true }, { headers });
  }
  const input = balanceInput.safeParse(body);
  if (!input.success)
    return fail(
      "Choose a program and enter a valid whole-number balance and expiry date.",
      400,
    );
  const asset = WALLET_ASSETS.find((a) => a.id === input.data.assetId)!;
  const { error } = await ctx.db
    .from("wallet_entries")
    .upsert(
      {
        user_id: ctx.user.id,
        asset_id: asset.id,
        kind: asset.kind,
        balance: input.data.balance,
        expires_on: input.data.expiresOn ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,asset_id" },
    );
  return error
    ? fail("Could not save your balance. Please try again.", 503)
    : Response.json({ ok: true }, { headers });
}
export async function DELETE(req: Request) {
  const ctx = await context();
  if (!ctx) return fail("Sign in to edit your wallet.", 401);
  const body = await req.json().catch(() => null);
  if (body?.type === "card" && typeof body.id === "string") {
    const { error } = await ctx.db
      .from("wallet_cards")
      .delete()
      .eq("user_id", ctx.user.id)
      .eq("id", body.id);
    return error
      ? fail("Could not remove the card.", 503)
      : Response.json({ ok: true }, { headers });
  }
  if (typeof body?.assetId !== "string")
    return fail("Choose a balance to remove.", 400);
  const { error } = await ctx.db
    .from("wallet_entries")
    .delete()
    .eq("user_id", ctx.user.id)
    .eq("asset_id", body.assetId);
  return error
    ? fail("Could not remove the balance.", 503)
    : Response.json({ ok: true }, { headers });
}
