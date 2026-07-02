"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import type { Cabin, SearchResultRow } from "@/lib/types";
import { CABIN_LABEL, CABIN_ORDER } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CabinCell } from "./cabin-cell";
import { LastSeenBadge } from "./last-seen-badge";
import { ConfidenceBadge } from "./confidence-badge";

interface ResultsTableProps {
  rows: SearchResultRow[];
  compress: boolean;
  collapseByFlight: boolean;
}

type SortKey =
  | "depart"
  | "program"
  | "duration"
  | "stops"
  | "freshness"
  | "confidence"
  | Cabin;
type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
  priority: number;
}

const formatDuration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? `${m}m` : ""}`;
};

const formatDepart = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const stopsLabel = (numSegments: number) =>
  numSegments === 1 ? "Nonstop" : `${numSegments - 1} stop${numSegments > 2 ? "s" : ""}`;

const cabinValue = (row: SearchResultRow, c: Cabin) =>
  row.cabinPrices[c]?.milesPerPax ?? Number.POSITIVE_INFINITY;

function compareRows(a: SearchResultRow, b: SearchResultRow, key: SortKey, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  switch (key) {
    case "depart":
      return mul * a.departDate.localeCompare(b.departDate);
    case "program":
      return mul * a.programName.localeCompare(b.programName);
    case "duration":
      return mul * (a.totalDurationMin - b.totalDurationMin);
    case "stops":
      return mul * (a.numSegments - b.numSegments);
    case "freshness":
      return mul * (new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
    case "confidence":
      return mul * (b.confidenceScore - a.confidenceScore);
    case "Y":
    case "W":
    case "J":
    case "F":
      return mul * (cabinValue(a, key) - cabinValue(b, key));
  }
}

export function ResultsTable({
  rows,
  compress,
  collapseByFlight,
}: ResultsTableProps) {
  const [sorts, setSorts] = useState<SortState[]>([
    { key: "J", dir: "asc", priority: 0 },
  ]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      for (const s of sorts) {
        const r = compareRows(a, b, s.key, s.dir);
        if (r !== 0) return r;
      }
      return 0;
    });
    return list;
  }, [rows, sorts]);

  const grouped = useMemo(() => {
    if (!collapseByFlight) {
      return sortedRows.map((r) => ({ primary: r, alternatives: [] }));
    }
    const map = new Map<string, SearchResultRow[]>();
    for (const r of sortedRows) {
      const list = map.get(r.operatingFlightKey) ?? [];
      list.push(r);
      map.set(r.operatingFlightKey, list);
    }
    const seen = new Set<string>();
    const out: { primary: SearchResultRow; alternatives: SearchResultRow[] }[] = [];
    for (const r of sortedRows) {
      if (seen.has(r.operatingFlightKey)) continue;
      seen.add(r.operatingFlightKey);
      const group = map.get(r.operatingFlightKey) ?? [r];
      out.push({ primary: group[0], alternatives: group.slice(1) });
    }
    return out;
  }, [sortedRows, collapseByFlight]);

  const onHeaderClick = (key: SortKey, e: React.MouseEvent) => {
    setSorts((prev) => {
      const existing = prev.find((s) => s.key === key);
      if (e.shiftKey) {
        if (existing) {
          return prev.map((s) =>
            s.key === key
              ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" }
              : s,
          );
        }
        return [...prev, { key, dir: "asc", priority: prev.length }];
      }
      if (existing && prev.length === 1) {
        return [{ key, dir: existing.dir === "asc" ? "desc" : "asc", priority: 0 }];
      }
      return [{ key, dir: "asc", priority: 0 }];
    });
  };

  // A called helper (not a `<Component/>`) so it doesn't trip the
  // react-hooks/static-components rule while still closing over `sorts`.
  const sortIcon = (keyId: SortKey) => {
    const s = sorts.find((x) => x.key === keyId);
    if (!s) return <ArrowUpDown className="size-3 opacity-30" aria-hidden />;
    return s.dir === "asc" ? (
      <ArrowUp className="size-3" aria-hidden />
    ) : (
      <ArrowDown className="size-3" aria-hidden />
    );
  };

  const rowHeight = compress ? "h-8" : "h-12 md:h-10";

  return (
    <div className="relative w-full overflow-x-auto scrollbar-thin rounded-md border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-card z-10">
          <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
            <Th
              sticky="left-0"
              widthClass="w-[180px] min-w-[180px]"
              onClick={(e) => onHeaderClick("depart", e)}
            >
              Depart {sortIcon("depart")}
            </Th>
            <Th
              sticky="left-[180px]"
              widthClass="w-[180px] min-w-[180px]"
              onClick={(e) => onHeaderClick("program", e)}
            >
              Program {sortIcon("program")}
            </Th>
            <Th widthClass="w-[140px]">Route</Th>
            {CABIN_ORDER.map((c) => (
              <Th
                key={c}
                widthClass="w-[88px] text-right"
                onClick={(e) => onHeaderClick(c, e)}
                title={`${c} — ${CABIN_LABEL[c]}`}
              >
                <span
                  className="inline-flex items-center gap-1 justify-end w-full"
                  aria-label={`${CABIN_LABEL[c]} (${c})`}
                >
                  {c}
                  {sortIcon(c)}
                </span>
              </Th>
            ))}
            <Th
              widthClass="w-[88px] text-right"
              onClick={(e) => onHeaderClick("duration", e)}
            >
              Duration {sortIcon("duration")}
            </Th>
            <Th
              widthClass="w-[88px] text-center"
              onClick={(e) => onHeaderClick("stops", e)}
            >
              Stops {sortIcon("stops")}
            </Th>
            <Th
              widthClass="w-[96px]"
              onClick={(e) => onHeaderClick("freshness", e)}
            >
              Seen {sortIcon("freshness")}
            </Th>
            <Th
              widthClass="w-[120px]"
              onClick={(e) => onHeaderClick("confidence", e)}
            >
              Confidence {sortIcon("confidence")}
            </Th>
          </tr>
        </thead>
        <tbody>
          {grouped.length === 0 && (
            <tr>
              <td colSpan={11} className="text-center text-muted-foreground py-12">
                No results yet — search will stream here.
              </td>
            </tr>
          )}
          {grouped.map(({ primary, alternatives }) => {
            const isExpanded = expanded.has(primary.operatingFlightKey);
            return (
              <FragmentRow
                key={primary.id}
                primary={primary}
                alternatives={alternatives}
                rowHeight={rowHeight}
                compress={compress}
                isExpanded={isExpanded}
                toggleExpand={() => {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(primary.operatingFlightKey))
                      next.delete(primary.operatingFlightKey);
                    else next.add(primary.operatingFlightKey);
                    return next;
                  });
                }}
              />
            );
          })}
        </tbody>
      </table>
      {/* Right-edge scroll affordance: subtle gradient that hints horizontal content */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-full w-6 bg-gradient-to-l from-card to-transparent md:hidden"
      />
    </div>
  );
}

function Th({
  children,
  widthClass,
  sticky,
  onClick,
  title,
}: {
  children: React.ReactNode;
  widthClass?: string;
  sticky?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const isClickable = !!onClick;
  return (
    <th
      onClick={onClick}
      title={title}
      className={cn(
        "py-2 px-2 text-left font-medium align-middle",
        widthClass,
        sticky && `sticky ${sticky} bg-card z-20`,
        isClickable &&
          "cursor-pointer select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      tabIndex={isClickable ? 0 : undefined}
      role={isClickable ? "button" : undefined}
    >
      <span className="inline-flex items-center gap-1">{children}</span>
    </th>
  );
}

function FragmentRow({
  primary,
  alternatives,
  rowHeight,
  compress,
  isExpanded,
  toggleExpand,
}: {
  primary: SearchResultRow;
  alternatives: SearchResultRow[];
  rowHeight: string;
  compress: boolean;
  isExpanded: boolean;
  toggleExpand: () => void;
}) {
  return (
    <>
      <tr className={cn("border-b transition-colors hover:bg-accent/50", rowHeight)}>
        <td className="sticky left-0 bg-card px-2 align-middle z-10 group-hover:bg-accent/50">
          <div className="flex items-center gap-1">
            {alternatives.length > 0 && (
              <button
                onClick={toggleExpand}
                aria-expanded={isExpanded}
                aria-label={
                  isExpanded
                    ? "Collapse alternative programs"
                    : `Show ${alternatives.length} more ways to book`
                }
                className="inline-flex h-9 w-9 -my-1 items-center justify-center rounded hover:bg-accent text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight
                  className={cn(
                    "size-4 transition-transform motion-reduce:transition-none",
                    isExpanded && "rotate-90",
                  )}
                  aria-hidden
                />
              </button>
            )}
            <div>
              <div className="font-medium leading-tight">
                {formatDepart(primary.departDate)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {primary.segments[0].operatingAirlineIata}{" "}
                {primary.segments[0].flightNumber}
              </div>
            </div>
          </div>
        </td>
        <td className="sticky left-[180px] bg-card px-2 align-middle z-10">
          <div className="font-medium leading-tight">{primary.programName}</div>
          {alternatives.length > 0 && (
            <div className="text-[10px] text-muted-foreground">
              +{alternatives.length} more way
              {alternatives.length > 1 ? "s" : ""} to book
            </div>
          )}
        </td>
        <td className="px-2 align-middle">
          <div className="font-medium leading-tight">
            {primary.originIata} → {primary.destIata}
          </div>
          {primary.segments.length > 1 && (
            <div className="text-[10px] text-muted-foreground">
              via{" "}
              {primary.segments
                .slice(0, -1)
                .map((s) => s.destIata)
                .join(", ")}
            </div>
          )}
        </td>
        {CABIN_ORDER.map((c) => (
          <CabinCell
            key={c}
            cabin={c}
            price={primary.cabinPrices[c]}
            compress={compress}
          />
        ))}
        <td className="px-2 text-right tabular-nums align-middle">
          {formatDuration(primary.totalDurationMin)}
        </td>
        <td className="px-2 text-center align-middle">
          <span className="text-xs text-muted-foreground">
            {stopsLabel(primary.numSegments)}
          </span>
        </td>
        <td className="px-2 align-middle">
          <LastSeenBadge lastSeenAt={primary.lastSeenAt} />
        </td>
        <td className="px-2 align-middle">
          <ConfidenceBadge score={primary.confidenceScore} />
        </td>
      </tr>
      {isExpanded &&
        alternatives.map((alt) => (
          <tr
            key={alt.id}
            className={cn(
              "border-b bg-muted/30 transition-colors text-xs",
              rowHeight,
            )}
          >
            <td className="sticky left-0 bg-muted/30 px-2 pl-7 align-middle z-10">
              <span className="text-muted-foreground">also via</span>
            </td>
            <td className="sticky left-[180px] bg-muted/30 px-2 align-middle z-10">
              <div className="font-medium">{alt.programName}</div>
            </td>
            <td colSpan={1} />
            {CABIN_ORDER.map((c) => (
              <CabinCell
                key={c}
                cabin={c}
                price={alt.cabinPrices[c]}
                compress
              />
            ))}
            <td />
            <td />
            <td className="px-2 align-middle">
              <LastSeenBadge lastSeenAt={alt.lastSeenAt} />
            </td>
            <td className="px-2 align-middle">
              <ConfidenceBadge score={alt.confidenceScore} />
            </td>
          </tr>
        ))}
    </>
  );
}
