"use client";

import { useMemo, useState } from "react";
import { Filter, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export interface AuditEvent {
  id: number;
  actorEmail: string;
  entityType: string;
  entityId: string;
  action: string;
  /** ISO string — serialized at the page level so this component can stay
   * a pure client component with no Date hydration drama. */
  occurredAtIso: string;
}

const relativeTime = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
};

interface Props {
  events: AuditEvent[];
}

export function AuditFeed({ events }: Props) {
  const [filter, setFilter] = useState("");
  const trimmed = filter.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!trimmed) return events;
    return events.filter((e) =>
      [e.actorEmail, e.entityType, e.entityId, e.action]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(trimmed)),
    );
  }, [events, trimmed]);

  const filtering = trimmed.length > 0;
  const hidden = filtering ? events.length - visible.length : 0;

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Filter className="size-4 text-muted-foreground shrink-0" aria-hidden />
          <Input
            placeholder="Filter by actor, entity, or action…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72 max-w-full text-sm"
            aria-label="Filter audit events"
            aria-controls="audit-list"
          />
          {filtering && (
            <Button
              variant="ghost"
              size="default"
              className="px-2 text-xs text-muted-foreground"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
            >
              Clear
            </Button>
          )}
        </div>
        <Button variant="outline" size="default" disabled>
          Export CSV
        </Button>
      </div>
      <Separator />
      <div id="audit-list" aria-live="polite" aria-atomic="false">
        {events.length === 0 ? (
          <div className="p-12 text-center">
            <Shield
              className="size-8 text-muted-foreground/40 mx-auto mb-3"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">
              No admin actions recorded yet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Events will appear here as operators edit sweet spots, override
              scrape data, or flip kill switches.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No events match{" "}
            <span className="font-mono text-foreground">&ldquo;{filter}&rdquo;</span>
            . {events.length} event{events.length === 1 ? "" : "s"} hidden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            {filtering && (
              <div className="px-3 md:px-4 py-2 text-xs text-muted-foreground border-b bg-muted/30">
                Showing {visible.length} of {events.length}
                {hidden > 0 && ` · ${hidden} hidden`}
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 md:px-4 py-2 font-medium">When</th>
                  <th className="px-3 md:px-4 py-2 font-medium">Actor</th>
                  <th className="px-3 md:px-4 py-2 font-medium">Action</th>
                  <th className="px-3 md:px-4 py-2 font-medium">Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((e) => (
                  <tr key={e.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-3 md:px-4 py-2 whitespace-nowrap">
                      <time
                        dateTime={e.occurredAtIso}
                        title={e.occurredAtIso}
                      >
                        {relativeTime(e.occurredAtIso)}
                      </time>
                    </td>
                    <td className="px-3 md:px-4 py-2 font-mono text-xs text-muted-foreground">
                      {e.actorEmail || "system"}
                    </td>
                    <td className="px-3 md:px-4 py-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {e.action}
                      </Badge>
                    </td>
                    <td className="px-3 md:px-4 py-2 text-muted-foreground">
                      {e.entityType}
                      <span className="font-mono text-xs"> #{e.entityId}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
