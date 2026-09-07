"use client";
import { useSyncExternalStore } from "react";
const empty: Record<string, number> = {};
let balances = empty;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
/** Temporary, intentionally not written to browser storage or a server. */
export function useSessionPoints() {
  const value = useSyncExternalStore(
    subscribe,
    () => balances,
    () => empty,
  );
  return {
    balances: value,
    set: (asset: string, amount: number | null) => {
      balances = { ...balances };
      if (amount === null) delete balances[asset];
      else if (Number.isSafeInteger(amount) && amount >= 0 && amount <= 2e9)
        balances[asset] = amount;
      listeners.forEach((fn) => fn());
    },
  };
}
