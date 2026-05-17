import { Shield } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { AuditFeed, type AuditEvent } from "@/components/admin/audit-feed";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";

export const metadata = {
  title: "Admin — PointSnap",
  description: "Operator audit log and admin controls.",
};

/**
 * Admin shell. Reads from admin_audit_events server-side, then hands events
 * to the AuditFeed client component for filtering. RBAC (only-show-to-staff)
 * lands when Clerk is wired up — for now this is reachable to anyone but
 * shows no PII (audit log doesn't contain user-identifying data outside
 * actor_email which is the operator, not the customer).
 */
async function loadAudit(): Promise<AuditEvent[]> {
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
  return rows.map((r) => ({
    id: r.id,
    actorEmail: r.actorEmail,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    occurredAtIso: r.occurredAt.toISOString(),
  }));
}

export default async function AdminPage() {
  const events = await loadAudit();

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 mx-auto w-full max-w-screen-2xl px-3 md:px-6 py-4 md:py-6 space-y-6 focus:outline-none"
      >
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

        <AuditFeed events={events} />
      </main>
    </div>
  );
}
