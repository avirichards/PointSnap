import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { WalletEditor } from "@/components/wallet/wallet-editor";
import { currentUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
export const metadata = {
  title: "Wallet",
  description:
    "Track your points and miles, with transfer planning for your next trip.",
};
export default async function WalletPage() {
  const user = await currentUser();
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className="max-w-6xl mx-auto px-4 py-8 space-y-6"
      >
        <header>
          <p className="text-sm text-primary font-medium mb-2">
            YOUR NEXT TRIP STARTS HERE
          </p>
          <h1 className="text-3xl font-semibold">Your points, in one place.</h1>
          <p className="text-muted-foreground mt-3">
            Track your balances and plan what to use for your next award flight.
          </p>
        </header>
        {user ? (
          <WalletEditor />
        ) : (
          <section className="rounded-xl border bg-card p-8 space-y-4">
            <h2 className="text-xl font-medium">
              A wallet that stays with you
            </h2>
            <p className="text-muted-foreground max-w-prose">
              Sign in to save airline miles, bank points, card nicknames and
              optional expiry dates. Your wallet is private to your account.
            </p>
            <Button asChild>
              <Link href="/sign-in?next=/wallet">
                Sign in to save your wallet
              </Link>
            </Button>
          </section>
        )}
      </main>
    </div>
  );
}
