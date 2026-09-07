"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2, Wallet, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WALLET_ASSETS, type WalletData } from "@/lib/wallet";

export function WalletEditor() {
  const [now] = useState(() => Date.now());
  const [data, setData] = useState<WalletData>({ entries: [], cards: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [assetId, setAssetId] = useState("AMEX_MR");
  const [balance, setBalance] = useState("");
  const [expiry, setExpiry] = useState("");
  const [card, setCard] = useState("");
  async function refresh() {
    const res = await fetch("/api/wallet", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.message);
    setData(body);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wallet", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message);
        setData(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function mutate(body: unknown, method = "POST") {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/wallet", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message);
      await refresh();
      setMessage(
        method === "DELETE"
          ? "Removed from your wallet."
          : "Saved to your wallet.",
      );
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const total = data.entries.reduce((sum, e) => sum + e.balance, 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Points & miles tracked
          </p>
          <p className="text-3xl font-semibold tabular-nums mt-2">
            {loading ? "—" : total.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Balances have different values and cannot all be combined.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Programs & currencies</p>
          <p className="text-3xl font-semibold mt-2">
            {loading ? "—" : data.entries.length}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Cards tracked</p>
          <p className="text-3xl font-semibold mt-2">
            {loading ? "—" : data.cards.length}
          </p>
        </div>
      </div>
      {message && (
        <p role="status" className="rounded-lg border bg-muted p-3 text-sm">
          {message}
        </p>
      )}
      <section className="rounded-xl border bg-card overflow-hidden">
        <div className="p-5 border-b">
          <h2 className="font-semibold flex gap-2 items-center">
            <Wallet className="size-5" />
            Your balances
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Update these after earning or redeeming points. Expiry dates are
            optional.
          </p>
        </div>
        <div className="divide-y">
          {data.entries.map((e) => {
            const days = e.expires_on
              ? Math.ceil(
                  (Date.parse(e.expires_on + "T23:59:59Z") - now) / 86400000,
                )
              : null;
            return (
              <div
                key={e.asset_id}
                className="p-4 flex flex-wrap items-center gap-3"
              >
                <div className="flex-1 min-w-40">
                  <p className="font-medium">
                    {WALLET_ASSETS.find((a) => a.id === e.asset_id)?.name ??
                      e.asset_id}
                  </p>
                  {days !== null && (
                    <p
                      className={`text-sm ${days <= 90 ? "text-amber-500" : "text-muted-foreground"}`}
                    >
                      {days < 0
                        ? "Expiry date has passed"
                        : `Expires ${e.expires_on}`}
                    </p>
                  )}
                </div>
                <strong className="tabular-nums font-mono">
                  {e.balance.toLocaleString()}
                </strong>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setAssetId(e.asset_id);
                    setBalance(String(e.balance));
                    setExpiry(e.expires_on ?? "");
                    document.getElementById("balance")?.focus();
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Remove ${e.asset_id} balance`}
                  onClick={() => mutate({ assetId: e.asset_id }, "DELETE")}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
        {!loading && !data.entries.length && (
          <p className="p-5 text-muted-foreground">
            Add your first balance below to see what your points can cover.
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate({
                assetId,
                balance: Number(balance),
                expiresOn: expiry || null,
              })
            ) {
              setBalance("");
              setExpiry("");
            }
          }}
          className="p-5 bg-muted/30 border-t grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] items-end"
        >
          <div className="space-y-2">
            <Label htmlFor="asset">Program or currency</Label>
            <select
              id="asset"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              disabled={busy}
            >
              {WALLET_ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="balance">Balance</Label>
            <Input
              id="balance"
              type="number"
              min="0"
              max="2000000000"
              step="1"
              required
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="h-11"
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expiry">Expires on (optional)</Label>
            <Input
              id="expiry"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="h-11"
              disabled={busy}
            />
          </div>
          <Button type="submit" className="h-11" disabled={busy}>
            <Plus className="size-4" />
            Save balance
          </Button>
        </form>
      </section>
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <CreditCard className="size-5" />
          Your cards
        </h2>
        <p className="text-sm text-muted-foreground">
          Keep a list of your rewards cards. Enter a nickname only; no card
          numbers or security codes.
        </p>
        <ul className="divide-y">
          {data.cards.map((c) => (
            <li key={c.id} className="flex justify-between items-center py-2">
              <span>{c.name}</span>
              <Button
                aria-label={`Remove ${c.name}`}
                variant="ghost"
                disabled={busy}
                onClick={() => mutate({ type: "card", id: c.id }, "DELETE")}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await mutate({ type: "card", name: card })) setCard("");
          }}
        >
          <Label className="sr-only" htmlFor="card">
            Card nickname
          </Label>
          <Input
            id="card"
            placeholder="e.g. Sapphire Preferred"
            value={card}
            onChange={(e) => setCard(e.target.value)}
            maxLength={80}
            required
            disabled={busy}
            className="h-11"
          />
          <Button type="submit" disabled={busy} className="h-11">
            Add card
          </Button>
        </form>
      </section>
    </div>
  );
}
