import { describe, it, expect } from "vitest";
import {
  canonicalItinerary,
  itineraryHash,
  operatingFlightKey,
} from "../itineraryHash";

const sampleSegments = [
  {
    operatingAirlineIata: "NH",
    flightNumber: "9",
    departAt: "2026-08-14T11:10:00Z",
    originIata: "JFK",
    destIata: "NRT",
  },
];

describe("canonicalItinerary", () => {
  it("is stable for identical inputs", () => {
    const a = canonicalItinerary({
      programId: "NH_ANA",
      pax: 1,
      departDate: "2026-08-14",
      segments: sampleSegments,
    });
    const b = canonicalItinerary({
      programId: "NH_ANA",
      pax: 1,
      departDate: "2026-08-14",
      segments: sampleSegments,
    });
    expect(a).toBe(b);
  });

  it("sorts segments by departAt so order in input doesn't affect output", () => {
    const seg2 = {
      operatingAirlineIata: "UA",
      flightNumber: "79",
      departAt: "2026-08-14T18:00:00Z",
      originIata: "NRT",
      destIata: "BKK",
    };
    const a = canonicalItinerary({
      programId: "UA_MP",
      pax: 1,
      departDate: "2026-08-14",
      segments: [sampleSegments[0], seg2],
    });
    const b = canonicalItinerary({
      programId: "UA_MP",
      pax: 1,
      departDate: "2026-08-14",
      segments: [seg2, sampleSegments[0]],
    });
    expect(a).toBe(b);
  });

  it("differs across programs (same flight, different program = different result row)", () => {
    const a = itineraryHash({
      programId: "UA_MP",
      pax: 1,
      departDate: "2026-08-14",
      segments: sampleSegments,
    });
    const b = itineraryHash({
      programId: "NH_ANA",
      pax: 1,
      departDate: "2026-08-14",
      segments: sampleSegments,
    });
    expect(a).not.toBe(b);
  });

  it("differs across pax count", () => {
    const a = itineraryHash({
      programId: "UA_MP",
      pax: 1,
      departDate: "2026-08-14",
      segments: sampleSegments,
    });
    const b = itineraryHash({
      programId: "UA_MP",
      pax: 2,
      departDate: "2026-08-14",
      segments: sampleSegments,
    });
    expect(a).not.toBe(b);
  });
});

describe("itineraryHash", () => {
  it("produces a 64-char hex string", () => {
    const h = itineraryHash({
      programId: "NH_ANA",
      pax: 1,
      departDate: "2026-08-14",
      segments: sampleSegments,
    });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("operatingFlightKey", () => {
  it("formats as IATA+flight#@YYYYMMDDTHHMM UTC", () => {
    expect(operatingFlightKey("NH", "9", "2026-08-14T11:10:00Z")).toBe(
      "NH9@20260814T1110",
    );
    expect(operatingFlightKey("UA", "79", "2026-08-14T18:30:00Z")).toBe(
      "UA79@20260814T1830",
    );
  });

  it("normalizes timezone offsets to UTC", () => {
    const k1 = operatingFlightKey("UA", "79", "2026-08-14T13:30:00-05:00");
    const k2 = operatingFlightKey("UA", "79", "2026-08-14T18:30:00Z");
    expect(k1).toBe(k2);
  });
});
