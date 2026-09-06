import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { SMILES_QUOTE_SCRIPT } from "./smiles-quote-script";

describe("Smiles public quote requests", () => {
  it("continues after the airline's explicit no-seat code while recording the withdrawn offer", async () => {
    const fetch = vi.fn(async (url: URL) =>
      url.searchParams.get("uid") === "withdrawn"
        ? Response.json({ code: "113", errorCode: "113" }, { status: 452 })
        : Response.json({ flightList: [] }),
    );
    const run = runInNewContext(`(${SMILES_QUOTE_SCRIPT})`, {
      URL,
      URLSearchParams,
      AbortSignal,
      fetch,
    });
    const result = await run({
      flights: ["withdrawn", "available"].map((uid) => ({
        uid,
        sourceGDS: "PARTNER",
        fareList: [{ uid: "fare", type: "SMILES" }],
      })),
      pax: 1,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      flightIndex: 0,
      unavailable: { code: "113", reason: "seats-unavailable" },
    });
    expect(result[0].tax).toBeUndefined();
    expect(result[1]).toMatchObject({
      flightIndex: 1,
      tax: { flightList: [] },
    });
  });
  it("uses the original payment identifier with each offer number so every baggage bundle is returned", async () => {
    const fetch = vi.fn(async (input: URL) => {
      if (input.pathname.endsWith("pricesm"))
        return Response.json({
          fareList: [1, 2].map((offer) => ({
            uid: `alternative-${offer}`,
            type: "SMILES_MONEY",
            offer,
          })),
        });
      return Response.json({ fareList: [] });
    });
    const run = runInNewContext(`(${SMILES_QUOTE_SCRIPT})`, {
      URL,
      URLSearchParams,
      AbortSignal,
      fetch,
    });
    const result = await run({
      flights: [
        {
          uid: "flight",
          sourceGDS: "G3",
          fareList: [
            { uid: "award-original", uidupsell: "upgrade", type: "SMILES" },
            {
              uid: "money-original",
              uidupsell: "upgrade",
              type: "SMILES_MONEY",
            },
          ],
        },
      ],
      pax: 2,
    });
    expect(result).toHaveLength(1);
    const requests = fetch.mock.calls.map(([url]) => url);
    const upsells = requests.filter((u) => u.pathname.endsWith("priceupsell"));
    expect(upsells.map((u) => Object.fromEntries(u.searchParams))).toEqual([
      { flightuid: "flight", fareuid: "award-original" },
      { flightuid: "flight", fareuid: "money-original", offer: "1" },
      { flightuid: "flight", fareuid: "money-original", offer: "2" },
    ]);
    expect(requests.at(-1)?.searchParams.get("adults")).toBe("2");
  });
  it("stops when a quote fails instead of silently losing an itinerary", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 452 }));
    const run = runInNewContext(`(${SMILES_QUOTE_SCRIPT})`, {
      URL,
      URLSearchParams,
      AbortSignal,
      fetch,
    });
    await expect(
      run({
        flights: [
          {
            uid: "flight",
            sourceGDS: "PARTNER",
            fareList: [{ uid: "fare", type: "SMILES" }],
          },
        ],
        pax: 1,
      }),
    ).rejects.toThrow("HTTP 452");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
