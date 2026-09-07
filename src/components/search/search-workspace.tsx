"use client";
import { useMemo, useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, ChevronDown, Radio, Globe2, Check } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SearchForm } from "./search-form";
import { ResultsSearchHeader } from "./results-search-header";
import { AwardResults, programName } from "./award-results";
import { useAwardSearch } from "@/hooks/use-award-search";
import { parseQuery, queryParams } from "@/lib/award-search/query";
import { physicalAirport } from "@/lib/search-places";
import type { SearchQuery } from "@/lib/types";
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
          flexDays: query.returnFlexDays ?? query.flexDays,
          returnDate: undefined,
        }
      : query;
  const activeParams = active
    ? queryParams({ ...active, returnDate: undefined }).toString()
    : null;
  const windowParams = activeParams ? new URLSearchParams(activeParams) : null;
  if (windowParams && query?.returnDate) {
    if (isReturnLeg) windowParams.set("windowMin", query.departDate);
    else windowParams.set("windowMax", query.returnDate);
  }
  const stream = useAwardSearch(windowParams?.toString() ?? null);
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
        const origin = document.getElementById("origin");
        if (origin) origin.focus();
        else
          document
            .querySelector<HTMLButtonElement>("[data-edit-search]")
            ?.click();
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
    requestAnimationFrame(() => {
      document.getElementById("origin")?.focus({ preventScroll: true });
      const form = document.querySelector(".search-hero-form");
      const bounds = form?.getBoundingClientRect();
      if (bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight)) {
        form?.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
      }
    });
  }
  const checked = stream.coverage.filter(
    (c) => c.state === "success" || c.state === "empty",
  ).length;
  const unavailable = stream.coverage.filter(
    (c) =>
      c.state === "unavailable" || c.state === "error" || c.state === "partial",
  ).length;
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className={`search-workspace award-workspace ${query ? "has-results" : ""}`}
      >
        {!query && (
          <>
            <section
              className="search-hero"
              aria-label="Find your next award flight"
            >
              <div className="search-hero-globe">
                <RouteGlobe
                  key={`${draft.origin}-${draft.dest}`}
                  origin={physicalAirport(draft.origin)}
                  destination={physicalAirport(draft.dest)}
                  showLabels={false}
                />
              </div>
              <div className="search-hero-heading">
                <p className="mono-label">THE NEXT GREAT REDEMPTION</p>
                <h1>
                  Go further. <span>Spend fewer points.</span>
                </h1>
                <p>
                  Find your flight. Compare the points. Make more of your next
                  trip.
                </p>
              </div>
              <div className="search-hero-form">
                <section
                  className="search-panel"
                  aria-label="Find award flights"
                >
                  <SearchForm
                    key={`${raw}-${formRevision}`}
                    initialQuery={draft}
                    onDraftChange={setDraft}
                    onSubmit={search}
                    isStreaming={stream.loading}
                  />
                </section>
                {parsed === "invalid" && (
                  <p
                    role="alert"
                    className="rounded-xl border border-destructive/30 bg-card p-4 mt-3 text-sm"
                  >
                    This search link has invalid dates or airports. Update the
                    search above.
                  </p>
                )}
                <div className="search-hero-reassurance">
                  <span>
                    <Check aria-hidden /> Points + cash, side by side. Every
                    available cabin.
                  </span>
                  <Link href="/airlines">
                    <span className="status-dot" />
                    {enabled.length || "—"} data sources enabled{" "}
                    <ArrowRight aria-hidden />
                  </Link>
                </div>
                <SavedSearches query={null} />
              </div>
            </section>
            <section
              className="discovery-suggestions"
              aria-labelledby="route-ideas-title"
            >
              <div className="suggestions-heading">
                <h2 id="route-ideas-title">
                  <Radio aria-hidden /> Worth a look
                </h2>
                <p>A few ideas for your next trip.</p>
              </div>
              <div className="suggestion-routes">
                {shortcuts.map((r, i) => (
                  <button
                    key={r.dest}
                    onClick={() => choose(r.origin, r.dest)}
                    aria-pressed={
                      draft.origin === r.origin && draft.dest === r.dest
                    }
                    className="suggestion-route"
                  >
                    <span className="mono-label suggestion-number">
                      0{i + 1}
                    </span>
                    <span className="suggestion-description">
                      <strong>{r.city}</strong>
                      <span>
                        {r.name}{" "}
                        <span className="font-mono">
                          {r.origin}–{r.dest}
                        </span>
                      </span>
                      <small>{r.program}</small>
                    </span>
                    <ArrowRight aria-hidden />
                  </button>
                ))}
              </div>
              <div className="suggestions-footer">
                <p>
                  Route ideas, not confirmed availability. Select one, then
                  search your dates.
                </p>
                <span>
                  <kbd className="shortcut-key">/</kbd> to start a search
                </span>
              </div>
            </section>
          </>
        )}
        {query && (
          <div className="results-workspace-body">
            <ResultsSearchHeader
              key={`search-header-${raw}`}
              query={query}
              onSearch={search}
              isReturn={isReturnLeg}
              onToggleReturn={() => setReturnLeg(!returnLeg)}
              enabledSources={enabled.length}
              loading={stream.loading}
              paused={!!stream.rateLimitUntil}
              onRefresh={stream.retry}
              onStop={stream.stop}
            />
            {!active?.flexDays && (
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
            )}
            {stream.rateLimitUntil && (
              <p
                role="status"
                className="rounded-xl border bg-card p-4 text-sm"
              >
                Waiting for the search limit to reset. Your remaining dates will
                resume automatically. Results already found remain available
                below.
              </p>
            )}
            {stream.error && (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm flex justify-between gap-3"
              >
                <span>{stream.error}</span>
                <button
                  disabled={stream.loading}
                  onClick={stream.retry}
                  className="underline shrink-0"
                >
                  Retry search
                </button>
              </div>
            )}
            {stream.tasks.length > 1 && (
              <p role="status" className="text-xs text-muted-foreground">
                {stream.tasks.filter((t) => t.state === "complete").length} of{" "}
                {stream.tasks.length} airport/date searches completed
                {stream.rateLimitUntil
                  ? " · Remaining checks are queued. You can stop the search at any time."
                  : stream.loading
                    ? " · Two searches run at a time. Results appear as sources respond."
                    : " · See source coverage for incomplete checks."}
              </p>
            )}
            <AwardResults
              key={activeParams}
              rows={stream.rows}
              coverage={stream.coverage}
              pax={query.pax}
              minCabin={query.minCabin}
              loading={stream.loading}
              dates={stream.dates}
              requestedDate={active!.departDate}
              dayStatus={stream.days}
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
                    searching · {unavailable} incomplete
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
                        {c.state === "partial"
                          ? "Some airport/date searches are incomplete"
                          : c.state === "success"
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
