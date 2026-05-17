import { Shield, Filter } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";

export const metadata = {
  title: "Admin — PointSnap",
  description: "Operator audit log and admin controls.",
};

/**
 * Admin shell. Reads from admin_audit_events. RBAC (only-show-to-staff)
 * lands when Clerk is wired up — for now this is reachable to anyone but
 * shows no PII (the audit log doesn't contain user-identifying data
 * outside actor_id, which is a Clerk-user UUID).
 */
async function loadAudit(): Promise<
  Array<{
    id: number;
    actorEmail: string;
    entityType: string;
    entityId: string;
    action: string;
    occurredAt: Date;
  }>
> {
  if (!db) return [];
  const rows = await db
    .select({
      id: schema.adminAuditEvents.id,
      actorEmail: schema.adminAuditEvents.actorEmail,
      entityType: schema.adminAuditEvents.entityType,
      entityId: schema.adminAuditEvents.entityId,
      action: schema.adminAuditEvents.action,
      occurredAt: schema.adminAuditEvents.occurredAt,
    })
    .from(schema.adminAuditEvents)
    .orderBy(desc(schema.adminAuditEvents.occurredAt))
    .limit(100);
  return rows;
}

const relativeTime = (d: Date): string => {
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
};

export default async function AdminPage() {
  const events = await loadAudit();

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 mx-auto w-full max-w-screen-2xl px-3 md:px-6 py-4 md:py-6 space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-muted-foreground" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
            <Badge variant="outline" className="text-xs">staff only</Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-prose">
            Audit log of operator actions — sweet-spot edits, manual data
            overrides, scraper kill-switches, paywall toggles. Read-only at
            the moment; mutation UIs land alongside the Clerk wiring.
          </p>
        </header>

        <section className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4">
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-muted-foreground" aria-hidden />
              <Input
                placeholder="Filter by actor, entity, or action…"
                className="h-9 w-72 max-w-full text-sm"
                disabled
                aria-label="Filter audit events"
              />
            </div>
            <Button variant="outline" size="sm" disabled>
              Export CSV
            </Button>
          </div>
          <Separator />
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
          ) : (
            <div className="overflow-x-auto">
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
                  {events.map((e) => (
                    <tr key={e.id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-3 md:px-4 py-2 whitespace-nowrap">
                        <time
                          dateTime={e.occurredAt.toISOString()}
                          title={e.occurredAt.toISOString()}
                        >
                          {relativeTime(e.occurredAt)}
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
        </section>
      </main>
    </div>
  );
}
