"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Pencil,
  RefreshCw,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CABIN_LABEL, type SearchQuery } from "@/lib/types";
import { dateLabel } from "@/lib/calendar";
import { airportPairs, cityGroup, placeName } from "@/lib/search-places";
import { SearchForm } from "./search-form";
import { SavedSearches } from "./search-tools";

export function ResultsSearchHeader({
  query,
  onSearch,
  isReturn = false,
  onToggleReturn,
  enabledSources,
  loading = false,
  paused = false,
  onRefresh,
  onStop,
}: {
  query: SearchQuery;
  onSearch: (query: SearchQuery) => void;
  isReturn?: boolean;
  onToggleReturn?: () => void;
  enabledSources?: number;
  loading?: boolean;
  paused?: boolean;
  onRefresh?: () => void;
  onStop?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const origin = isReturn ? query.dest : query.origin;
  const destination = isReturn ? query.origin : query.dest;
  const range = (days = 0) =>
    days ? `±${days} ${days === 1 ? "day" : "days"}` : "Exact date";
  function closeEditor() {
    setEditing(false);
    requestAnimationFrame(() =>
      editButton.current?.focus({ preventScroll: true }),
    );
  }
  return (
    <section className="results-search-header" aria-label="Current search">
      <div className="results-search-summary">
        <div className="results-search-description">
          <h1>
            {placeName(origin)} <ArrowRight aria-hidden />
            <span className="sr-only">to</span> {placeName(destination)}
          </h1>
          <div className="results-search-meta">
            <span className="results-airport-codes">
              {origin} → {destination}
            </span>
            <span className={isReturn ? undefined : "summary-active-date"}>
              <CalendarDays aria-hidden />
              {query.returnDate && "Out: "}
              {dateLabel(query.departDate, {
                weekday: "short",
                year: "numeric",
              })}
              <small>{range(query.flexDays)}</small>
            </span>
            {query.returnDate && (
              <span className={isReturn ? "summary-active-date" : undefined}>
                Return:{" "}
                {dateLabel(query.returnDate, {
                  weekday: "short",
                  year: "numeric",
                })}
                <small>{range(query.returnFlexDays ?? query.flexDays)}</small>
              </span>
            )}
            <span>
              <Users aria-hidden />
              {query.pax} adult{query.pax === 1 ? "" : "s"} ·{" "}
              {CABIN_LABEL[query.minCabin]}
              {query.minCabin === "F" ? "" : " or higher"}
            </span>
          </div>
        </div>
        <div className="results-search-actions">
          <Button
            ref={editButton}
            variant="outline"
            data-edit-search
            aria-expanded={editing}
            aria-controls="results-search-editor"
            onClick={() => {
              if (editing) closeEditor();
              else {
                setEditing(true);
                requestAnimationFrame(() =>
                  document
                    .getElementById("origin")
                    ?.focus({ preventScroll: true }),
                );
              }
            }}
          >
            <Pencil aria-hidden />
            {editing ? "Close editor" : "Edit search"}
          </Button>
          <SavedSearches query={query} compact />
          {onRefresh && (
            <Button
              variant="ghost"
              onClick={onRefresh}
              disabled={loading}
              aria-label={
                paused
                  ? "Waiting to resume search"
                  : loading
                    ? "Searching"
                    : "Refresh"
              }
            >
              <RefreshCw
                aria-hidden
                className={
                  loading && !paused
                    ? "animate-spin motion-reduce:animate-none"
                    : ""
                }
              />
              {paused ? "Waiting…" : loading ? "Searching…" : "Refresh"}
            </Button>
          )}
          {loading && onStop && (
            <Button variant="outline" onClick={onStop}>
              Stop search
            </Button>
          )}
        </div>
      </div>
      {(query.returnDate ||
        cityGroup(origin) ||
        cityGroup(destination) ||
        enabledSources !== undefined) && (
        <div className="results-search-context">
          {query.returnDate && onToggleReturn && (
            <div className="search-direction" aria-label="Flight direction">
              <button
                type="button"
                aria-pressed={!isReturn}
                onClick={() => isReturn && onToggleReturn()}
              >
                Outbound
              </button>
              <button
                type="button"
                aria-pressed={isReturn}
                onClick={() => !isReturn && onToggleReturn()}
              >
                Return
              </button>
            </div>
          )}
          {(cityGroup(origin) || cityGroup(destination)) && (
            <span>
              {airportPairs(origin, destination).length} airport pairs:{" "}
              {cityGroup(origin)?.airports.join(", ") ?? origin} →{" "}
              {cityGroup(destination)?.airports.join(", ") ?? destination}
            </span>
          )}
          {query.returnDate && (
            <span>
              Each direction is searched as a one-way award; round-trip pricing
              may differ.
            </span>
          )}
          {enabledSources !== undefined && (
            <Link href="/airlines" className="results-source-link">
              <span className="status-dot" />
              {enabledSources || "—"} data sources enabled
              <ArrowRight aria-hidden />
            </Link>
          )}
        </div>
      )}
      {editing && (
        <div
          id="results-search-editor"
          className="results-search-editor"
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !event.defaultPrevented &&
              !(event.target as HTMLElement).closest(
                '[role="dialog"],[role="listbox"]',
              )
            ) {
              event.preventDefault();
              closeEditor();
            }
          }}
        >
          <div className="results-editor-heading">
            <h2>Edit your search</h2>
            <Button variant="ghost" onClick={closeEditor}>
              Cancel
            </Button>
          </div>
          <section className="search-panel" aria-label="Edit flight search">
            <SearchForm
              initialQuery={query}
              onSubmit={(next) => {
                closeEditor();
                onSearch(next);
              }}
              isStreaming={loading}
            />
          </section>
          <SavedSearches query={null} />
        </div>
      )}
    </section>
  );
}
