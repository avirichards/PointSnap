/**
 * Idempotent seed orchestrator. Run with `pnpm db:seed`.
 *
 * Phase 1 coverage:
 *  - alliances, airlines, airports, aircraft_types (reference data, all real)
 *  - programs (13 launch programs, all real)
 *  - transferable_currencies, transfer_ratios, transfer_bonuses, valuations (all real)
 *  - sweet_spots (20 hand-curated launch entries, all real)
 *
 * Not yet seeded (deferred — see TODOs in seed/README.md):
 *  - award_charts + zones + cells + rules (need per-program full chart data; partial stubs only)
 *  - program_partnerships (full N x M fare-class matrix; coming next)
 *
 * All inserts use ON CONFLICT DO NOTHING / UPDATE so this is safe to re-run.
 */

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "../index";
import {
  alliances,
  airlines,
  airports,
  aircraftTypes,
  programs,
  transferableCurrencies,
  transferRatios,
  transferBonuses,
  valuations,
  sweetSpots,
} from "../schema";

import { ALLIANCES } from "./alliances";
import { AIRLINES } from "./airlines";
import { AIRPORTS } from "./airports";
import { AIRCRAFT } from "./aircraftTypes";
import { PROGRAMS } from "./programs";
import {
  TRANSFERABLE_CURRENCIES,
  TRANSFER_RATIOS,
  TRANSFER_BONUSES,
  VALUATIONS,
} from "./transferables";
import { SWEET_SPOTS } from "./sweetSpots";

async function main() {
  if (!db) {
    throw new Error(
      "DATABASE_URL not configured. Set it in .env.local before running the seed.",
    );
  }

  console.log("→ alliances");
  await db.insert(alliances).values(ALLIANCES as never).onConflictDoNothing();

  console.log("→ airlines");
  await db
    .insert(airlines)
    .values(AIRLINES.map((a) => ({ ...a })))
    .onConflictDoNothing();

  console.log("→ airports");
  await db.insert(airports).values(AIRPORTS as never).onConflictDoNothing();

  console.log("→ aircraft_types");
  await db
    .insert(aircraftTypes)
    .values(AIRCRAFT.map((a) => ({ ...a })))
    .onConflictDoNothing();

  console.log("→ programs");
  await db
    .insert(programs)
    .values(
      PROGRAMS.map((p) => ({
        id: p.id,
        sponsorAirlineIata: p.sponsorAirlineIata,
        name: p.name,
        pricingModel: p.pricingModel as "chart" | "dynamic" | "hybrid",
        fuelSurchargePassthrough: p.fuelSurchargePassthrough,
        expiryMonths: p.expiryMonths,
        notes: p.notes,
      })),
    )
    .onConflictDoNothing();

  console.log("→ transferable_currencies");
  await db
    .insert(transferableCurrencies)
    .values(TRANSFERABLE_CURRENCIES as never)
    .onConflictDoNothing();

  console.log("→ transfer_ratios");
  await db
    .insert(transferRatios)
    .values(
      TRANSFER_RATIOS.map((r) => ({
        currencyId: r.currencyId,
        programId: r.programId,
        ratioMicro: r.ratioMicro,
        minTransfer: r.minTransfer ?? 1000,
        increment: r.increment ?? 1000,
      })),
    )
    .onConflictDoNothing();

  console.log("→ transfer_bonuses (resolves transfer_ratio FK via SELECT)");
  for (const b of TRANSFER_BONUSES) {
    const [ratio] = await db
      .select({ id: transferRatios.id })
      .from(transferRatios)
      .where(
        and(
          eq(transferRatios.currencyId, b.currencyId),
          eq(transferRatios.programId, b.programId),
        ),
      )
      .limit(1);
    if (!ratio) {
      console.warn(`  skip — no ratio for ${b.currencyId} → ${b.programId}`);
      continue;
    }
    await db
      .insert(transferBonuses)
      .values({
        transferRatioId: ratio.id,
        bonusPct: b.bonusPct,
        startsAt: new Date(b.startsAt),
        endsAt: new Date(b.endsAt),
        sourceUrl: b.sourceUrl,
      })
      .onConflictDoNothing();
  }

  console.log("→ valuations");
  await db
    .insert(valuations)
    .values(
      VALUATIONS.map((v) => ({
        programId: v.programId ?? null,
        currencyId: v.currencyId ?? null,
        cppMicro: v.cppMicro,
        source: v.source,
        effectiveFrom: new Date(v.effectiveFrom),
      })),
    )
    .onConflictDoNothing();

  console.log("→ sweet_spots");
  await db
    .insert(sweetSpots)
    .values(
      SWEET_SPOTS.map((s) => ({
        programId: s.programId,
        title: s.title,
        originPattern: s.originPattern,
        destPattern: s.destPattern,
        cabin: s.cabin,
        milesOneWay: s.milesOneWay,
        approxSurchargeUsd: s.approxSurchargeUsd,
        notes: s.notes,
        sourceUrl: s.sourceUrl,
        curatedBy: s.curatedBy,
        rank: s.rank,
        tags: s.tags,
      })),
    )
    .onConflictDoNothing();

  console.log("✓ seed complete");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
