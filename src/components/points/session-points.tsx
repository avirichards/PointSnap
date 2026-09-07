"use client";
import { useState } from "react";
import Link from "next/link";
import { X, Plus } from "lucide-react";
import { WALLET_ASSETS } from "@/lib/wallet";
import { useSessionPoints } from "@/hooks/use-session-points";
import { Button } from "@/components/ui/button";
export function SessionPoints() {
  const { balances, set } = useSessionPoints();
  const [asset, setAsset] = useState("AMEX_MR"),
    [amount, setAmount] = useState("");
  return (
    <section className="points-workspace">
      <div>
        <p className="eyebrow">NO ACCOUNT NEEDED TO TRY IT</p>
        <h2 className="text-2xl font-medium mt-2">
          See what your points could cover.
        </h2>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
          Add an approximate balance, then select a flight to work out how to
          book it. These inputs stay in memory for this session and clear on
          reload.
        </p>
      </div>
      <form
        className="points-entry"
        onSubmit={(e) => {
          e.preventDefault();
          if (amount !== "") {
            set(asset, Number(amount));
            setAmount("");
          }
        }}
      >
        <label className="trip-label">
          Points or miles
          <select value={asset} onChange={(e) => setAsset(e.target.value)}>
            {WALLET_ASSETS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="trip-label">
          Available balance
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="2000000000"
            step="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 80,000"
          />
        </label>
        <Button className="h-11">
          <Plus className="size-4" />
          Add balance
        </Button>
      </form>
      <div className="space-y-2">
        {Object.entries(balances).map(([id, value]) => (
          <div className="session-balance" key={id}>
            <span>{WALLET_ASSETS.find((a) => a.id === id)?.name ?? id}</span>
            <strong>{value.toLocaleString()}</strong>
            <button
              className="icon-button"
              onClick={() => set(id, null)}
              aria-label={`Remove ${WALLET_ASSETS.find((a) => a.id === id)?.name ?? id}`}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-4 items-center text-sm">
        <Button asChild variant="outline">
          <Link href="/search">Find a flight</Link>
        </Button>
        <Link
          href="/sign-in?next=/wallet"
          className="text-primary underline underline-offset-4"
        >
          Sign in for a saved wallet
        </Link>
      </div>
    </section>
  );
}
