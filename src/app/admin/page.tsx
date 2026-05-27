import { Shield } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { AuditFeed, type AuditEvent } from "@/components/admin/audit-feed";
import {
  AccountPoolPanel,
  type PoolRow,
} from "@/components/admin/account-pool-panel";
import { db, schema } from "@/db";
import { desc, eq, sql } from "drizzle-orm";

export const metadata = {
  title: "Admin — PointSnap",
  description: "Operator audit log + scraper account pool.",
};

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

async function loadAccountPool(): Promise<PoolRow[]> {
  if (!db) return [];
  // One row per program: counts by status + recent-usage. Programs without
  // any pool rows still appear (LEFT JOIN'd) so the operator sees gaps.
  const rows = await db.execute<{
    program_id: string;
    program_name: string;
    active: number;
    banned: number;
    exhausted: number;
    disabled: number;
    total: number;
    recently_used: number;
  }>(sql`
    SELECT
      p.id   AS program_id,
      p.name AS program_name,
      COALESCE(SUM(CASE WHEN ap.status = 'active' THEN 1 ELSE 0 END), 0)::int    AS active,
      COALESCE(SUM(CASE WHEN ap.status = 'banned' THEN 1 ELSE 0 END), 0)::int    AS banned,
      COALESCE(SUM(CASE WHEN ap.status = 'exhausted' THEN 1 ELSE 0 END), 0)::int AS exhausted,
      COALESCE(SUM(CASE WHEN ap.status = 'disabled' THEN 1 ELSE 0 END), 0)::int  AS disabled,
      COALESCE(COUNT(ap.id), 0)::int                                              AS total,
      COALESCE(SUM(CASE WHEN ap.last_used_at > now() - interval '1 hour' THEN 1 ELSE 0 END), 0)::int AS recently_used
    FROM programs p
    LEFT JOIN account_pool ap ON ap.program_id = p.id
    GROUP BY p.id, p.name
    ORDER BY p.name ASC
  `);
  return (rows as unknown as Array<{
    program_id: string;
    program_name: string;
    active: number;
    banned: number;
    exhausted: number;
    disabled: number;
    total: number;
    recently_used: number;
  }>).map((r) => ({
    programId: r.program_id,
    programName: r.program_name,
    active: r.active,
    banned: r.banned,
    exhausted: r.exhausted,
    disabled: r.disabled,
    total: r.total,
    recentlyUsed: r.recently_used,
  }));
}

export default async function AdminPage() {
  const [events, pool] = await Promise.all([loadAudit(), loadAccountPool()]);

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
            Operator surface — scraper account pool health, audit log of
            edits. Mutation UIs (add account, manual ban, override sweet
            spot, kill-switch a scraper) land alongside the Clerk wiring.
          </p>
        </header>

        <AccountPoolPanel rows={pool} />

        <AuditFeed events={events} />
      </main>
    </div>
  );
}
