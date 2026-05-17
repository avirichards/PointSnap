import { describe, it, expect } from "vitest";
import { effectiveCost, formatMiles, formatUsdCents } from "../effectiveCost";

describe("effectiveCost", () => {
  it("computes ANA 75k J + $36 cash at 1.7cpp -> $1,311 effective", () => {
    const r = effectiveCost({
      milesPerPax: 75000,
      cashUsdPerPax: 36,
      pax: 1,
      programCppMicro: 1700,
    });
    expect(r.totalMiles).toBe(75000);
    expect(r.cashCents).toBe(3600);
    // 75000 * 1700 / 100000 = 1275.00 -> 127500 cents -> + 3600 = 131100
    expect(r.effectiveCents).toBe(131100);
  });

  it("multiplies by pax", () => {
    const r = effectiveCost({
      milesPerPax: 75000,
      cashUsdPerPax: 36,
      pax: 2,
      programCppMicro: 1700,
    });
    expect(r.totalMiles).toBe(150000);
    expect(r.cashCents).toBe(7200);
    expect(r.effectiveCents).toBe(262200);
  });

  it("computes transfer cost: 60K Aeroplan from MR 1:1 + 25% bonus -> 48K MR", () => {
    const r = effectiveCost({
      milesPerPax: 60000,
      cashUsdPerPax: 0,
      pax: 1,
      programCppMicro: 1500,
      transfer: { ratioMicro: 1000, bonusPct: 25 },
    });
    // 60000 / (1.0 * 1.25) = 48000
    expect(r.transferCostUnits).toBe(48000);
  });

  it("handles 2:1 Marriott->airline transfer", () => {
    const r = effectiveCost({
      milesPerPax: 50000,
      cashUsdPerPax: 0,
      pax: 1,
      programCppMicro: 1500,
      transfer: { ratioMicro: 500 },
    });
    // ratio = 0.5 program per currency unit -> need 100000 Marriott
    expect(r.transferCostUnits).toBe(100000);
  });
});

describe("formatMiles", () => {
  it("formats long", () => {
    expect(formatMiles(75000)).toBe("75,000");
  });
  it("formats short", () => {
    expect(formatMiles(75000, true)).toBe("75K");
    expect(formatMiles(1_500_000, true)).toBe("1.5M");
    expect(formatMiles(1_000_000, true)).toBe("1M");
    expect(formatMiles(800, true)).toBe("800");
  });
});

describe("formatUsdCents", () => {
  it("formats small amounts with cents", () => {
    expect(formatUsdCents(3600)).toBe("$36.00");
  });
  it("formats large amounts without cents", () => {
    expect(formatUsdCents(131100)).toBe("$1,311");
  });
});
