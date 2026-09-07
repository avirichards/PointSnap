"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bookmark, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryParams, querySchema } from "@/lib/award-search/query";
import { CABIN_LABEL, type SearchQuery } from "@/lib/types";

const key = "pointsnap:saved-searches:v1";
const event = "pointsnap:saved-searches";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(event, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(event, callback);
  };
}
function snapshot() {
  try {
    return localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}
function decode(raw: string): SearchQuery[] {
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.slice(0, 8).flatMap((value) => {
      const parsed = querySchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}
export function SavedSearches({
  query,
  compact = false,
}: {
  query: SearchQuery | null;
  compact?: boolean;
}) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  const saved = decode(raw);
  const [error, setError] = useState("");
  const id = query ? queryParams(query).toString() : null;
  const exists = saved.some((q) => queryParams(q).toString() === id);
  function write(next: SearchQuery[]) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(event));
      setError("");
    } catch {
      setError(
        "This browser could not save your search. You can bookmark the page instead.",
      );
    }
  }
  if (!query && !saved.length) return null;
  return (
    <section
      className={
        compact
          ? "saved-search-action"
          : "mt-4 flex flex-wrap items-center gap-2"
      }
      aria-label="Saved searches"
    >
      {query && (
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={exists}
          onClick={() =>
            write(
              exists
                ? saved.filter((q) => queryParams(q).toString() !== id)
                : [query, ...saved].slice(0, 8),
            )
          }
        >
          {exists ? (
            <Check className="size-4" />
          ) : (
            <Bookmark className="size-4" />
          )}
          {exists ? "Search saved" : "Save search"}
        </Button>
      )}
      {!compact && saved.length > 0 && (
        <>
          <span className="text-xs text-muted-foreground">
            Saved on this device
          </span>
          {saved.map((q) => {
            const params = queryParams(q).toString();
            const label = `${q.origin} → ${q.dest}, ${q.departDate}, ${CABIN_LABEL[q.minCabin]}, ${q.pax} travelers${q.returnDate ? `, return ${q.returnDate}` : ""}`;
            return (
              <span
                key={params}
                className="inline-flex items-center rounded-lg border bg-card"
              >
                <Link
                  href={`/search?${params}`}
                  scroll={false}
                  className="px-3 py-3 text-xs hover:underline"
                  title={label}
                >
                  {q.origin} → {q.dest} · {q.departDate.slice(5)}
                </Link>
                <button
                  className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={`Remove saved search ${label}`}
                  onClick={() =>
                    write(
                      saved.filter(
                        (item) => queryParams(item).toString() !== params,
                      ),
                    )
                  }
                >
                  <X className="size-3.5" />
                </button>
              </span>
            );
          })}
        </>
      )}
      {error && (
        <p role="status" className="w-full text-sm text-muted-foreground">
          {error}
        </p>
      )}
    </section>
  );
}

export function NearbyDates({
  date,
  min,
  max,
  onChoose,
}: {
  date: string;
  min?: string;
  max?: string;
  onChoose: (date: string) => void;
}) {
  const today = new Date();
  const earliest = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const latest = new Date(today.getTime() + 366 * 86400000)
    .toISOString()
    .slice(0, 10);
  return (
    <nav
      aria-label="Search nearby dates"
      className="nearby-dates grid grid-cols-7 gap-1 rounded-xl border bg-card p-2"
    >
      {[-3, -2, -1, 0, 1, 2, 3].map((offset) => {
        const day = new Date(`${date}T12:00:00Z`);
        day.setUTCDate(day.getUTCDate() + offset);
        const iso = day.toISOString().slice(0, 10);
        const disabled =
          iso < earliest ||
          iso > latest ||
          !!(min && iso < min) ||
          !!(max && iso > max);
        return (
          <button
            key={iso}
            disabled={disabled}
            aria-current={offset === 0 ? "date" : undefined}
            aria-label={`Search ${iso}`}
            onClick={() => onChoose(iso)}
            className={`rounded-lg px-1 py-2.5 text-center disabled:opacity-25 disabled:cursor-not-allowed ${offset === 0 ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            <span className="block text-xs">
              {day.toLocaleDateString("en-US", {
                weekday: "short",
                timeZone: "UTC",
              })}
            </span>
            <span className="block text-sm font-medium mt-0.5">
              {day.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
