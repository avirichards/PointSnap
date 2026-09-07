import { allFares, flightKey, groupFlights } from "./award-search/comparison";
import type { AwardResult } from "./award-search/types";
import type { SearchObservation } from "./search-history";

/** Keep each program's newest observation for a physical journey and party.
 * Rows/fare families from that same observation stay together. Parties never merge.
 */
export function observedFlightGroups(history: SearchObservation[]) {
  const scopes = new Map<string, { timestamp: number; rows: AwardResult[] }>();
  for (const observation of history) {
    const queryPax =
      Number(new URLSearchParams(observation.params).get("pax")) || 1;
    const batches = new Map<string, AwardResult[]>();
    for (const row of observation.rows) {
      if (row.kind !== "flight") continue;
      const byParty = Map.groupBy(
        allFares(row),
        (fare) => fare.quotedPassengers ?? queryPax,
      );
      for (const [pax, prices] of byParty) {
        const key = `${row.programId}:${flightKey(row)}:${row.date}:${pax}`;
        const fares = prices.map((p) => ({ ...p, quotedPassengers: pax }));
        const normalized = {
          ...row,
          fares,
          prices: Object.fromEntries(fares.map((p) => [p.cabin, p])),
        };
        batches.set(key, [...(batches.get(key) ?? []), normalized]);
      }
    }
    for (const [key, rows] of batches) {
      const timestamp = Math.max(
        ...rows.map((row) => Date.parse(row.observedAt) || 0),
      );
      if (!scopes.has(key) || timestamp > scopes.get(key)!.timestamp)
        scopes.set(key, { timestamp, rows });
    }
  }
  const byParty = Map.groupBy(
    [...scopes.values()].flatMap((scope) => scope.rows),
    (row) => allFares(row)[0].quotedPassengers!,
  );
  return [...byParty.entries()].flatMap(([pax, rows]) =>
    groupFlights(rows).map((group) => ({
      ...group,
      id: `${group.id}:party:${pax}`,
    })),
  );
}
