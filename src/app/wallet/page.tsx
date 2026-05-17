import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { db, schema } from "@/db";

export const metadata = {
  title: "Wallet — PointSnap",
  description: "Track your transferable-currency balances and cards.",
};

/**
 * Wallet page (Phase-1 shell). Auth wiring comes later — for now this lists
 * the 7 launch transferable-currency programs from the DB so the page is
 * visibly populated, and prompts sign-in to start tracking balances.
 */
async function loadCurrencies(): Promise<
  Array<{ id: string; name: string; issuer: string }>
> {
  if (!db) return [];
  const rows = await db
    .select({
      id: schema.transferableCurrencies.id,
      name: schema.transferableCurrencies.name,
      issuer: schema.transferableCurrencies.issuer,
    })
    .from(schema.transferableCurrencies)
    .orderBy(schema.transferableCurrencies.name);
  return rows;
}

export default async function WalletPage() {
  const currencies = await loadCurrencies();

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 mx-auto w-full max-w-screen-2xl px-3 md:px-6 py-4 md:py-6 space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Wallet className="size-5 text-muted-foreground" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-prose">
            Track which programs and transferable currencies you hold. PointSnap
            uses your wallet to surface only redemptions you can actually book
            and to rank results by transfer cost.
          </p>
        </header>

        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-2 p-4">
            <div>
              <h2 className="text-base font-medium">Transferable currencies</h2>
              <p className="text-xs text-muted-foreground">
                Bank rewards that transfer to airline partners.
              </p>
            </div>
            <Button variant="outline" size="sm" disabled title="Sign in to edit">
              Add balance
            </Button>
          </div>
          <Separator />
          <ul className="divide-y" role="list">
            {currencies.length === 0 ? (
              <EmptyRow label="No currencies seeded yet — check that DATABASE_URL is set." />
            ) : (
              currencies.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/30 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.issuer}</div>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">
                      —
                    </span>
                    <Badge variant="outline" className="text-xs">
                      sign in to track
                    </Badge>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-2 p-4">
            <div>
              <h2 className="text-base font-medium">Cards on file</h2>
              <p className="text-xs text-muted-foreground">
                Earning multipliers + annual fees power the &ldquo;best card
                for this purchase&rdquo; suggestions.
              </p>
            </div>
            <Button variant="outline" size="sm" disabled title="Sign in to edit">
              Add card
            </Button>
          </div>
          <Separator />
          <div className="p-6 text-center text-sm text-muted-foreground">
            No cards yet — sign in to start tracking.
          </div>
        </section>

        <section className="rounded-lg border bg-muted/40 p-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">Sign in to save your wallet</h2>
            <p className="text-sm text-muted-foreground max-w-prose mt-1">
              Right now the wallet shows the catalogue of supported programs.
              Sign in to record your balances and cards — your wallet then
              powers ranking and the &ldquo;all-in cost&rdquo; column on the
              search page.
            </p>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link href="/sign-in" aria-label="Go to sign in">
              Sign in
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </section>
      </main>
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <li className="px-4 py-6 text-sm text-muted-foreground text-center">
      {label}
    </li>
  );
}
