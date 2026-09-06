import { spawn, type ChildProcess } from "node:child_process";
import { access, chmod, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { PersistentBrowserSession } from "./persistent-session";

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

/** Owns only its dedicated Chrome process and profile, never a user's browser. */
class DesktopChrome {
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
    await access(executable, constants.X_OK);
    if (process.platform === "linux" && !process.env.DISPLAY)
      throw new Error(
        "Desktop Chrome requires a display, such as an operator display or Xvfb.",
      );
    const profile = resolve("work/browser-profiles/american-desktop-collector");
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
        "about:blank",
      ],
      { stdio: "ignore" },
    );
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
      const deadline = Date.now() + 20000;
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
        throw new Error("The dedicated Chrome process could not start.");
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
    } catch {
      await this.close();
      throw new Error("The dedicated desktop Chrome session could not open.");
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

export function createDesktopChromeSession() {
  const desktop = new DesktopChrome();
  return new PersistentBrowserSession(
    () => desktop.open(),
    () => desktop.close(),
  );
}
