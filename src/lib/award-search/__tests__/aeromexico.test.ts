import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchQuery } from "@/lib/types";
import {
  aeromexicoBookingUrl,
  aeromexicoSearch,
  parseAeromexico,
} from "../aeromexico";
import single from "../fixtures/aeromexico-single.json";
import party from "../fixtures/aeromexico-party.json";
import connecting from "../fixtures/aeromexico-connecting.json";
import pcc from "../fixtures/aeromexico-pcc.json";
import region from "../fixtures/aeromexico-region.json";

const q: SearchQuery = {
  origin: "MEX",
  dest: "CUN",
  departDate: "2026-10-05",
  pax: 1,
  minCabin: "Y",
};
const observedAt = "2026-09-05T04:38:53.148Z";
afterEach(() => vi.unstubAllGlobals());

describe("Aeromexico current anonymous points inventory", () => {
  it("retains every dated itinerary and fare family, including the Classic award", () => {
    const rows = parseAeromexico(single, q, observedAt);
    expect(rows).toHaveLength(11);
    expect(rows.flatMap((row) => row.fares ?? [])).toHaveLength(98);
    expect(rows[0].segments[0]).toMatchObject({
      flightNumber: "AM500",
      departure: "2026-10-05T06:01:00",
      arrival: "2026-10-05T09:51:00",
    });
    expect(rows[0].duration).toBe(170); // Mexico City and Cancun have different UTC offsets.
    expect(rows[0].prices.J).toMatchObject({
      points: 23000,
      cash: 943,
      currency: "MXN",
      seats: 1,
      fareName: "Premier Rewards · Classic award",
    });
    expect(rows[6].prices.Y).toMatchObject({
      points: 9700,
      cash: 943,
      currency: "MXN",
    });
    expect(rows.at(-1)?.segments[0].arrival).toBe("2026-10-06T01:24:00");
    expect(
      rows.every(
        (row) => row.observedAt === observedAt && row.kind === "flight",
      ),
    ).toBe(true);
  });

  it("keeps AM Plus choices in Economy and Premier choices in Business", () => {
    const rows = parseAeromexico(single, q);
    const plus = rows
      .flatMap((row) => row.fares ?? [])
      .filter((fare) => fare.fareName?.startsWith("AM Plus"));
    expect(plus).toHaveLength(27);
    expect(plus.every((fare) => fare.cabin === "Y")).toBe(true);
    expect(
      rows.every(
        (row) => row.prices.W === undefined && row.prices.F === undefined,
      ),
    ).toBe(true);
    expect(
      parseAeromexico(single, { ...q, minCabin: "J" }).flatMap(
        (row) => row.fares ?? [],
      ),
    ).toHaveLength(33);
  });

  it("uses source per-person points and cash without adding fees a second time", () => {
    const rows = parseAeromexico(party, { ...q, pax: 2 });
    expect(rows).toHaveLength(11);
    expect(rows.flatMap((row) => row.fares ?? [])).toHaveLength(98);
    expect(rows[6].prices.Y).toMatchObject({
      points: 9700,
      cash: 943,
      quotedPassengers: 2,
      currency: "MXN",
    });
    expect(rows[6].prices.Y?.partyPoints).toBeUndefined();
    // One-person Classic inventory disappears; the backend reprices business
    // fares for two people instead of doubling the one-person fare.
    expect(
      rows[0].fares?.some((fare) => fare.fareName?.includes("Classic award")),
    ).toBe(false);
    expect(rows[3].prices.J).toMatchObject({ points: 52900, seats: 3 });
    expect(rows[3].prices.J?.cash).toBe(943); // includes source TUA607 and booking fee321.
  });

  it("retains all 25 connecting itineraries and 237 fares without inventing segment cabins", () => {
    const rows = parseAeromexico(connecting, { ...q, origin: "GDL" });
    expect(rows).toHaveLength(25);
    expect(rows.flatMap((row) => row.fares ?? [])).toHaveLength(237);
    expect(
      rows.every(
        (row) =>
          row.segments.length === 2 &&
          row.segments[0].destination === "MEX" &&
          row.segments[1].origin === "MEX",
      ),
    ).toBe(true);
    expect(rows[0].duration).toBe(296);
    expect(rows[0].prices.Y).toMatchObject({
      points: 16900,
      cash: 1001,
      currency: "MXN",
      segmentCabins: [null, null],
    });
  });

  it("excludes positive seat counts below the requested party and preserves unknown counts", () => {
    const data = structuredClone(single);
    const rows = parseAeromexico(data, { ...q, pax: 2 });
    expect(rows.flatMap((row) => row.fares ?? [])).toHaveLength(91);
    data.outbound[0].fares[0].seatsRemaining = 0;
    expect(parseAeromexico(data, q)[0].fares?.[0].seats).toBeNull();
  });

  it("rejects incomplete, wrong-date, wrong-route, non-award and warning responses", () => {
    expect(() => parseAeromexico({ ...single, outbound: null }, q)).toThrow(
      /incomplete/,
    );
    expect(() =>
      parseAeromexico(single, { ...q, departDate: "2026-10-06" }),
    ).toThrow(/different/);
    const broken = structuredClone(connecting);
    broken.outbound[0].legCollection[0].segments.pop();
    expect(() => parseAeromexico(broken, { ...q, origin: "GDL" })).toThrow();
    const cashOnly = structuredClone(single);
    delete (cashOnly.outbound[0].fares[0].currency as { points?: number })
      .points;
    expect(() => parseAeromexico(cashOnly, q)).toThrow(/invalid award/);
    expect(() =>
      parseAeromexico({ ...single, warnings: [{ code: "PARTIAL" }] }, q),
    ).toThrow(/warnings/);
  });

  it("uses the normal unauthenticated PCC, route and exact points POST", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("getPccInfo")) return Response.json(pcc);
        if (String(url).endsWith("regionByRoute")) return Response.json(region);
        return Response.json(single);
      }),
    );
    const rows = await aeromexicoSearch(q, new AbortController().signal);
    expect(rows.flatMap((row) => row.fares ?? [])).toHaveLength(98);
    expect(calls).toHaveLength(3);
    const search = calls.find((call) => call.init?.method === "POST")!;
    expect(search.url).toBe(
      "https://amx-c-bkngbk-pd.aeromexico.com/bc/ow/search/flight/points",
    );
    expect(search.init?.headers).toMatchObject({
      cityCode: "D5GE",
      locale: "MZ",
      currency: "MXN",
      travelers: "A1_C0_I0_PH0_PC0",
      promoCodes: "RED22",
    });
    expect(JSON.parse(String(search.init?.body))).toEqual({
      accountNumber: "",
      arrivalAirportLoyaltyZone: "Z02",
      arrivalAirportRegion: "PLA",
      cobrandCard: "",
      departureAirportLoyaltyZone: "Z01",
      departureAirportRegion: "LOC",
      planMultiplica: "",
      promoCode: "",
      tier: "",
    });
    expect(
      calls.every((call) => !new Headers(call.init?.headers).has("Cookie")),
    ).toBe(true);
    expect(aeromexicoBookingUrl(q)).not.toMatch(
      /token|trackcookie|trackid|execution/i,
    );
  });

  it("reports an access boundary instead of an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Denied", { status: 403 })),
    );
    await expect(
      aeromexicoSearch(q, new AbortController().signal),
    ).rejects.toThrow("HTTP 403");
  });
});
