import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { currentUser } from "@/lib/supabase/server";
import { SavedAirlines } from "@/components/auth/saved-airlines";
export default async function SavedAccounts() {
  if (!(await currentUser())) redirect("/sign-in?next=/airlines/accounts");
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="search-workspace">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1 className="text-3xl font-semibold mt-3">Saved airline accounts</h1>
        <p className="text-muted-foreground mt-3 mb-7">
          Manage previously saved airline logins. Disconnect removes the saved
          session and credentials. Current award searches use the connections
          listed on the Programs page.
        </p>
        <SavedAirlines />
      </main>
    </>
  );
}
