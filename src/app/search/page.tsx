"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Compass, Rows3, Rows4 } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SearchForm } from "@/components/search/search-form";
import { ResultsTable } from "@/components/spreadsheet/results-table";
import { ProgramStatusStrip } from "@/components/spreadsheet/program-status-strip";
import { Toggle } from "@/components/ui/toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchStream } from "@/hooks/use-search-stream";
import type { Cabin, SearchQuery } from "@/lib/types";

const defaultDepartDate = () =>
  new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);

const VALID_CABINS: Cabin[] = ["Y", "W", "J", "F"];

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

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read URL params on initial mount only. Back/forward updates don't sync
  // the form fields — rare edge case; the URL still shows the right query
  // and a fresh load picks it up correctly.
  const [query, setQuery] = useState<SearchQuery>(() => {
    const minCabinRaw = (
      searchParams.get("minCabin") ?? "Y"
    ).toUpperCase() as Cabin;
    return {
      origin: (searchParams.get("origin") ?? "JFK").toUpperCase().slice(0, 3),
      dest: (searchParams.get("dest") ?? "NRT").toUpperCase().slice(0, 3),
      departDate: searchParams.get("departDate") ?? defaultDepartDate(),
      returnDate: searchParams.get("returnDate") ?? undefined,
      pax: Math.max(1, Number(searchParams.get("pax") ?? "1")),
      minCabin: VALID_CABINS.includes(minCabinRaw) ? minCabinRaw : "Y",
    };
  });
  const [compress, setCompress] = useState(false);
  const [collapseByFlight, setCollapseByFlight] = useState(true);

  const { rows, programs, durationMs, isStreaming } = useSearchStream(query);

  const handleSubmit = (q: SearchQuery) => {
    setQuery(q);
    router.replace(`/search?${queryToParams(q)}`, { scroll: false });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 mx-auto w-full max-w-screen-2xl px-3 md:px-6 py-4 md:py-6 space-y-4 focus:outline-none"
      >
        <div className="sticky top-14 z-30 -mx-3 md:-mx-6 px-3 md:px-6 py-3 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b border-transparent transition-colors data-[stuck=true]:border-border">
          <SearchForm
            initialQuery={query}
            onSubmit={handleSubmit}
            isStreaming={isStreaming}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-between">
          <ProgramStatusStrip programs={programs} />
          <div className="flex items-center gap-1">
            <Toggle
              pressed={compress}
              onPressedChange={setCompress}
              size="default"
              variant="outline"
              aria-label={compress ? "Switch to roomy rows" : "Switch to compact rows"}
              title="Toggle row density"
            >
              {compress ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
              <span className="hidden md:inline">{compress ? "Roomy" : "Compact"}</span>
            </Toggle>
            <Toggle
              pressed={collapseByFlight}
              onPressedChange={setCollapseByFlight}
              size="default"
              variant="outline"
              aria-label="Collapse multiple programs ticketing the same flight"
              title="Group programs by physical flight"
            >
              <Compass className="size-4" />
              <span className="hidden md:inline">Group by flight</span>
            </Toggle>
          </div>
        </div>

        {isStreaming && rows.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <ResultsTable
            rows={rows}
            compress={compress}
            collapseByFlight={collapseByFlight}
          />
        )}

        <footer className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          {durationMs !== null && (
            <span>
              {rows.length} result{rows.length === 1 ? "" : "s"} in{" "}
              {(durationMs / 1000).toFixed(1)}s
            </span>
          )}
          <span aria-hidden>·</span>
          <span>Mock data — scrapers wire in next phase</span>
          <span aria-hidden>·</span>
          <span>
            Shift-click any column header for multi-column sort
          </span>
        </footer>
      </main>
    </div>
  );
}
