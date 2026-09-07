import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import visible from "./fixtures/virgin-visible-jfk-lhr-two.json";
import raw from "../src/lib/award-search/fixtures/virgin-native-jfk-lhr-two.json";
import partnerVisible from "./fixtures/virgin-visible-lax-aus-partner.json";
import partnerRaw from "../src/lib/award-search/fixtures/virgin-native-lax-aus-partner.json";
import { virginPayloadSchema } from "../src/lib/award-search/virgin-native";
import { reconcileVirginCards, VirginBrowserRunner } from "./virgin";
const q = {
  origin: "JFK",
  dest: "LHR",
  departDate: "2026-10-08",
  pax: 2,
  minCabin: "Y" as const,
};
const payload = virginPayloadSchema.parse(raw);
describe("Virgin visible flight reconciliation", () => {
  it("preserves an operator's verification page when another customer starts a search", async () => {
    const goto = vi.fn();
    const context = { pages: () => [page] } as unknown as BrowserContext;
    const page = {
      url: () => "https://identity.virginatlantic.com/verification",
      context: () => context,
      setDefaultTimeout: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      goto,
    } as unknown as Page;
    const runner = new VirginBrowserRunner({
      run: async (_signal, visit) => visit(context),
      close: async () => {},
    });
    await expect(
      runner.search(q, new AbortController().signal),
    ).rejects.toMatchObject({ stage: "auth_required" });
    expect(goto).not.toHaveBeenCalled();
  });
  it("reconciles Delta Main Cabin and First Class alongside the airline's sold-out placeholders", () => {
    expect(() =>
      reconcileVirginCards(
        partnerVisible.cards,
        virginPayloadSchema.parse(partnerRaw),
        {
          origin: "LAX",
          dest: "AUS",
          departDate: "2026-10-05",
          pax: 1,
          minCabin: "Y",
        },
        partnerVisible.countText,
      ),
    ).not.toThrow();
  });
  it("reconciles the actual six-flight page, all available fares, party rounding and the sold-out cabin", () => {
    expect(() =>
      reconcileVirginCards(visible.cards, payload, q, visible.countText),
    ).not.toThrow();
  });
  it.each([
    "missing-flight",
    "more-flights",
    "price",
    "availability",
    "party",
    "flight-number",
  ])("rejects a %s discrepancy", (kind) => {
    const d = structuredClone(visible);
    if (kind === "missing-flight") d.cards.pop();
    if (kind === "more-flights") d.countText = "Showing 6 of 12 flights";
    if (kind === "price")
      d.cards[0].fareButtons[0].text = d.cards[0].fareButtons[0].text.replace(
        "140,000",
        "139,000",
      );
    if (kind === "availability")
      d.cards.at(-1)!.fareButtons.at(-1)!.disabled = false;
    if (kind === "party")
      d.cards[0].text = d.cards[0].text.replace("2 people", "1 person");
    if (kind === "flight-number")
      d.cards[0].text = d.cards[0].text.replace("VS26", "VS27");
    expect(() =>
      reconcileVirginCards(d.cards, payload, q, d.countText),
    ).toThrow();
  });
});
