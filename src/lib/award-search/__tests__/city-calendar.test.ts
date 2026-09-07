import { describe, it, expect } from "vitest";
import { calendarDate, moveDate, moveMonth, monthDays } from "@/lib/calendar";
import { airportsForPlace, airportPairs } from "@/lib/search-places";
import {
  buildSearchTasks,
  aggregateSearchDays,
  summarizeCoverage,
} from "../date-window";
import { parseQuery, queryParams, assertPhysicalQuery } from "../query";
const now = new Date("2026-09-06T12:00:00Z");
describe("calendar and metro searches", () => {
  it("clamps calendar months without rolling dates and stays stable across DST", () => {
    expect(moveMonth("2028-01-31", 1)).toBe("2028-02-29");
    expect(moveMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(moveMonth("2028-02-29", 12)).toBe("2029-02-28");
    expect(moveDate("2026-03-08", 1)).toBe("2026-03-09");
    const grid = monthDays("2026-10-31");
    expect(grid).toHaveLength(6);
    expect(new Set(grid.flat()).size).toBe(42);
    expect(calendarDate(grid[0][0]).getUTCDay()).toBe(0);
  });
  it("expands every listed pair and date while keeping physical searches bounded by the queue", () => {
    expect(airportsForPlace("NYC")).toEqual(["JFK", "EWR", "LGA"]);
    expect(airportPairs("NYC", "LON")).toHaveLength(18);
    const tasks = buildSearchTasks("NYC", "LON", "2026-10-06", 3, now);
    expect(tasks).toHaveLength(126);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(126);
    expect(
      tasks.some((t) => t.origin === "LGA" && t.destination === "SEN"),
    ).toBe(true);
    expect(aggregateSearchDays(tasks)).toHaveLength(7);
    expect(airportPairs("NYC", "JFK")).toEqual([
      { origin: "EWR", destination: "JFK" },
      { origin: "LGA", destination: "JFK" },
    ]);
  });
  it("never lets a successful airport pair conceal a failed or unavailable pair", () => {
    const tasks = buildSearchTasks("NYC", "LAX", "2026-10-06", 0, now).map(
      (task, i) => ({
        ...task,
        state: "complete" as const,
        coverage: [
          {
            programId: "AA_AADVANTAGE",
            state: i === 0 ? ("success" as const) : ("unavailable" as const),
          },
        ],
      }),
    );
    expect(summarizeCoverage(tasks)[0].state).toBe("partial");
    expect(summarizeCoverage(tasks)[0].message).toContain(
      "1 of 3 airport/date checks",
    );
    expect(aggregateSearchDays(tasks)[0].state).toBe("error");
    tasks[1].state = "searching" as (typeof tasks)[1]["state"];
    expect(aggregateSearchDays(tasks)[0].state).toBe("searching");
  });
  it("preserves explicit exact return flexibility and legacy inheritance", () => {
    const q = parseQuery(
      new URLSearchParams(
        "origin=NYC&dest=LON&departDate=2026-10-06&returnDate=2026-10-16&flexDays=3&returnFlexDays=0",
      ),
      now,
    );
    expect(q.returnFlexDays ?? q.flexDays).toBe(0);
    expect(queryParams(q).get("returnFlexDays")).toBe("0");
    const old = parseQuery(
      new URLSearchParams(
        "origin=JFK&dest=LHR&departDate=2026-10-06&returnDate=2026-10-16&flexDays=3",
      ),
      now,
    );
    expect(old.returnFlexDays ?? old.flexDays).toBe(3);
    expect(() => assertPhysicalQuery(q)).toThrow();
    expect(() => assertPhysicalQuery(old)).not.toThrow();
  });
  it("clips outbound and return date windows without inventing unsearched dates", () => {
    expect(
      buildSearchTasks(
        "JFK",
        "LHR",
        "2026-10-06",
        3,
        now,
        undefined,
        "2026-10-07",
      ).map((t) => t.date),
    ).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
  });
  it("round-trips independent 14-day windows and expands every airport and date", () => {
    const params = new URLSearchParams(
      "origin=NYC&dest=LAX&departDate=2026-10-06&returnDate=2026-11-16&flexDays=14&returnFlexDays=9",
    );
    const q = parseQuery(params, now);
    expect(parseQuery(queryParams(q), now)).toEqual(q);
    const outbound = buildSearchTasks(
      q.origin,
      q.dest,
      q.departDate,
      q.flexDays!,
      now,
    );
    expect(outbound).toHaveLength(87);
    expect(new Set(outbound.map((task) => task.date)).size).toBe(29);
    const returning = buildSearchTasks(
      q.dest,
      q.origin,
      q.returnDate!,
      q.returnFlexDays!,
      now,
    );
    expect(returning).toHaveLength(57);
    for (const key of ["flexDays", "returnFlexDays"]) {
      const invalid = new URLSearchParams(params);
      invalid.set(key, "15");
      expect(() => parseQuery(invalid, now)).toThrow();
    }
  });
});
