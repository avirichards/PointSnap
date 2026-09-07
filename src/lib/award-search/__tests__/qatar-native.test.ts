import { describe, expect, it } from "vitest";
import two from "../fixtures/qatar-native-doh-lhr-two.json";
import connecting from "../fixtures/qatar-native-jfk-bkk-one.json";
import { bookingUrl } from "../../bookingHandoff";
import {
  parseQatarNative,
  qatarBookingUrl,
  qatarPayloadSchema,
} from "../qatar-native";
const q = {
  origin: "DOH",
  dest: "LHR",
  departDate: "2026-10-05",
  pax: 2,
  minCabin: "Y" as const,
};
const observedAt = "2026-09-07T01:52:00Z";
describe("Qatar native award quotes", () => {
  it("retains all fifteen connections, overnight arrivals and unconfirmed segment cabins", () => {
    const rows = parseQatarNative(
      connecting,
      { ...q, origin: "JFK", dest: "BKK", pax: 1 },
      observedAt,
    );
    expect(rows).toHaveLength(15);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(15);
    expect(
      rows.every(
        (r) =>
          r.segments.length === 2 &&
          r.fares!.every(
            (f) =>
              f.cabinUnconfirmed && f.segmentCabins?.every((c) => c === null),
          ),
      ),
    ).toBe(true);
    expect(rows.some((r) => r.duration === 32 * 60)).toBe(true);
    expect(rows[0].segments.at(-1)?.arrival).toBe("2026-10-07T06:20:00");
  });
  it("preserves all seven flights and eight fares, including distinct flights with identical clocks", () => {
    const rows = parseQatarNative(two, q, observedAt);
    expect(rows).toHaveLength(7);
    expect(rows.flatMap((r) => r.fares!)).toHaveLength(8);
    expect(
      rows.find((r) => r.segments[0].flightNumber === "QR105")?.prices.Y
        ?.points,
    ).toBe(21500);
    expect(
      rows.find((r) => r.segments[0].flightNumber === "QR011")?.prices.Y
        ?.points,
    ).toBe(43000);
    expect(
      rows.find((r) => r.segments[0].flightNumber === "QR001")?.prices.J,
    ).toMatchObject({
      points: 86000,
      partyPoints: 172000,
      quotedPassengers: 2,
      cabin: "J",
      seats: 3,
      cash: null,
      currency: null,
      segmentCabins: ["J"],
    });
    expect(
      rows.every((r) =>
        r.fares!.every(
          (f) =>
            f.eligibility?.type === "account" && f.cash === null && !f.cashFare,
        ),
      ),
    ).toBe(true);
  });
  it("does not keep a premium price withdrawn from the later premium search", () => {
    const p = structuredClone(two);
    for (const f of p.searches[1].response.flightOffers)
      f.fareOffers = f.fareOffers.filter((a) => a.cabinType !== "BUSINESS");
    expect(
      parseQatarNative(p, { ...q, minCabin: "J" }, observedAt),
    ).toHaveLength(0);
  });
  it("uses an exact dated ordinary airline handoff with party and Avios mode", () => {
    const u = new URL(qatarBookingUrl(q, "B"));
    expect(u.hostname).toBe("www.qatarairways.com");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      departing: q.departDate,
      fromStation: "DOH",
      toStation: "LHR",
      adults: "2",
      bookingClass: "B",
      qmilesFlow: "true",
      allowRedemption: "Y",
    });
    for (const cabin of ["Y", "J", "F"] as const) {
      const selected = new URL(
        bookingUrl("QR_PRIVILEGE", { ...q, minCabin: cabin }),
      );
      expect(selected.searchParams.get("bookingClass")).toBe(
        cabin === "Y" ? "E" : "B",
      );
      expect(selected.searchParams.get("adults")).toBe("2");
    }
  });
  it.each([
    "route",
    "date",
    "party",
    "scope",
    "missing-scope",
    "missing-segment",
    "duplicate",
    "seats",
    "cash-currency",
    "technical-stop",
  ])("rejects %s rather than claiming complete inventory", (kind) => {
    const p = structuredClone(two),
      s = p.searches[0],
      f = s.response.flightOffers[0];
    if (kind === "route") s.request.itineraries[0].origin = "JFK";
    if (kind === "date") s.request.itineraries[0].departureDate = "2026-10-06";
    if (kind === "party") s.request.passengers[0].count = 1;
    if (kind === "scope") s.request.cabinClass = "PREMIUM";
    if (kind === "missing-scope") p.searches.pop();
    if (kind === "missing-segment")
      f.fareOffers[0].fareInformation[0].flightId = "unknown";
    if (kind === "duplicate") s.response.flightOffers.push(structuredClone(f));
    if (kind === "seats") f.fareOffers[0].availableSeats = 1;
    if (kind === "cash-currency") f.fareOffers[0].price.currencyCode = "QAR";
    if (kind === "technical-stop")
      Object.assign(f.segments[0], { stops: [{ airport: "BAH" }] });
    expect(() => parseQatarNative(p, q, observedAt)).toThrow(/Qatar/);
  });
  it("strips account, session and selection metadata from the transport", () => {
    const p = structuredClone(two);
    Object.assign(p.searches[0].response, {
      account: { name: "Private" },
      token: "private",
      session: "private",
    });
    const cleaned = qatarPayloadSchema.parse(p);
    expect(JSON.stringify(cleaned)).not.toContain("private");
    expect(JSON.stringify(cleaned)).not.toContain("Private");
  });
});
