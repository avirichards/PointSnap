import { SiteHeader } from "@/components/layout/site-header";
import { TripsWorkspace } from "@/components/trips/trips-workspace";
export const metadata = { title: "My trips — PointSnap" };
export default function TripsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <TripsWorkspace />
      </main>
    </>
  );
}
