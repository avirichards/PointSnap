import { describe, expect, it } from "vitest";
import { flightTimeStamp } from "../flight-time";

describe("exact airport-local flight instants", () => {
  it("matches offset and local times using the airport's actual daylight-saving rules", () => {
    expect(flightTimeStamp("2026-10-05T16:46:00", "LAX")).toBe(
      flightTimeStamp("2026-10-05T16:46:00-07:00", "LAX"),
    );
    expect(flightTimeStamp("2026-10-05T21:42:00", "AUS")).toBe(
      flightTimeStamp("2026-10-06T02:42:00Z", "AUS"),
    );
    expect(flightTimeStamp("2026-12-05T16:46:00", "LAX")).toBe(
      flightTimeStamp("2026-12-05T16:46:00-08:00", "LAX"),
    );
    expect(flightTimeStamp("2026-10-05T16:46:00", "DEL")).toBe(
      flightTimeStamp("2026-10-05T16:46:00+05:30", "DEL"),
    );
  });
  it("keeps repeated, missing or unknown-zone clocks from being assigned a guessed instant", () => {
    expect(flightTimeStamp("2026-11-01T01:30:00", "LAX")).toBeNull();
    expect(flightTimeStamp("2026-03-08T02:30:00", "LAX")).toBeNull();
    expect(flightTimeStamp("2026-02-30T12:00:00", "LAX")).toBeNull();
    expect(flightTimeStamp("2026-10-05T16:46:00", "ZZZ")).not.toBe(
      flightTimeStamp("2026-10-05T16:46:00-07:00", "ZZZ"),
    );
    expect(flightTimeStamp("2026-11-01T01:30:00-07:00", "LAX")).not.toBe(
      flightTimeStamp("2026-11-01T01:30:00-08:00", "LAX"),
    );
  });
});
