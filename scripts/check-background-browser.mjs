/** Manual local-only qualification. No airline navigation or account access. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readlink, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { require as tsRequire } from "tsx/cjs/api";
const { createDesktopChromeSession } = tsRequire(
  "../browser-worker/desktop-chrome.ts",
  import.meta.url,
);
const { createCollectorPage, prepareCollectorPage } = tsRequire(
  "../browser-worker/background-page.ts",
  import.meta.url,
);
if (process.platform !== "darwin")
  throw Error(
    "This manual background-focus qualification requires macOS and installed Chrome.",
  );
const foreground = () =>
  JSON.parse(
    execFileSync(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        "ObjC.import('AppKit'); const a=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(a.processIdentifier),bundle:ObjC.unwrap(a.bundleIdentifier)});",
      ],
      { encoding: "utf8" },
    ),
  );
const originalCwd = process.cwd();
await mkdir("work", { recursive: true });
const root = await mkdtemp(resolve("work/background-browser-check-"));
process.chdir(root);
process.env.POINTSNAP_DESKTOP_CHROME_SKIP_FIRST_RUN = "1";
const before = foreground();
const owner = createDesktopChromeSession("british-airways");
let ownedPid;
const checks = [];
const verifyFocus = (stage) => {
  assert.equal(foreground().pid, before.pid, stage);
  checks.push(stage);
};
try {
  await owner.run(AbortSignal.timeout(45000), async (context) => {
    const lock = await readlink(
      resolve(
        "work/browser-profiles/british-airways-desktop-collector/SingletonLock",
      ),
    );
    ownedPid = Number(lock.match(/-(\d+)$/)[1]);
    verifyFocus("cold launch");
    const page = await createCollectorPage(context);
    verifyFocus("new background tab");
    await page.setContent(
      '<label>Name<input aria-label="Name"></label><a href="about:blank" target="_blank">Open result</a>',
    );
    await page.getByRole("textbox", { name: "Name" }).fill("PointSnap");
    await page
      .getByRole("link", { name: "Open result" })
      .click({ timeout: 6000 });
    verifyFocus("normal fill and popup");
  });
  await owner.run(AbortSignal.timeout(10000), async (context) => {
    const page = context.pages().find((p) => p.url() === "about:blank");
    await prepareCollectorPage(page);
    await page.setContent(
      "<button onclick=\"this.textContent='Done'\">Continue</button>",
    );
    await page.getByRole("button", { name: "Continue" }).click();
    assert.equal(await page.getByRole("button").innerText(), "Done");
    verifyFocus("reused page");
  });
  await owner.run(AbortSignal.timeout(10000), async (context) => {
    await context.browser().close();
  });
  const oldPid = ownedPid;
  await owner.run(AbortSignal.timeout(45000), async (context) => {
    assert.throws(() => process.kill(oldPid, 0));
    const lock = await readlink(
      resolve(
        "work/browser-profiles/british-airways-desktop-collector/SingletonLock",
      ),
    );
    ownedPid = Number(lock.match(/-(\d+)$/)[1]);
    await createCollectorPage(context);
    verifyFocus("disconnected owner recovery");
  });
} finally {
  await owner.close();
}
assert.throws(() => process.kill(ownedPid, 0));
verifyFocus("owned Chrome closed");
process.chdir(originalCwd);
await rm(root, { recursive: true, force: true });
console.log(
  JSON.stringify({ checks, focusPreserved: true, ownedProcessReaped: true }),
);
