import { SiteHeader } from "@/components/layout/site-header";
import { WalletEditor } from "@/components/wallet/wallet-editor";
import { currentUser } from "@/lib/supabase/server";
import { SessionPoints } from "@/components/points/session-points";
export const metadata = {
  title: "My points",
  description:
    "Track your points and miles, with transfer planning for your next trip.",
};
export default async function WalletPage() {
  const user = await currentUser();
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" tabIndex={-1} className="product-page space-y-6">
        <header>
          <p className="text-sm text-primary font-medium mb-2">
            YOUR NEXT TRIP STARTS HERE
          </p>
          <h1 className="text-3xl font-semibold">Your points, in one place.</h1>
          <p className="text-muted-foreground mt-3">
            Track your balances and plan what to use for your next award flight.
          </p>
        </header>
        {user ? <WalletEditor /> : <SessionPoints />}
      </main>
    </div>
  );
}
