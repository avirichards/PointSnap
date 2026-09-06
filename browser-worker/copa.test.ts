import { describe, expect, it } from "vitest";
import jfk from "../src/lib/award-search/__tests__/fixtures/copa-jfk-two.json";
import { copaResponseSchema } from "../src/lib/award-search/copa";
import {
  copaDateLabel,
  copaDisplayedIdentity,
  copaSourceIdentity,
} from "./copa";

describe("Copa public form and rendered itinerary matching", () => {
  it("matches a connecting flight independently of response order and layover duration", () => {
    const source = copaResponseSchema.parse(jfk.response)[0].solutions;
    const index = new Map(
      [...source].reverse().map((s) => [copaSourceIdentity(s), s]),
    );
    const identity = copaDisplayedIdentity(
      "UA 651 · CM 266",
      `UA 651 · CM 266
Layover in FLL (1h 31m)
01:35 pm
7h 44m
08:19 pm
Newark (EWR)
Panama (PTY)
Operated: United Airlines, Copa Airlines
View details`,
    );
    expect(identity).toBe("UA651·CM266|EWR|PTY|13:35|20:19|464");
    expect(index.get(identity)?.journeyTime).toBe("PT07H44M");
    expect(index.get(identity)?.flights[0].departure.airportCode).toBe("EWR");
  });

  it("keeps midnight, noon and total duration distinct and rejects missing journey details", () => {
    expect(
      copaDisplayedIdentity(
        "CM 1",
        "12:00 am\n12h\n12:00 pm\nA (JFK)\nB (PTY)",
      ),
    ).toBe("CM1|JFK|PTY|00:00|12:00|720");
    expect(() =>
      copaDisplayedIdentity(
        "CM 1",
        "Layover (1h 31m)\n12:00 am\n12:00 pm\nA (JFK)\nB (PTY)",
      ),
    ).toThrow("identity could not be confirmed");
  });

  it("uses the calendar's exact date names across month and ordinal boundaries", () => {
    expect(copaDateLabel("2026-12-01")).toBe("Tuesday, December 1st, 2026");
    expect(copaDateLabel("2026-10-11")).toBe("Sunday, October 11th, 2026");
    expect(copaDateLabel("2026-10-22")).toBe("Thursday, October 22nd, 2026");
  });
});
