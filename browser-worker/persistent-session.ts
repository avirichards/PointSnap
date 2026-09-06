import type { BrowserContext } from "playwright";

function waitForTurn(previous: Promise<void>, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void previous.then(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
  });
}

/** One active search in an app-owned profile. The browser retains its own state. */
export class PersistentBrowserSession {
  private context?: Promise<BrowserContext>;
  // Keep ownership after a disconnect so shutdown can still reap the process.
  private resource?: Promise<BrowserContext>;
  private tail: Promise<void> = Promise.resolve();
  private stopped = false;
  private closing?: Promise<void>;

  constructor(
    private launch: () => Promise<BrowserContext>,
    private dispose: (context: BrowserContext) => Promise<void> = (context) =>
      context.close(),
  ) {}

  private getContext() {
    if (!this.context) {
      const previous = this.resource;
      const pending = (async () => {
        await previous
          ?.then((context) => this.dispose(context))
          .catch(() => {});
        return this.launch();
      })().then(
        (context) => {
          context.once("close", () => {
            if (this.context === pending) this.context = undefined;
          });
          return context;
        },
        (error) => {
          if (this.context === pending) this.context = undefined;
          throw error;
        },
      );
      this.context = pending;
      this.resource = pending;
    }
    return this.context;
  }

  async run<T>(
    signal: AbortSignal,
    visit: (context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    if (this.stopped) throw new Error("The browser session is closed.");
    const previous = this.tail;
    let release!: () => void;
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A cancelled queued job must not let the next job overtake an active one.
    this.tail = previous.then(() => finished);
    try {
      await waitForTurn(previous, signal);
      signal.throwIfAborted();
      if (this.stopped) throw new Error("The browser session is closed.");
      const context = await this.getContext();
      signal.throwIfAborted();
      if (this.stopped) throw new Error("The browser session is closed.");
      return await visit(context);
    } finally {
      release();
    }
  }

  close(): Promise<void> {
    this.stopped = true;
    this.closing ??= (async () => {
      const pending = this.resource;
      await pending?.then((context) => this.dispose(context)).catch(() => {});
      await this.tail;
      this.context = undefined;
      this.resource = undefined;
    })();
    return this.closing;
  }
}
