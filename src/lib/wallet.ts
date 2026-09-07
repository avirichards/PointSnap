import { z } from "zod";
import { localCalendarDay } from "./calendar";
import { PROGRAMS } from "./programs";
export const CURRENCIES = [
  { id: "AMEX_MR", name: "American Express Membership Rewards" },
  { id: "CHASE_UR", name: "Chase Ultimate Rewards" },
  { id: "CAP1_VENTURE", name: "Capital One Miles" },
  { id: "CITI_TY", name: "Citi ThankYou Points" },
  { id: "BILT", name: "Bilt Rewards" },
  { id: "MARRIOTT_BONVOY", name: "Marriott Bonvoy" },
  { id: "WELLS_FARGO", name: "Wells Fargo Rewards" },
];
export const WALLET_ASSETS = [
  ...CURRENCIES.map((c) => ({ ...c, kind: "currency" as const })),
  ...PROGRAMS.map((p) => ({
    id: p.id,
    name: p.name,
    kind: "program" as const,
  })),
];
export const balanceInput = z.object({
  assetId: z
    .string()
    .refine(
      (id) => WALLET_ASSETS.some((a) => a.id === id),
      "Choose a supported program.",
    ),
  balance: z.number().int().min(0).max(2_000_000_000),
  expiresOn: z.iso.date().nullable().optional(),
});
export const cardInput = z.object({ name: z.string().trim().min(1).max(80) });
export interface WalletEntry {
  asset_id: string;
  kind: "currency" | "program";
  balance: number;
  expires_on: string | null;
}
export interface WalletCard {
  id: string;
  name: string;
}
export interface WalletData {
  entries: WalletEntry[];
  cards: WalletCard[];
}

/** Expired entries cannot satisfy a booking or transfer shortfall. */
export function availableWalletBalance(
  wallet: WalletData | null,
  asset: string,
  today = localCalendarDay(),
): number | undefined {
  const entry = wallet?.entries.find((e) => e.asset_id === asset);
  if (!entry) return undefined;
  return entry.expires_on && entry.expires_on < today ? 0 : entry.balance;
}
