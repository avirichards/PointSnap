"use client";

import { useState } from "react";
import { Compass, Rows3, Rows4 } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SearchForm } from "@/components/search/search-form";
import { ResultsTable } from "@/components/spreadsheet/results-table";
import { ProgramStatusStrip } from "@/components/spreadsheet/program-status-strip";
import { Toggle } from "@/components/ui/toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchStream } from "@/hooks/use-search-stream";
import type { SearchQuery } from "@/lib/types";

const defaultDepartDate = () =>
  new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);

export default function SearchPage() {
  const [query, setQuery] = useState<SearchQuery>({
    origin: "JFK",
    dest: "NRT",
    departDate: defaultDepartDate(),
    pax: 1,
    minCabin: "Y",
  });
  const [compress, setCompress] = useState(false);
  const [collapseByFlight, setCollapseByFlight] = useState(true);

  const { rows, programs, durationMs, isStreaming } = useSearchStream(query);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 mx-auto w-full max-w-screen-2xl px-3 md:px-6 py-4 md:py-6 space-y-4">
        <SearchForm
          initialQuery={query}
          onSubmit={(q) => setQuery(q)}
          isStreaming={isStreaming}
        />

        <div className="flex flex-wrap items-center gap-2 justify-between">
          <ProgramStatusStrip programs={programs} />
          <div className="flex items-center gap-1">
            <Toggle
              pressed={compress}
              onPressedChange={setCompress}
              size="sm"
              variant="outline"
              aria-label="Compact rows"
              title="Compress rows"
            >
              {compress ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
              <span className="hidden md:inline">{compress ? "Roomy" : "Compact"}</span>
            </Toggle>
            <Toggle
              pressed={collapseByFlight}
              onPressedChange={setCollapseByFlight}
              size="sm"
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
