"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Check,
  CircleDot,
  Clock3,
  Radio,
  Search,
  Radar,
} from "lucide-react";
import { progressSchema, type BuildProgress } from "@/lib/build-progress";
const states = {
  investigating: {
    label: "Investigating",
    order: 0,
    color: "text-sky-300 bg-sky-400/10 border-sky-400/25",
  },
  integrating: {
    label: "Building & testing",
    order: 1,
    color: "text-violet-300 bg-violet-400/10 border-violet-400/25",
  },
  flight_feed: {
    label: "Flight feed working",
    order: 2,
    color: "text-primary bg-primary/10 border-primary/25",
  },
  calendar: {
    label: "Calendar only",
    order: 3,
    color: "text-amber-300 bg-amber-400/10 border-amber-400/25",
  },
  blocked: {
    label: "Tested request blocked",
    order: 4,
    color: "text-rose-300 bg-rose-400/10 border-rose-400/25",
  },
  auth_required: {
    label: "Login required in tested flow",
    order: 4,
    color: "text-amber-300 bg-amber-400/10 border-amber-400/25",
  },
  unverified: {
    label: "Not yet verified",
    order: 5,
    color: "text-muted-foreground bg-muted/50 border-border",
  },
  retired: {
    label: "No current service",
    order: 6,
    color: "text-muted-foreground bg-muted/50 border-border",
  },
};
function time(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function BuildProgressView() {
  const [data, setData] = useState<BuildProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch("/api/build-progress", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const next = progressSchema.parse(await response.json());
        setData((previous) =>
          previous?.updatedAt === next.updatedAt ? previous : next,
        );
        setConnected(true);
      } catch {
        if (!controller.signal.aborted) setConnected(false);
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 3000);
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  const rows = (data?.airlines ?? [])
    .filter(
      (a) =>
        (filter === "all" || a.state === filter) &&
        `${a.name} ${a.code}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        states[a.state].order - states[b.state].order ||
        a.name.localeCompare(b.name),
    );
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-5 sm:px-8 h-16 flex items-center gap-4">
          <Radar className="size-7 text-primary stroke-[1.25]" />
          <span className="font-semibold tracking-[.14em] text-sm">
            POINTSNAP
          </span>
          <span className="border-l pl-4 text-sm text-muted-foreground hidden sm:block">
            Live work
          </span>
          <Link
            href="/search"
            className="ml-auto inline-flex min-h-11 items-center gap-2 text-sm hover:text-primary"
          >
            Open the app <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </header>
      <main className="max-w-[1600px] mx-auto p-5 sm:p-8 space-y-7">
        <div className="flex flex-wrap justify-between items-start gap-5">
          <div className="max-w-3xl">
            <p className="eyebrow flex items-center gap-2">
              <Radio className="size-3.5" /> FOLLOW THE BUILD
            </p>
            <h1 className="mt-3 text-3xl sm:text-4xl tracking-tight font-medium">
              Every finding. Every airline.
            </h1>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              A running record of what’s working, what’s being tested, and where
              access stops. Working feeds have the scope shown below; complete
              all-airline coverage is still unfinished.
            </p>
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 text-sm space-y-1">
            <p className="flex items-center gap-2">
              <span
                className={`size-2 rounded-full ${connected ? "bg-primary" : "bg-amber-400"}`}
              />
              {connected ? "Feed connected" : "Reconnecting to local app…"}
            </p>
            <p className="text-xs text-muted-foreground">
              Checks for updates every 3 seconds
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            [
              "Flight feeds",
              data?.airlines.filter((a) => a.state === "flight_feed").length ??
                0,
              "Verified within the stated scope",
            ],
            [
              "In progress",
              data?.airlines.filter((a) =>
                ["investigating", "integrating"].includes(a.state),
              ).length ?? 0,
              "Research or implementation underway",
            ],
            [
              "Calendar feeds",
              data?.airlines.filter((a) => a.state === "calendar").length ?? 0,
              "Daily summaries, not full flight lists",
            ],
            [
              "Programs tracked",
              data?.airlines.length ?? 0,
              "Including blocked and unverified flows",
            ],
          ].map(([label, count, caption]) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-3xl tabular-nums mt-2 font-medium">
                {data ? count : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-2">{caption}</p>
            </div>
          ))}
        </div>
        <div className="border-l-2 border-primary pl-4 py-1">
          <p className="eyebrow">
            {data?.active ? "WORKING ON NOW" : "LATEST WORK"}
          </p>
          <p className="mt-1 text-sm">
            {data?.focus ?? "Loading the current work…"}
          </p>
          {data && (
            <p className="text-xs text-muted-foreground mt-2">
              Last report {time(data.updatedAt)} · updates are recorded when
              findings change
            </p>
          )}
        </div>
        <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] gap-7 items-start">
          <section
            aria-labelledby="airline-progress-heading"
            className="min-w-0"
          >
            <p className="text-xs text-muted-foreground mb-3">
              Statuses describe the paths tested so far. A blocked request does
              not mean every possible access path has been ruled out.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h2
                id="airline-progress-heading"
                className="text-lg font-medium mr-auto"
              >
                Airline status
              </h2>
              <label className="flex items-center gap-2 border rounded-lg px-3 bg-card">
                <Search className="size-4 text-muted-foreground" />
                <input
                  aria-label="Find an airline"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find an airline"
                  className="bg-transparent text-sm h-11 outline-none w-36"
                />
              </label>
              <select
                aria-label="Filter airline status"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="border rounded-lg bg-card px-3 h-11 text-sm"
              >
                <option value="all">All statuses</option>
                {Object.entries(states).map(([id, state]) => (
                  <option key={id} value={id}>
                    {state.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border bg-card divide-y overflow-hidden">
              {rows.map((airline) => (
                <article key={airline.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="airline-tile shrink-0">
                      {airline.code}
                    </span>
                    <h3 className="font-medium mr-auto">{airline.name}</h3>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${states[airline.state].color}`}
                    >
                      {airline.state === "flight_feed" ? (
                        <Check className="size-3" />
                      ) : (
                        <CircleDot className="size-3" />
                      )}
                      {states[airline.state].label}
                    </span>
                  </div>
                  <p className="text-sm mt-3 leading-relaxed">
                    {airline.summary}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    {airline.next}
                  </p>
                  <div className="text-xs text-muted-foreground mt-3 flex justify-between items-center gap-3">
                    <span>Updated {time(airline.updatedAt)}</span>
                    {airline.source && (
                      <a
                        href={airline.source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-primary min-h-7"
                      >
                        Official source <ArrowUpRight className="size-3" />
                      </a>
                    )}
                  </div>
                </article>
              ))}
              {!rows.length && (
                <p className="p-8 text-sm text-muted-foreground">
                  {data
                    ? "No airlines match this filter."
                    : "Waiting for the current progress report…"}
                </p>
              )}
            </div>
          </section>
          <aside
            aria-labelledby="activity-heading"
            className="xl:sticky xl:top-24"
          >
            <h2
              id="activity-heading"
              className="text-lg font-medium mb-4 flex items-center gap-2"
            >
              <Activity className="size-4 text-primary" /> Activity feed
            </h2>
            <p className="sr-only" role="status">
              {data?.events[0]
                ? `${data.events[0].airline}: ${data.events[0].message}`
                : "Waiting for updates."}
            </p>
            <ol className="rounded-xl border bg-card divide-y xl:max-h-[calc(100vh-160px)] overflow-y-auto">
              {(data?.events ?? []).map((event) => (
                <li key={event.id} className="p-4">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span
                      className={
                        event.kind === "verified"
                          ? "text-primary"
                          : event.kind === "blocked"
                            ? "text-rose-300"
                            : "text-muted-foreground"
                      }
                    >
                      {event.airline}
                    </span>
                    <time
                      dateTime={event.at}
                      className="text-muted-foreground inline-flex items-center gap-1"
                    >
                      <Clock3 className="size-3" />
                      {time(event.at)}
                    </time>
                  </div>
                  <p className="text-sm mt-2 leading-relaxed">
                    {event.message}
                  </p>
                </li>
              ))}
              {!data?.events.length && (
                <li className="p-5 text-sm text-muted-foreground">
                  New findings will appear here.
                </li>
              )}
            </ol>
          </aside>
        </div>
      </main>
    </div>
  );
}
