import { describe, it, expect, vi, afterEach } from "vitest";
import { parseAlaska, attachAlaskaCash, directSearch } from "../direct";
import { centsPerPoint } from "../value";
import alaska from "../fixtures/alaska.json";
import cash from "../fixtures/alaska-cash.json";
const q = {
  origin: "SEA",
  dest: "SFO",
  departDate: "2026-10-05",
  pax: 1,
  minCabin: "Y" as const,
};
const html = (value: unknown) =>
  `<script>__sveltekit_app.resolve(1, () => ${JSON.stringify(value)})</script>`;
const awards = () => parseAlaska(html(alaska), q);
describe("actual flight cash comparison", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("matches complete itineraries and same cabin; uses the lowest fare", () => {
    const rows = attachAlaskaCash(awards(), html(cash), q);
    const row = rows.find((r) => r.segments[0].flightNumber === "AS725")!;
    const solutions = cash[0].rows.find(
      (r) => r.segments[0].publishingCarrier.flightNumber === 725,
    )!.solutions;
    const lowest = Math.min(
      ...Object.values(solutions)
        .filter((s) => s.cabins.every((c) => c === "COACH"))
        .map((s) => s.grandTotal),
    );
    expect(row.prices.Y?.cashFare?.amount).toBe(lowest);
    expect(centsPerPoint(row.prices.Y)).toBeCloseTo(
      ((lowest - 5.6) / 20000) * 100,
    );
    expect(
      new URL(row.prices.Y!.cashFare!.bookingUrl).searchParams.get(
        "ShoppingMethod",
      ),
    ).toBe("online");
    expect(row.prices.Y?.cashFare?.bookingUrl).not.toContain("awardType");
  });
  it("does not match different dates, times, connections or mixed cabins", () => {
    const changed = awards();
    changed[0].segments[0].arrival = "2026-10-05T09:30:00-07:00";
    changed[1].prices.Y!.mixedCabin = true;
    const rows = attachAlaskaCash(changed, html(cash), q);
    expect(rows[0].prices.Y?.cashFare).toBeUndefined();
    expect(rows[1].prices.Y?.cashFare).toBeUndefined();
    expect(
      attachAlaskaCash(awards(), html(cash), {
        ...q,
        departDate: "2026-10-06",
      }).every((r) => !r.prices.Y?.cashFare),
    ).toBe(true);
  });
  it("never compares an award fee with itself as a cash fare", () => {
    expect(
      attachAlaskaCash(awards(), html(alaska), q).every(
        (r) => !r.prices.Y?.cashFare,
      ),
    ).toBe(true);
  });
  it("keeps award results when cash search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).includes("onlineaward")
          ? new Response(html(alaska))
          : new Response("Unavailable", { status: 503 }),
      ),
    );
    const early = vi.fn();
    const result = await directSearch(
      "AS_MILEAGEPLAN",
      q,
      new AbortController().signal,
      early,
    );
    expect(result).toHaveLength(2);
    expect(early).toHaveBeenCalledWith(result);
    expect(result[0].prices.Y?.cashFare).toBeUndefined();
  });
  it("does not silently convert currency or fill missing fees", () => {
    const p = attachAlaskaCash(awards(), html(cash), q)[0].prices.Y!;
    expect(centsPerPoint({ ...p, cash: null })).toBeNull();
    expect(centsPerPoint({ ...p, currency: "EUR" })).toBeNull();
    expect(centsPerPoint({ ...p, points: 0 })).toBeNull();
    expect(centsPerPoint({ ...p, points: NaN })).toBeNull();
    expect(centsPerPoint({ ...p, mixedCabin: true })).toBeNull();
  });
});
