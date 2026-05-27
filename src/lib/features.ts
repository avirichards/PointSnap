/**
 * Subscription-tier feature gates. Paywall is built but disabled at launch
 * (controlled by NEXT_PUBLIC_ENABLE_PAYWALL). When enabled, gates fire.
 */

export type Tier = "free" | "day_pass" | "pro" | "elite";

export interface FeatureGates {
  /** Search horizon beyond 60 days. */
  extendedSearch: boolean;
  /** Multi-origin / multi-destination input. */
  multiOriginDest: boolean;
  /** Aircraft type filter (A380, Qsuite, ANA Room, etc). */
  aircraftFilter: boolean;
  /** Direct-only + fee-max + airline filter (advanced filters). */
  advancedFilters: boolean;
  /** GDS fare-class inventory ("J7" = 7 seats). Elite only. */
  fareClassInventory: boolean;
  /** Public API access. Elite only. */
  apiAccess: boolean;
  /** Watcher count limit. -1 = unlimited. */
  maxWatchers: number;
  /** SMS alert channel. */
  smsAlerts: boolean;
  /** Push alert channel. */
  pushAlerts: boolean;
  /** Shadow-confirm verification on top results. */
  shadowConfirm: boolean;
  /** CSV / JSON export of any search. */
  exportAny: boolean;
}

const FREE: FeatureGates = {
  extendedSearch: false,
  multiOriginDest: false,
  aircraftFilter: false,
  advancedFilters: false,
  fareClassInventory: false,
  apiAccess: false,
  maxWatchers: 2,
  smsAlerts: false,
  pushAlerts: false,
  shadowConfirm: false,
  exportAny: false,
};

const DAY_PASS: FeatureGates = {
  ...FREE,
  extendedSearch: true,
  advancedFilters: true,
  shadowConfirm: true,
  pushAlerts: true,
  exportAny: true,
};

const PRO: FeatureGates = {
  ...DAY_PASS,
  multiOriginDest: true,
  aircraftFilter: true,
  smsAlerts: true,
  maxWatchers: 25,
};

const ELITE: FeatureGates = {
  ...PRO,
  fareClassInventory: true,
  apiAccess: true,
  maxWatchers: -1,
};

const GATES: Record<Tier, FeatureGates> = {
  free: FREE,
  day_pass: DAY_PASS,
  pro: PRO,
  elite: ELITE,
};

const PAYWALL_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PAYWALL === "true";

/**
 * Resolve feature gates for a user's tier. When the paywall is disabled
 * (launch mode), everyone gets `elite`-level features — paid tiers exist
 * as data only.
 */
export function gatesFor(tier: Tier): FeatureGates {
  if (!PAYWALL_ENABLED) return GATES.elite;
  return GATES[tier];
}

export function isPaywallEnabled(): boolean {
  return PAYWALL_ENABLED;
}
