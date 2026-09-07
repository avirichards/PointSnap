import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { progressSchema } from "../build-progress";

const run = promisify(execFile);
const script = fileURLToPath(
  new URL("../../../scripts/report-progress.mjs", import.meta.url),
);
const directories: string[] = [];
const prior = {
  updatedAt: "2026-09-05T08:00:00.000Z",
  active: true,
  focus: "Checking American",
  airlines: [
    {
      id: "AA_AADVANTAGE",
      name: "American AAdvantage",
      code: "AA",
      state: "investigating",
      summary: "Browser inventory verified",
      next: "Verify server transport",
      updatedAt: "2026-09-05T08:00:00.000Z",
    },
  ],
  events: [
    {
      id: "previous-event",
      at: "2026-09-05T08:00:00.000Z",
      airline: "American",
      kind: "finding",
      message: "Native server transport is not enabled.",
    },
  ],
};

async function setup(update: unknown) {
  const cwd = await mkdtemp(join(tmpdir(), "pointsnap-progress-test-"));
  directories.push(cwd);
  await mkdir(join(cwd, "work"));
  await writeFile(
    join(cwd, "work/live-progress.json"),
    JSON.stringify(prior, null, 2),
  );
  await writeFile(join(cwd, "update.json"), JSON.stringify(update));
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((cwd) => rm(cwd, { recursive: true, force: true })),
  );
});

describe("progress reporter", () => {
  it("merges a real airline status change without losing metadata or event history", async () => {
    const cwd = await setup({
      active: false,
      airlines: [
        {
          id: "AA_AADVANTAGE",
          state: "blocked",
          summary: "Booking entry returned403",
        },
      ],
      events: [
        {
          airline: "American",
          kind: "blocked",
          message: "Fresh anonymous entry was denied.",
        },
      ],
    });
    await run(process.execPath, [script, "update.json"], { cwd });
    const next = progressSchema.parse(
      JSON.parse(await readFile(join(cwd, "work/live-progress.json"), "utf8")),
    );
    expect(next.active).toBe(false);
    expect(next.airlines).toHaveLength(1);
    expect(next.airlines[0]).toMatchObject({
      name: "American AAdvantage",
      code: "AA",
      state: "blocked",
    });
    expect(next.events).toHaveLength(2);
    expect(next.events[0].message).toBe("Fresh anonymous entry was denied.");
    expect(next.events[1]).toEqual(prior.events[0]);
  });

  it("rejects the incompatible title/detail event format and preserves the last readable report byte for byte", async () => {
    const cwd = await setup({
      events: [
        { title: "American checked", detail: "This is not the feed contract." },
      ],
    });
    const path = join(cwd, "work/live-progress.json");
    const before = await readFile(path, "utf8");
    await expect(
      run(process.execPath, [script, "update.json"], { cwd }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("ZodError") });
    expect(await readFile(path, "utf8")).toBe(before);
  });
});
