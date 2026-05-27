"use client";

import { useRouter } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { SearchForm } from "@/components/search/search-form";
import type { SearchQuery } from "@/lib/types";

const defaultDepartDate = () =>
  new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);

const INITIAL_QUERY: SearchQuery = {
  origin: "",
  dest: "",
  departDate: defaultDepartDate(),
  pax: 1,
  minCabin: "Y",
};

function queryToParams(q: SearchQuery): string {
  const p = new URLSearchParams({
    origin: q.origin,
    dest: q.dest,
    departDate: q.departDate,
    pax: String(q.pax),
    minCabin: q.minCabin,
  });
  if (q.returnDate) p.set("returnDate", q.returnDate);
  return p.toString();
}

export default function Home() {
  const router = useRouter();

  const handleSubmit = (q: SearchQuery) => {
    if (!q.origin || !q.dest) return;
    router.push(`/search?${queryToParams(q)}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 flex items-center justify-center px-4 py-12 md:py-16 focus:outline-none"
      >
        <div className="w-full max-w-4xl space-y-8 md:space-y-10">
          <div className="text-center space-y-3">
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight">
              Find the cheapest points for your next flight
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
              Compare award seat pricing across 13 loyalty programs in one
              sweep. Live availability, real surcharges, ranked by total cost.
            </p>
          </div>

          <div className="rounded-xl border bg-card shadow-sm p-4 md:p-6">
            <SearchForm
              initialQuery={INITIAL_QUERY}
              onSubmit={handleSubmit}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
