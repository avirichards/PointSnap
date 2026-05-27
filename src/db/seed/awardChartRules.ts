/**
 * Per-program structural rules for chart-priced programs. One row per program
 * in award_chart_rules. Routing & surcharge JSON shapes are open-ended; the
 * scraper plugins read them when normalizing search results and the cockpit
 * surfaces them in the "Routing rules" expander.
 */

import type { db } from "../index";
import { awardChartRules } from "../schema";

type DrizzleDb = NonNullable<typeof db>;

export interface AwardChartRuleSeed {
  programId: string;
  stopoversAllowed: number;
  stopoverFeeUsd: number | null;
  openJawAllowed: boolean;
  mixedCabinFormula:
    | "PRORATE_DISTANCE"
    | "HIGHEST_CABIN"
    | "PER_SEGMENT"
    | "DISALLOWED";
  routingRules: Record<string, unknown>;
  surchargeRule: Record<string, unknown> | null;
}

export const AWARD_CHART_RULES: AwardChartRuleSeed[] = [
  {
    programId: "BA_AVIOS",
    stopoversAllowed: 0, // BA allows stopovers only on multi-carrier RT awards
    stopoverFeeUsd: null,
    openJawAllowed: true,
    mixedCabinFormula: "HIGHEST_CABIN",
    routingRules: {
      maxStops: 2,
      requiresBaOperatedSegment: false,
      multiCarrierAvailable: true,
    },
    surchargeRule: {
      passthrough: true,
      base_usd: 0,
      per_segment_usd_typical: 175,
      notes: "BA-operated long-haul YQ is industry-high; partner-only itineraries materially cheaper.",
    },
  },
  {
    programId: "VS_FLYING_CLUB",
    stopoversAllowed: 1,
    stopoverFeeUsd: null,
    openJawAllowed: true,
    mixedCabinFormula: "HIGHEST_CABIN",
    routingRules: {
      maxStops: 2,
      partnerCharts: ["DL_SKYTEAM", "AF_KLM_SKYTEAM", "AC_OWN_METAL_VIA_PARTNER"],
    },
    surchargeRule: {
      passthrough: true,
      base_usd: 0,
      per_segment_usd_typical: 165,
      notes: "YQ on VS-operated and AF/KL partner segments. Delta partner segments YQ-free.",
    },
  },
  {
    programId: "NH_ANA",
    stopoversAllowed: 1,
    stopoverFeeUsd: null,
    openJawAllowed: true,
    mixedCabinFormula: "PRORATE_DISTANCE",
    routingRules: {
      maxStops: 3,
      rtOnly: true, // ANA partner awards are round-trip only
      requiresFirstSegmentOnHomeMetal: false,
    },
    surchargeRule: {
      passthrough: true,
      base_usd: 0,
      per_segment_usd_typical: 90,
      notes: "Passes YQ on most non-US partners. UA/AC segments are YQ-free.",
    },
  },
  {
    programId: "CX_CATHAY",
    stopoversAllowed: 2,
    stopoverFeeUsd: null,
    openJawAllowed: false,
    mixedCabinFormula: "PER_SEGMENT",
    routingRules: {
      maxRegionTransits: 2,
      rtFavored: true, // OW priced at ~55% of RT not 50%
    },
    surchargeRule: {
      passthrough: true,
      base_usd: 0,
      per_segment_usd_typical: 200,
      escalationHistory: [
        { date: "2026-03", change: "doubled" },
        { date: "2026-04", change: "+34%" },
        { date: "2026-05", change: "-13%" },
      ],
      notes: "Brutal YQ; cash co-pay frequently $400-700 for trans-Pacific J.",
    },
  },
];

export async function seedAwardChartRules(database: DrizzleDb): Promise<number> {
  for (const r of AWARD_CHART_RULES) {
    await database
      .insert(awardChartRules)
      .values({
        programId: r.programId,
        stopoversAllowed: r.stopoversAllowed,
        stopoverFeeUsd: r.stopoverFeeUsd,
        openJawAllowed: r.openJawAllowed,
        mixedCabinFormula: r.mixedCabinFormula,
        routingRules: r.routingRules,
        surchargeRule: r.surchargeRule,
      })
      .onConflictDoUpdate({
        target: awardChartRules.programId,
        set: {
          stopoversAllowed: r.stopoversAllowed,
          stopoverFeeUsd: r.stopoverFeeUsd,
          openJawAllowed: r.openJawAllowed,
          mixedCabinFormula: r.mixedCabinFormula,
          routingRules: r.routingRules,
          surchargeRule: r.surchargeRule,
        },
      });
  }
  return AWARD_CHART_RULES.length;
}
