import { spawn, type ChildProcess } from "node:child_process";
import { access, chmod, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  BrowserSessionLaunchError,
  PersistentBrowserSession,
} from "./persistent-session";

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("A local browser port could not be allocated."));
        return;
      }
      server.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
}

type DesktopProgram =
  | "american"
  | "aeroplan"
  | "united"
  | "british-airways"
  | "qatar"
  | "virgin-atlantic"
  | "singapore"
  | "turkish"
  | "etihad"
  | "ana";

/** Owns only its dedicated Chrome process and profile, never a user's browser. */
class DesktopChrome {
  constructor(private readonly program: DesktopProgram) {}

  private process?: ChildProcess;
  private exited?: Promise<void>;
  private browser?: Browser;

  async open(): Promise<BrowserContext> {
    // An interrupted prior process must release the profile before relaunch.
    await this.close();
    const executable =
      process.env.POINTSNAP_DESKTOP_CHROME_EXECUTABLE ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : process.platform === "linux"
          ? "/usr/bin/google-chrome"
          : "");
    if (!isAbsolute(executable))
      throw new Error(
        "Configure the absolute path to an installed standard Chrome executable.",
      );
    await access(executable, constants.X_OK).catch(() => {
      throw new BrowserSessionLaunchError("browser-not-installed");
    });
    if (process.platform === "linux" && !process.env.DISPLAY)
      throw new BrowserSessionLaunchError("display-unavailable");
    const startupTimeoutMs = Number(
      process.env.POINTSNAP_DESKTOP_CHROME_STARTUP_TIMEOUT_MS ?? "20000",
    );
    if (
      !Number.isInteger(startupTimeoutMs) ||
      startupTimeoutMs < 1000 ||
      startupTimeoutMs > 60000
    )
      throw new Error(
        "Choose a Chrome startup deadline from 1000 to 60000 ms.",
      );
    const profile = resolve(
      `work/browser-profiles/${this.program}-desktop-collector`,
    );
    await mkdir(profile, { recursive: true, mode: 0o700 });
    await chmod(profile, 0o700);
    const port = await unusedLoopbackPort();
    const endpoint = `http://127.0.0.1:${port}`;
    const child = spawn(
      executable,
      [
        `--user-data-dir=${profile}`,
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${port}`,
        ...(process.env.POINTSNAP_DESKTOP_CHROME_SKIP_FIRST_RUN === "1"
          ? ["--no-first-run"]
          : []),
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    // Keep a bounded startup diagnostic in memory. Only an issue category is
    // returned; raw stderr, debugging URLs and profile paths are never logged.
    let startupDiagnostic = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (startupDiagnostic.length < 8192)
        startupDiagnostic += chunk
          .toString()
          .slice(0, 8192 - startupDiagnostic.length);
    });
    this.process = child;
    let stopped = false;
    this.exited = new Promise<void>((done) => {
      const exit = () => {
        stopped = true;
        done();
      };
      child.once("exit", exit);
      child.once("error", exit);
    });
    try {
      let ready = false;
      const deadline = Date.now() + startupTimeoutMs;
      while (!stopped && Date.now() < deadline) {
        ready = await fetch(`${endpoint}/json/version`, {
          signal: AbortSignal.timeout(500),
          redirect: "error",
        })
          .then((response) => response.ok)
          .catch(() => false);
        if (ready) break;
        await delay(250);
      }
      if (!ready || stopped)
        throw new BrowserSessionLaunchError(
          /no usable sandbox|failed to move to new namespace|sandbox.*operation not permitted/i.test(
            startupDiagnostic,
          )
            ? "sandbox-unavailable"
            : /processsingleton|profile.*in use/i.test(startupDiagnostic)
              ? "profile-in-use"
              : /missing x server|failed to initialize.*platform|cannot open display/i.test(
                    startupDiagnostic,
                  )
                ? "display-unavailable"
                : stopped
                  ? "process-exited"
                  : "debugging-startup-timeout",
        );
      this.browser = await chromium.connectOverCDP(endpoint, {
        noDefaults: true,
        timeout: 10000,
      });
      const context = this.browser.contexts()[0];
      if (!context)
        throw new Error(
          "Chrome did not provide its dedicated browser context.",
        );
      return context;
    } catch (error) {
      await this.close();
      if (error instanceof BrowserSessionLaunchError) throw error;
      throw new BrowserSessionLaunchError("debugging-connection-failed");
    }
  }

  async close() {
    const child = this.process,
      exited = this.exited,
      browser = this.browser;
    this.process = undefined;
    this.exited = undefined;
    this.browser = undefined;
    if (browser)
      await Promise.race([
        browser.close().catch(() => {}),
        delay(3000, undefined, { ref: false }),
      ]);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([exited, delay(3000, undefined, { ref: false })]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
  }
}

export function createDesktopChromeSession(
  program: DesktopProgram = "american",
) {
  const desktop = new DesktopChrome(program);
  return new PersistentBrowserSession(
    () => desktop.open(),
    () => desktop.close(),
  );
}
