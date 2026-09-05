"use client";
import { useMemo, useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeftRight,
  ChevronDown,
  RefreshCw,
  Radio,
  Globe2,
  CornerDownRight,
  Map,
  Check,
  ScanLine,
} from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SearchForm } from "./search-form";
import { Button } from "@/components/ui/button";
import { AwardResults, programName } from "./award-results";
import { useAwardSearch } from "@/hooks/use-award-search";
import { parseQuery, queryParams } from "@/lib/award-search/query";
import type { SearchQuery } from "@/lib/types";
import { AIRPORTS } from "@/db/seed/airports";
import { SavedSearches, NearbyDates } from "./search-tools";
import { bookingUrl } from "@/lib/bookingHandoff";
const RouteGlobe = dynamic(
  () => import("@/components/map/route-globe").then((m) => m.RouteGlobe),
  {
    ssr: false,
    loading: () => (
      <div className="globe-placeholder">
        <Globe2 className="size-32 stroke-[.4] text-muted-foreground/25" />
        <span className="mono-label">Loading route explorer</span>
      </div>
    ),
  },
);
const shortcuts = [
  {
    origin: "SEA",
    dest: "SFO",
    city: "San Francisco",
    name: "West Coast hop",
    program: "Alaska · Individual flights",
  },
  {
    origin: "LGW",
    dest: "AMS",
    city: "Amsterdam",
    name: "Across the Channel",
    program: "Skywards · easyJet flights",
  },
  {
    origin: "MAN",
    dest: "ALC",
    city: "Alicante",
    name: "A little Mediterranean sun",
    program: "Skywards · easyJet & Jet2 flights",
  },
];
function Workspace() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.toString();
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [returnLeg, setReturnLeg] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const [draft, setDraft] = useState<SearchQuery>(() => ({
    origin: "JFK",
    dest: "LHR",
    departDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    pax: 1,
    minCabin: "Y",
  }));
  const parsed = useMemo(() => {
    if (!params.get("origin") && !params.get("dest")) return null;
    try {
      return parseQuery(new URLSearchParams(raw));
    } catch {
      return "invalid" as const;
    }
  }, [raw, params]);
  const query = parsed && parsed !== "invalid" ? parsed : null;
  const isReturnLeg = returnLeg && !!query?.returnDate;
  const active =
    query && isReturnLeg && query.returnDate
      ? {
          ...query,
          origin: query.dest,
          dest: query.origin,
          departDate: query.returnDate,
          returnDate: undefined,
        }
      : query;
  const activeParams = active
    ? queryParams({ ...active, returnDate: undefined }).toString()
    : null;
  const stream = useAwardSearch(activeParams);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/coverage", { signal: c.signal })
      .then((r) => r.json())
      .then((d) => setEnabled(d.enabled))
      .catch(() => {});
    return () => c.abort();
  }, []);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(
          e.target instanceof HTMLElement &&
          e.target.closest(
            'input,textarea,select,[contenteditable="true"],[role="dialog"]',
          )
        )
      ) {
        e.preventDefault();
        document.getElementById("origin")?.focus();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  function search(q: SearchQuery) {
    setReturnLeg(false);
    setDraft(q);
    const next = queryParams(q).toString();
    if (next === raw) stream.retry();
    else router.push(`/search?${next}`, { scroll: false });
  }
  function choose(origin: string, dest: string) {
    setDraft((previous) => ({ ...previous, origin, dest }));
    setFormRevision((n) => n + 1);
  }
  const checked = stream.coverage.filter(
    (c) => c.state === "success" || c.state === "empty",
  ).length;
  const unavailable = stream.coverage.filter(
    (c) => c.state === "unavailable" || c.state === "error",
  ).length;
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className={`search-workspace award-workspace ${query ? "has-results" : ""}`}
      >
        <div className="workspace-topline">
          <p className="mono-label flex items-center gap-2">
            <ScanLine className="size-3.5 text-primary" />
            AWARD SEARCH{" "}
            <span className="hidden sm:inline text-muted-foreground/50">/</span>
            <span className="hidden sm:inline">
              {query ? "FLIGHT COMPARISON" : "ROUTE EXPLORER"}
            </span>
          </p>
          <Link
            href="/airlines"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span className="status-dot" />
            {enabled.length || "—"} data sources enabled
            <ArrowRight className="size-3" />
          </Link>
        </div>
        <section className="search-panel" aria-label="Find award flights">
          <SearchForm
            key={`${raw}-${formRevision}`}
            initialQuery={query ?? draft}
            onDraftChange={setDraft}
            onSubmit={search}
          />
        </section>
        <SavedSearches query={query} />
        {parsed === "invalid" && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 p-4 my-4"
          >
            This search link has invalid dates or airports. Update the search
            above.
          </p>
        )}
        {!query && (
          <>
            <section
              className="discovery-grid"
              aria-label="Explore award routes"
            >
              <div className="discovery-intro">
                <p className="mono-label text-primary flex items-center gap-2">
                  <span className="size-1.5 bg-primary rounded-full" />
                  THE NEXT GREAT REDEMPTION
                </p>
                <h1>
                  Go further. <br />
                  Spend <br />
                  <span>fewer points.</span>
                </h1>
                <p className="discovery-description">
                  The route. The cabin. The real cost.
                  <br />
                  Find an award worth your points.
                </p>
                <div className="route-readout">
                  <span className="mono-label">ON YOUR RADAR</span>
                  <div className="flex items-center gap-3 mt-3 text-2xl font-medium tracking-tight">
                    <span>{draft.origin}</span>
                    <ArrowRight className="size-4 text-primary" />
                    <span>{draft.dest}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {AIRPORTS.find((a) => a.iata === draft.origin)?.city ??
                      draft.origin}{" "}
                    to{" "}
                    {AIRPORTS.find((a) => a.iata === draft.dest)?.city ??
                      draft.dest}
                  </p>
                  <p className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
                    <CornerDownRight className="size-3.5" />
                    Select an airport to change your route.
                  </p>
                </div>
              </div>
              <RouteGlobe
                key={`${draft.origin}-${draft.dest}`}
                origin={draft.origin}
                destination={draft.dest}
                onDestination={(dest) => choose(draft.origin, dest)}
              />
              <aside className="route-shortcuts">
                <div className="flex items-center gap-2 mb-2">
                  <Radio className="size-4 text-primary" />
                  <h2 className="font-medium">Worth a look</h2>
                </div>
                <p className="text-xs text-muted-foreground mb-6">
                  Three routes. Different possibilities.
                </p>
                {shortcuts.map((r, i) => (
                  <button
                    key={r.dest}
                    onClick={() => choose(r.origin, r.dest)}
                    className={`shortcut ${draft.origin === r.origin && draft.dest === r.dest ? "is-selected" : ""}`}
                  >
                    <span className="mono-label shortcut-number">0{i + 1}</span>
                    <div>
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-lg font-medium">{r.city}</h3>
                        <ArrowRight className="size-4" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.name}{" "}
                        <span className="font-mono text-[10px] ml-1">
                          {r.origin}–{r.dest}
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground/80 mt-3">
                        {r.program}
                      </p>
                    </div>
                  </button>
                ))}
                <p className="text-[11px] leading-relaxed text-muted-foreground mt-5">
                  Choose a route, then Find awards to check your date. Routes
                  shown are ideas, not confirmed availability.
                </p>
              </aside>
            </section>
            <footer className="discovery-footer">
              <div className="flex items-center gap-3">
                <span className="mono-label text-primary">Y / W / J / F</span>
                <span className="text-xs text-muted-foreground">
                  Every available cabin. Points + cash, side by side.
                </span>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Check className="size-3.5 text-primary" />
                No personal airline login needed
                <span className="hidden lg:inline border-l h-4 mx-3" />
                <kbd className="hidden lg:inline shortcut-key">/</kbd>
                <span className="hidden lg:inline">to focus search</span>
              </div>
            </footer>
          </>
        )}
        {query && (
          <div className="mt-7 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="route-pill">
                  {active!.origin}
                  <ArrowRight className="size-3.5 text-primary" />
                  {active!.dest}
                </span>
                <span className="text-sm text-muted-foreground">
                  {active!.departDate}
                </span>
                {query.returnDate && (
                  <Button
                    variant="outline"
                    onClick={() => setReturnLeg(!returnLeg)}
                  >
                    <ArrowLeftRight className="size-4" />
                    {isReturnLeg ? "Show outbound" : "Show return"}
                  </Button>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  onClick={() => setShowMap(!showMap)}
                  aria-pressed={showMap}
                >
                  <Map className="size-4" />
                  Route map
                </Button>
                <Button
                  variant="ghost"
                  onClick={stream.retry}
                  disabled={stream.loading}
                >
                  <RefreshCw
                    className={`size-4 ${stream.loading ? "animate-spin motion-reduce:animate-none" : ""}`}
                  />
                  {stream.loading ? "Searching…" : "Refresh"}
                </Button>
              </div>
            </div>
            {showMap && (
              <div className="result-map">
                <RouteGlobe
                  key={`${active!.origin}-${active!.dest}`}
                  origin={active!.origin}
                  destination={active!.dest}
                />
                <p className="text-xs text-muted-foreground text-center pb-4">
                  Geographic route between your selected airports. Actual flight
                  connections appear in each result.
                </p>
              </div>
            )}
            {query.returnDate && (
              <p className="text-sm text-muted-foreground">
                Each direction is searched as a one-way award. Round-trip awards
                may price differently.
              </p>
            )}
            <NearbyDates
              date={active!.departDate}
              min={isReturnLeg ? query.departDate : undefined}
              max={!isReturnLeg ? query.returnDate : undefined}
              onChoose={(date) => {
                if (date === active!.departDate) {
                  stream.retry();
                  return;
                }
                if (isReturnLeg)
                  router.push(
                    `/search?${queryParams({ ...query, returnDate: date })}`,
                    { scroll: false },
                  );
                else search({ ...query, departDate: date });
              }}
            />
            {stream.error && (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm flex justify-between gap-3"
              >
                <span>{stream.error}</span>
                <Link
                  href={`/sign-in?next=${encodeURIComponent("/search?" + raw)}`}
                  className="underline shrink-0"
                >
                  Account
                </Link>
              </div>
            )}
            <AwardResults
              key={activeParams}
              rows={stream.rows}
              coverage={stream.coverage}
              pax={query.pax}
              minCabin={query.minCabin}
              loading={stream.loading}
            />
            <section className="rounded-xl border bg-card">
              <button
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                className="w-full flex justify-between items-center gap-3 text-left p-4"
              >
                <span className="flex flex-wrap gap-2 items-center text-sm font-medium">
                  <Radio className="size-4 text-primary" />
                  Source coverage
                  <span className="font-normal text-muted-foreground">
                    {checked} checked ·{" "}
                    {
                      stream.coverage.filter((c) => c.state === "pending")
                        .length
                    }{" "}
                    searching · {unavailable} unavailable
                  </span>
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 ${expanded ? "rotate-180" : ""}`}
                />
              </button>
              {expanded && (
                <ul className="border-t grid sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0">
                  {stream.coverage.map((c) => (
                    <li key={c.programId} className="p-4 text-sm">
                      <p className="font-medium">{programName(c.programId)}</p>
                      <p className="text-muted-foreground mt-1">
                        {c.state === "success"
                          ? c.inventory === "calendar"
                            ? "Daily fare summary only"
                            : "Individual flights received"
                          : c.state === "empty"
                            ? c.inventory === "calendar"
                              ? "No matching calendar price returned"
                              : "No matching flights returned"
                            : c.state === "pending"
                              ? "Searching…"
                              : (c.message ?? "Unavailable")}
                      </p>
                      {c.message &&
                        (c.state === "success" || c.state === "empty") && (
                          <p className="text-xs text-muted-foreground mt-2">
                            {c.message}
                          </p>
                        )}
                      {(c.state === "error" || c.state === "unavailable") && (
                        <a
                          href={bookingUrl(c.programId, active!)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-2 text-sm underline underline-offset-4"
                        >
                          Check on airline website ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {stream.duration !== null && (
              <p className="text-xs text-muted-foreground">
                Checked in {(stream.duration / 1000).toFixed(1)} seconds.
                Confirm final availability and prices with the airline before
                transferring points.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
export function SearchWorkspace() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
