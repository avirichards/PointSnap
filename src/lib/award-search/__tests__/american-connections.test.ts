import { describe, expect, it } from "vitest";
import { americanConnections, parseAmerican } from "../american";
import { compactAmericanPayload } from "../../../../browser-worker/american";
import samples from "./fixtures/american-connection-samples.json";
import { type SearchQuery } from "@/lib/types";

const q = samples.query as SearchQuery;
const at = "2026-09-06T15:00:00Z";
const pair = (searches: unknown) => ({
  type: "american-cabin-searches",
  searches,
});
function expansion() {
  const baseline = structuredClone(samples.baseline);
  // Keep native nonstops and DFW flights for a single-connection test scope.
  for (const search of baseline)
    search.payload.slices = search.payload.slices.filter(
      (s) =>
        s.segments.length === 1 ||
        s.segments.some((s) =>
          s.legs.some((l) => l.destination.code === "DFW"),
        ),
    );
  return {
    type: "american-connection-searches",
    searches: [
      { connectionCity: null as string | null, payload: pair(baseline) },
      { connectionCity: "DFW", payload: pair(structuredClone(samples.dfw)) },
    ],
  };
}
describe("American connection-city expansion", () => {
  it("confirms 26 additional real itineraries in both DFW cabin searches", () => {
    const baseline = parseAmerican(pair(samples.baseline), q, at);
    const dfw = parseAmerican(pair(samples.dfw), q, at);
    expect(baseline).toHaveLength(52);
    expect(dfw).toHaveLength(43);
    const existing = new Set(baseline.map((r) => r.id));
    expect(dfw.filter((r) => !existing.has(r.id))).toHaveLength(26);
    expect(dfw.flatMap((r) => r.fares!)).toHaveLength(83);
  });
  it("keeps all supplied data when duplicated presentation fields are removed", () => {
    for (const s of [...samples.baseline, ...samples.dfw]) {
      const withUi = {
        ...s.payload,
        slices: s.payload.slices.map((s) => ({
          ...s,
          shoppingReference: "discard-me",
          unrelatedPresentation: [1, 2, 3],
        })),
      };
      const result = compactAmericanPayload(withUi);
      expect(parseAmerican(result, q, at)).toEqual(
        parseAmerican(withUi, q, at),
      );
      expect(JSON.stringify(result)).not.toContain("discard-me");
    }
  });
  it("merges physical itineraries and uses the newer all-cabin and premium quotes", () => {
    const payload = expansion();
    const rows = parseAmerican(payload, q, at);
    const expected = parseAmerican(pair(samples.dfw), q, at);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const row of expected)
      expect(rows.find((r) => r.id === row.id)).toEqual(row);
    expect(americanConnections(rows)).toEqual(["DFW"]);
    expect(rows.some((r) => r.segments.length === 1)).toBe(true);
  });
  it("rejects unsearched discovered airports, duplicated scopes and the wrong connection", () => {
    const missing = expansion();
    missing.searches[0].payload = pair(samples.baseline);
    expect(() => parseAmerican(missing, q, at)).toThrow(
      /unsearched connecting airports/,
    );
    const duplicate = expansion();
    duplicate.searches.push(duplicate.searches[1]);
    expect(() => parseAmerican(duplicate, q, at)).toThrow(
      /repeated or invalid/,
    );
    const wrong = expansion();
    wrong.searches[1].connectionCity = "ORD";
    expect(() => parseAmerican(wrong, q, at)).toThrow(
      /outside the requested connecting/,
    );
  });
  it("does not mistake intermediate stops on the same flight for connection targets", () => {
    const row = parseAmerican(pair(samples.dfw), q, at)[0];
    row.segments[1].flightNumber = row.segments[0].flightNumber;
    expect(americanConnections([row])).toEqual([]);
  });
});
