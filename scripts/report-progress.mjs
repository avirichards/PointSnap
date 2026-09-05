/** Record actual work for the local follow-along page. Usage: node scripts/report-progress.mjs work/update.json */
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
const file = resolve("work/live-progress.json");
const update = JSON.parse(await readFile(process.argv[2], "utf8"));
const now = new Date().toISOString();
let previous = {
  updatedAt: now,
  active: true,
  focus: "",
  airlines: [],
  events: [],
};
try {
  previous = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const airlines = new Map(previous.airlines.map((row) => [row.id, row]));
for (const row of update.airlines ?? [])
  airlines.set(row.id, { ...airlines.get(row.id), ...row, updatedAt: now });
const next = {
  updatedAt: now,
  active: update.active ?? previous.active,
  focus: update.focus ?? previous.focus,
  airlines: [...airlines.values()],
  events: [
    ...(update.events ?? []).map((event) => ({
      id: randomUUID(),
      at: now,
      ...event,
    })),
    ...previous.events,
  ].slice(0, 150),
};
await mkdir(dirname(file), { recursive: true });
const temporary = file + ".tmp";
await writeFile(temporary, JSON.stringify(next, null, 2) + "\n");
await rename(temporary, file);
console.log(
  `Updated live progress: ${next.airlines.length} programs, ${next.events.length} events.`,
);
