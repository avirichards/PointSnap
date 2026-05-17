import { Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import {
  SweetSpotList,
  type SweetSpotEntry,
} from "@/components/sweet-spots/sweet-spot-list";
import { db, schema } from "@/db";
import { asc, eq } from "drizzle-orm";
import type { Cabin } from "@/lib/types";

export const metadata = {
  title: "Sweet spots — PointSnap",
  description:
    "Curated high-value award redemptions across the launch programs. Filter by tag to find the kind of trip you want to plan.",
};

/**
 * Sweet spots page. Server-loads the 20 curated entries from the DB and hands
 * them to a client component for tag filtering. Rank-ordered (low = best).
 *
 * No auth gating — sweet spots are public marketing content. RBAC for the
 * "Edit sweet spot" admin UI lands with Clerk later.
 */
async function loadSweetSpots(): Promise<SweetSpotEntry[]> {
  if (!db) return [];
  const rows = await db
    .select({
      id: schema.sweetSpots.id,
      programId: schema.sweetSpots.programId,
      programName: schema.programs.name,
      title: schema.sweetSpots.title,
      cabin: schema.sweetSpots.cabin,
      milesOneWay: schema.sweetSpots.milesOneWay,
      approxSurchargeUsd: schema.sweetSpots.approxSurchargeUsd,
      notes: schema.sweetSpots.notes,
      sourceUrl: schema.sweetSpots.sourceUrl,
      rank: schema.sweetSpots.rank,
      tags: schema.sweetSpots.tags,
    })
    .from(schema.sweetSpots)
    .innerJoin(
      schema.programs,
      eq(schema.sweetSpots.programId, schema.programs.id),
    )
    .where(eq(schema.sweetSpots.active, true))
    .orderBy(asc(schema.sweetSpots.rank), asc(schema.sweetSpots.id));

  return rows.map((r) => ({
    id: r.id,
    programId: r.programId,
    programName: r.programName,
    title: r.title,
    cabin: r.cabin as Cabin,
    milesOneWay: r.milesOneWay,
    approxSurchargeUsd: r.approxSurchargeUsd,
    notes: r.notes,
    sourceUrl: r.sourceUrl,
    rank: r.rank,
    tags: r.tags ?? [],
  }));
}

export default async function SweetSpotsPage() {
  const spots = await loadSweetSpots();

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 mx-auto w-full max-w-screen-2xl px-3 md:px-6 py-4 md:py-6 space-y-4 focus:outline-none"
      >
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-muted-foreground" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">
              Sweet spots
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-prose">
            Hand-picked redemptions where a program prices unusually well for a
            specific route or cabin. These are starting points — the cockpit
            confirms current availability when you search.
          </p>
        </header>

        <SweetSpotList spots={spots} />
      </main>
    </div>
  );
}
