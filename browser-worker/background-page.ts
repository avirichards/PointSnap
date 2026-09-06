import type { BrowserContext, CDPSession, Page } from "playwright";

const desktopContexts = new WeakSet<BrowserContext>();
const preparedPages = new WeakMap<Page, Promise<CDPSession>>();

/** Register only the ordinary Chrome context launched and owned by this worker. */
export function registerBackgroundDesktopContext(context: BrowserContext) {
  desktopContexts.add(context);
}

export async function prepareCollectorPage(page: Page): Promise<void> {
  if (!desktopContexts.has(page.context())) return;
  let prepared = preparedPages.get(page);
  if (!prepared) {
    prepared = (async () => {
      const session = await page.context().newCDPSession(page);
      // Keep normal UI rendering/click stability alive without activating the
      // macOS application. This changes page focus, never the user's OS focus.
      page.once("close", () => void session.detach().catch(() => {}));
      return session;
    })();
    preparedPages.set(page, prepared);
    void prepared.catch(() => preparedPages.delete(page));
  }
  const session = await prepared;
  try {
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch (error) {
    preparedPages.delete(page);
    await session.detach().catch(() => {});
    throw error;
  }
}

/** context.newPage() normally activates Chrome even without bringToFront(). */
export async function createCollectorPage(
  context: BrowserContext,
): Promise<Page> {
  if (!desktopContexts.has(context)) return context.newPage();
  const browser = context.browser();
  if (!browser) throw new Error("The owned Chrome browser is unavailable.");
  const session = await browser.newBrowserCDPSession();
  let targetId: string | undefined;
  let resolveTarget!: (id: string) => void;
  const target = new Promise<string>((resolve) => {
    resolveTarget = resolve;
  });
  const incoming = context.waitForEvent("page", {
    timeout: 15000,
    predicate: async (page) => {
      let pageSession: CDPSession | undefined;
      try {
        pageSession = await context.newCDPSession(page);
        const info = await pageSession.send("Target.getTargetInfo");
        return info.targetInfo.targetId === (await target);
      } finally {
        await pageSession?.detach().catch(() => {});
      }
    },
  });
  // Attach a rejection handler immediately if creation fails before the event.
  void incoming.catch(() => {});
  try {
    const created = await session.send("Target.createTarget", {
      url: "about:blank",
      background: true,
    });
    targetId = created.targetId;
    resolveTarget(targetId);
    const page = await incoming;
    await prepareCollectorPage(page);
    return page;
  } catch (error) {
    resolveTarget("");
    if (targetId)
      await session.send("Target.closeTarget", { targetId }).catch(() => {});
    throw error;
  } finally {
    await session.detach().catch(() => {});
  }
}
