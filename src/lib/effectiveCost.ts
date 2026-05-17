import type { Cabin } from "./types";

export interface EffectiveCostInputs {
  /** Miles required per passenger. */
  milesPerPax: number;
  /** Cash co-pay per pax (surcharge + taxes), in USD. */
  cashUsdPerPax: number;
  /** Number of passengers. */
  pax: number;
  /** Cents per point for the program (e.g. 1.5 cpp -> 1500). */
  programCppMicro: number;
  /**
   * Optional transfer context: user pays the program in transferable currency.
   * `ratioMicro` = currency_units -> program_units, scaled by 1000.
   * `bonusPct` (0-100) applied multiplicatively on top.
   */
  transfer?: {
    ratioMicro: number;
    bonusPct?: number;
    /** cpp_micro of the transferable currency itself; used as a sanity check */
    currencyCppMicro?: number;
  };
}

export interface EffectiveCost {
  /** Total cash co-pay across all pax, in USD cents. */
  cashCents: number;
  /** Total miles burned across all pax, in program units. */
  totalMiles: number;
  /**
   * Effective cost in USD cents = cashCents + (totalMiles × programCppMicro / 100000).
   * Lower is better; this is the canonical "best deal" sort key.
   */
  effectiveCents: number;
  /**
   * When transfer context is provided: how many transferable-currency units
   * we need to redeem, after applying the bonus.
   * Example: 60K Aeroplan from MR at 1:1 + 25% bonus = 48K MR effective.
   */
  transferCostUnits?: number;
}

/**
 * Canonical effective-cost calculation. Used for "best deal" sort, watcher
 * thresholds, and the wallet-gated sweet-spot query layer.
 *
 * `cppMicro` is cents-per-point * 1000 to dodge float round-trip.
 *  Example: 1.5 cpp -> 1500. 100k miles × 1500 / 100000 = $15.00 = 1500 cents.
 */
export function effectiveCost(inputs: EffectiveCostInputs): EffectiveCost {
  const { milesPerPax, cashUsdPerPax, pax, programCppMicro, transfer } = inputs;
  const totalMiles = milesPerPax * pax;
  const cashCents = Math.round(cashUsdPerPax * pax * 100);
  const milesValueCents = Math.round((totalMiles * programCppMicro) / 1000);
  const effectiveCents = cashCents + milesValueCents;

  let transferCostUnits: number | undefined;
  if (transfer) {
    const baseProgramFromOne = transfer.ratioMicro / 1000;
    const bonusMul = 1 + (transfer.bonusPct ?? 0) / 100;
    const effectiveRatio = baseProgramFromOne * bonusMul;
    transferCostUnits = Math.ceil(totalMiles / effectiveRatio);
  }

  return { cashCents, totalMiles, effectiveCents, transferCostUnits };
}

/** Format a number of miles as e.g. "75,000" or "75K" (short=true). */
export function formatMiles(miles: number, short = false): string {
  if (short) {
    if (miles >= 1_000_000)
      return `${(miles / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (miles >= 1_000) return `${(miles / 1_000).toFixed(0)}K`;
    return String(miles);
  }
  return miles.toLocaleString("en-US");
}

/** Format USD cents -> "$36" / "$1,250" */
export function formatUsdCents(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dollars >= 100 ? 0 : 2,
  }).format(dollars);
}

/** Cabin-aware sort: ascending miles, then ascending cash co-pay as tiebreak. */
export function compareByCabinMiles(
  a: { milesPerPax: number; cashUsdPerPax: number; cabin: Cabin },
  b: { milesPerPax: number; cashUsdPerPax: number; cabin: Cabin },
): number {
  if (a.cabin !== b.cabin) return 0;
  if (a.milesPerPax !== b.milesPerPax) return a.milesPerPax - b.milesPerPax;
  return a.cashUsdPerPax - b.cashUsdPerPax;
}
