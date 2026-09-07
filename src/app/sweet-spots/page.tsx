import { SiteHeader } from "@/components/layout/site-header";
import { ExploreWorkspace } from "@/components/explore/explore-workspace";
export const metadata = { title: "Explore — PointSnap" };
export default function ExplorePage() {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <ExploreWorkspace />
      </main>
    </>
  );
}
