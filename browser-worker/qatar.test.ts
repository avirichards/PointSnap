import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import fixture from "../src/lib/award-search/fixtures/qatar-native-doh-lhr-two.json";
import { qatarPayloadSchema } from "../src/lib/award-search/qatar-native";
import {
  QatarBrowserRunner,
  qatarNeedsSignIn,
  qatarScopeFlights,
  reconcileQatarCard,
} from "./qatar";
const p = qatarPayloadSchema.parse(fixture);
describe("Qatar member-session recovery", () => {
  it("recognizes the actual logged-out dialog without mistaking the regular Log in header for a gate", () => {
    const url = "https://www.qatarairways.com/app/booking/redemption";
    expect(
      qatarNeedsSignIn(
        url,
        "Welcome back\nYou have been logged out. Please log in again.\nLog in",
      ),
    ).toBe(true);
    expect(qatarNeedsSignIn(url, "Log in\n7 results\nFlight details")).toBe(
      false,
    );
    expect(
      qatarNeedsSignIn(
        "https://www.qatarairways.com/en-us/Privilege-Club/login.html",
        "",
      ),
    ).toBe(true);
  });
  it.each([false, true])(
    "reports an expired session promptly (after navigation: %s)",
    async (afterNavigation) => {
      const goto = vi.fn(async () => {
        expired = true;
      });
      let expired = !afterNavigation;
      const context = { pages: () => [page] } as unknown as BrowserContext;
      const page = {
        url: () => "https://www.qatarairways.com/app/booking/redemption",
        context: () => context,
        setDefaultTimeout: vi.fn(),
        locator: () => ({
          innerText: async () =>
            expired
              ? "You have been logged out. Please log in again."
              : "Book a flight",
        }),
        on: vi.fn(),
        off: vi.fn(),
        goto,
      } as unknown as Page;
      const runner = new QatarBrowserRunner({
        run: async (_signal, visit) => visit(context),
        close: async () => {},
      });
      await expect(
        runner.search(
          {
            origin: "DOH",
            dest: "LHR",
            departDate: "2026-10-05",
            pax: 2,
            minCabin: "Y",
          },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 428, stage: "session" });
      expect(goto).toHaveBeenCalledTimes(afterNavigation ? 1 : 0);
      if (afterNavigation)
        expect(page.off).toHaveBeenCalledWith("response", expect.any(Function));
    },
  );
});
describe("Qatar visible inventory reconciliation", () => {
  it("matches the seven Economy-view cards and one premium-view card", () => {
    expect(
      qatarScopeFlights(p.searches[0].response.flightOffers, "ECONOMY"),
    ).toHaveLength(7);
    expect(
      qatarScopeFlights(p.searches[1].response.flightOffers, "PREMIUM"),
    ).toHaveLength(1);
  });
  it("checks the actual two-person Business card against expanded flight identity", () => {
    const f = p.searches[1].response.flightOffers.find(
      (f) => f.segments[0].flightNumber === "QR001",
    )!;
    const text =
      "12:40 DOH Non-stop, 8h 20m 18:00 LHR Flight details Business 172,000 Avios First Not available";
    expect(() =>
      reconcileQatarCard(
        text,
        "QR001 - Boeing 777-300ER - Qsuite",
        f,
        "PREMIUM",
      ),
    ).not.toThrow();
    expect(() =>
      reconcileQatarCard(
        text.replace("172,000", "86,000"),
        "QR001",
        f,
        "PREMIUM",
      ),
    ).toThrow(/price/);
    expect(() => reconcileQatarCard(text, "QR105", f, "PREMIUM")).toThrow(
      /itinerary/,
    );
  });
  it("accepts an omitted zero-minute suffix but rejects an incorrect duration", () => {
    const f = structuredClone(
      p.searches[1].response.flightOffers.find(
        (f) => f.segments[0].flightNumber === "QR001",
      )!,
    );
    f.duration = 32 * 3600;
    const text =
      "12:40 DOH 1 Stop, 32h 18:00 LHR Business 172,000 Avios First Not available";
    expect(() => reconcileQatarCard(text, "QR001", f, "PREMIUM")).not.toThrow();
    expect(() =>
      reconcileQatarCard(text.replace("32h", "32h 30m"), "QR001", f, "PREMIUM"),
    ).toThrow(/itinerary/);
    expect(() => reconcileQatarCard(text, "QR0012", f, "PREMIUM")).toThrow(
      /itinerary/,
    );
  });
});
