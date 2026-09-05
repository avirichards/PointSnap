import Link from "next/link";
import { ArrowUpRight, ArrowRight, Plane } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
export const metadata = { title: "Explore — PointSnap" };
export const dynamic = "force-dynamic";
const routes = [
  {
    from: "SEA",
    to: "SFO",
    title: "A change of coast",
    place: "San Francisco",
    copy: "Waterfront walks, neighborhood cafés, and a weekend that feels a little longer.",
    source: "Alaska Airlines",
    kind: "Individual flight results",
  },
  {
    from: "JFK",
    to: "LAX",
    title: "Follow the sunshine",
    place: "Los Angeles",
    copy: "From New York mornings to Pacific sunsets. See what your points can do.",
    source: "JetBlue",
    kind: "Daily award calendar",
  },
  {
    from: "JFK",
    to: "LHR",
    title: "Across the Atlantic",
    place: "London",
    copy: "A museum morning, a long lunch, and a different view on your next trip.",
    source: "Virgin Atlantic",
    kind: "Daily award calendar",
  },
];
export default async function ExplorePage() {
  const departDate = new Date(new Date().getTime() + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="search-workspace">
        <p className="eyebrow">ROOM FOR A LITTLE POSSIBILITY</p>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-3">
          Where will your points take you?
        </h1>
        <p className="text-muted-foreground mt-4 max-w-2xl">
          Start with a route, then make it yours. These searches check current
          award prices for a date next month. Adjust dates and airports to match
          your plans.
        </p>
        <section className="grid md:grid-cols-3 gap-5 mt-8">
          {routes.map((r, i) => (
            <Link
              key={r.to}
              href={
                "/search?" +
                new URLSearchParams({
                  origin: r.from,
                  dest: r.to,
                  departDate,
                  pax: "1",
                  minCabin: "Y",
                })
              }
              className="group overflow-hidden rounded-2xl border bg-card hover:border-primary/50 transition-colors"
            >
              <div className={`explore-scene explore-scene-${i}`}>
                <span className="text-xs tracking-widest uppercase opacity-75">
                  {r.title}
                </span>
                <h2 className="text-3xl font-semibold mt-3">{r.place}</h2>
                <div className="flex items-center gap-3 mt-12 text-lg">
                  <span>{r.from}</span>
                  <span className="h-px bg-current opacity-30 flex-1" />
                  <Plane className="size-5 -rotate-12" />
                  <span>{r.to}</span>
                </div>
              </div>
              <div className="p-6">
                <p className="text-muted-foreground text-sm leading-relaxed min-h-16">
                  {r.copy}
                </p>
                <p className="text-xs text-muted-foreground mt-5">
                  {r.source} · {r.kind}
                </p>
                <p className="font-medium mt-4 flex justify-between items-center">
                  Search this route{" "}
                  <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
                </p>
              </div>
            </Link>
          ))}
        </section>
        <div className="mt-8 rounded-xl border p-6 grid sm:grid-cols-2 gap-6">
          <div>
            <h2 className="font-semibold">
              A good award starts with flexibility.
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Try neighboring airports and different dates. Compare points and
              cash together, and check each segment of a mixed-cabin itinerary.
            </p>
          </div>
          <div>
            <h2 className="font-semibold">Confirm before you transfer.</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              The airline confirms the final seats and price. Keep that booking
              page open before moving points into a loyalty program.
            </p>
            <Link
              className="text-sm font-medium mt-3 inline-flex items-center gap-1"
              href="/airlines"
            >
              See program coverage <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
