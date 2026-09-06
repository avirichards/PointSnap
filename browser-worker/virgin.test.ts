import { describe, expect, it } from "vitest";
import visible from "./fixtures/virgin-visible-jfk-lhr-two.json";
import raw from "../src/lib/award-search/fixtures/virgin-native-jfk-lhr-two.json";
import { virginPayloadSchema } from "../src/lib/award-search/virgin-native";
import { reconcileVirginCards } from "./virgin";
const q = {
  origin: "JFK",
  dest: "LHR",
  departDate: "2026-10-08",
  pax: 2,
  minCabin: "Y" as const,
};
const payload = virginPayloadSchema.parse(raw);
describe("Virgin visible flight reconciliation", () => {
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
