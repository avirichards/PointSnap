import { describe, expect, it } from "vitest";
import fixture from "../src/lib/award-search/fixtures/flying-blue-native-jfk-ams-two.json";
import { flyingBluePayloadSchema } from "../src/lib/award-search/flying-blue-native";
import {
  reconcileFlyingBlueCard,
  reconcileFlyingBlueFareHeadings,
} from "./flying-blue";

const payload = flyingBluePayloadSchema.parse(fixture);
const q = {
  origin: "JFK",
  dest: "AMS",
  departDate: "2026-10-08",
  pax: 2,
  minCabin: "Y" as const,
};
// Independently observed on the official KLM page, before expanding the fare.
const card = {
  text: "KLM 16:40 JFK Direct 7h20 +1 day 06:00 AMS Details Economy Lowest fare 58,000 Miles Price for 2 passengers Premium Comfort 652,000 Miles Price for 2 passengers Business 1,122,000 Miles Price for 2 passengers",
  clocks: ["16:40", "06:00"],
  tabs: [
    {
      label:
        "Learn more about the available fares in ECONOMY Class for flight 1.",
      text: "Economy Lowest fare 58,000 Miles Price for 2 passengers",
    },
    {
      label:
        "Learn more about the available fares in PREMIUM Class for flight 1.",
      text: "Premium Comfort 652,000 Miles Price for 2 passengers",
    },
    {
      label:
        "Learn more about the available fares in BUSINESS Class for flight 1.",
      text: "Business 1,122,000 Miles Price for 2 passengers",
    },
  ],
};
describe("Flying Blue displayed fare reconciliation", () => {
  it("matches the observed schedule and whole-party cabin prices", () => {
    expect(() =>
      reconcileFlyingBlueCard(card, payload.result.offerItineraries[0], q),
    ).not.toThrow();
    expect(() =>
      reconcileFlyingBlueFareHeadings(
        ["Economy 58,000 Miles  +USD 276.00 "],
        payload.expanded[0],
        "ECONOMY",
      ),
    ).not.toThrow();
  });
  it.each(["clock", "party", "points", "missing-cabin"])(
    "rejects a %s discrepancy",
    (kind) => {
      const c = structuredClone(card);
      if (kind === "clock") c.clocks[0] = "16:45";
      if (kind === "party")
        c.tabs[0].text = c.tabs[0].text.replace("2 passengers", "1 passenger");
      if (kind === "points")
        c.tabs[0].text = c.tabs[0].text.replace("58,000", "57,000");
      if (kind === "missing-cabin") c.tabs.pop();
      expect(() =>
        reconcileFlyingBlueCard(c, payload.result.offerItineraries[0], q),
      ).toThrow();
    },
  );
  it.each([
    ["Economy 58,000 Miles +USD 275.00"],
    ["Economy 58,000 Miles +EUR 276.00"],
    ["Economy 29,000 Miles +USD 138.00"],
    [],
    ["Economy 58,000 Miles +USD 276.00", "Economy 68,000 Miles +USD 276.00"],
  ])(
    "rejects different fees, currency, price basis or fare counts: %j",
    (...headings) => {
      expect(() =>
        reconcileFlyingBlueFareHeadings(
          headings as string[],
          payload.expanded[0],
          "ECONOMY",
        ),
      ).toThrow();
    },
  );
});
