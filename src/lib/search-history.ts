"use client";
import type { AwardResult } from "./award-search/types";
export interface SearchObservation {
  params: string;
  rows: AwardResult[];
  checkedAt: string;
}
const empty: SearchObservation[] = [];
let history = empty;
const listeners = new Set<() => void>();
export const searchHistory = {
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  read: () => history,
  server: () => empty,
};
/** Session-only observations, including conditional fares; never a public cache. */
export function rememberSearch(params: string, rows: AwardResult[]) {
  if (!rows.length) return;
  history = [
    { params, rows, checkedAt: new Date().toISOString() },
    ...history.filter((item) => item.params !== params),
  ].slice(0, 12);
  listeners.forEach((fn) => fn());
}
