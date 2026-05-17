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
import { seedAwardCharts, type AwardChartSeedSummary } from "./awardCharts";
import { seedAwardChartRules } from "./awardChartRules";

export interface SeedSummary {
  alliances: number;
  airlines: number;
  airports: number;
  aircraftTypes: number;
  programs: number;
  transferableCurrencies: number;
  transferRatios: number;
  transferBonuses: number;
  valuations: number;
  sweetSpots: number;
  awardCharts: AwardChartSeedSummary;
  awardChartRules: number;
}

export async function runSeed(): Promise<SeedSummary> {
  if (!db) {
    throw new Error(
      "DATABASE_URL not configured. Set it in environment before seeding.",
    );
  }

  await db.insert(alliances).values(ALLIANCES as never).onConflictDoNothing();

  await db
    .insert(airlines)
    .values(AIRLINES.map((a) => ({ ...a })))
    .onConflictDoNothing();

  await db.insert(airports).values(AIRPORTS as never).onConflictDoNothing();

  await db
    .insert(aircraftTypes)
    .values(AIRCRAFT.map((a) => ({ ...a })))
    .onConflictDoNothing();

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

  await db
    .insert(transferableCurrencies)
    .values(TRANSFERABLE_CURRENCIES as never)
    .onConflictDoNothing();

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

  let bonusInserted = 0;
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
    if (!ratio) continue;
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
    bonusInserted++;
  }

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

  const awardChartsSummary = await seedAwardCharts(db);
  const awardChartRulesCount = await seedAwardChartRules(db);

  return {
    alliances: ALLIANCES.length,
    airlines: AIRLINES.length,
    airports: AIRPORTS.length,
    aircraftTypes: AIRCRAFT.length,
    programs: PROGRAMS.length,
    transferableCurrencies: TRANSFERABLE_CURRENCIES.length,
    transferRatios: TRANSFER_RATIOS.length,
    transferBonuses: bonusInserted,
    valuations: VALUATIONS.length,
    sweetSpots: SWEET_SPOTS.length,
    awardCharts: awardChartsSummary,
    awardChartRules: awardChartRulesCount,
  };
}
