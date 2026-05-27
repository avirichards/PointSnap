"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMiles } from "@/lib/effectiveCost";
import type { Cabin } from "@/lib/types";
import { CABIN_LABEL } from "@/lib/types";

export interface SweetSpotEntry {
  id: number;
  programId: string;
  programName: string;
  title: string;
  cabin: Cabin;
  milesOneWay: number;
  approxSurchargeUsd: number | null;
  notes: string | null;
  sourceUrl: string | null;
  rank: number;
  tags: string[];
}

const CABIN_TINT: Record<Cabin, string> = {
  Y: "bg-[color:var(--color-cabin-y)] text-[color:var(--color-cabin-y-fg)]",
  W: "bg-[color:var(--color-cabin-w)] text-[color:var(--color-cabin-w-fg)]",
  J: "bg-[color:var(--color-cabin-j)] text-[color:var(--color-cabin-j-fg)]",
  F: "bg-[color:var(--color-cabin-f)] text-[color:var(--color-cabin-f-fg)]",
};

function formatTag(tag: string): string {
  return tag
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface Props {
  spots: SweetSpotEntry[];
}

export function SweetSpotList({ spots }: Props) {
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of spots) for (const t of s.tags) set.add(t);
    return [...set].sort();
  }, [spots]);

  const visible = useMemo(() => {
    if (activeTags.size === 0) return spots;
    return spots.filter((s) => s.tags.some((t) => activeTags.has(t)));
  }, [spots, activeTags]);

  const toggle = (tag: string) =>
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  return (
    <>
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 py-2" aria-label="Filter by tag">
          <span className="text-xs text-muted-foreground mr-1">Filter:</span>
          {allTags.map((t) => {
            const active = activeTags.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-3 h-8 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {formatTag(t)}
              </button>
            );
          })}
          {activeTags.size > 0 && (
            <Button
              variant="ghost"
              size="default"
              className="h-8 px-2 text-xs"
              onClick={() => setActiveTags(new Set())}
              aria-label="Clear all filters"
            >
              <X className="size-3" aria-hidden />
              Clear
            </Button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center space-y-2">
          <Sparkles
            className="size-8 text-muted-foreground/40 mx-auto"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No sweet spots match the selected tags.
          </p>
          <Button
            variant="outline"
            size="default"
            onClick={() => setActiveTags(new Set())}
          >
            Reset filters
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" role="list">
          {visible.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border bg-card p-4 space-y-3 hover:border-foreground/30 transition-colors"
            >
              <header className="flex items-start justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <h2 className="text-sm font-medium leading-tight">
                    {s.title}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {s.programName}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wider tabular-nums",
                    CABIN_TINT[s.cabin],
                  )}
                  title={CABIN_LABEL[s.cabin]}
                >
                  {s.cabin}
                </span>
              </header>

              <div className="flex items-baseline gap-3">
                <span className="font-mono tabular-nums text-xl font-semibold">
                  {formatMiles(s.milesOneWay)}
                </span>
                <span className="text-xs text-muted-foreground">miles OW</span>
                {s.approxSurchargeUsd !== null &&
                  s.approxSurchargeUsd !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      + ${s.approxSurchargeUsd}
                    </span>
                  )}
              </div>

              {s.notes && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {s.notes}
                </p>
              )}

              {(s.tags.length > 0 || s.sourceUrl) && (
                <footer className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {s.tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">
                        {formatTag(t)}
                      </Badge>
                    ))}
                  </div>
                  {s.sourceUrl && (
                    <Link
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Source <ArrowUpRight className="size-3" aria-hidden />
                    </Link>
                  )}
                </footer>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
