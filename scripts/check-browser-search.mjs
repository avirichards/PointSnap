/** Explicit live integration probe. Does not run as part of the unit tests. */
const base = process.env.POINTSNAP_TEST_URL || "http://127.0.0.1:3000";
const program = process.env.POINTSNAP_TEST_PROGRAM || "AA_AADVANTAGE";
if (!["AA_AADVANTAGE", "DL_SKYMILES"].includes(program))
  throw new Error("Unsupported browser program.");
const [
  origin = "LAX",
  dest = "AUS",
  departDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  pax = "1",
] = process.argv.slice(2);
const query = new URLSearchParams({
  programs: program,
  origin,
  dest,
  departDate,
  pax,
  minCabin: "Y",
});
const started = Date.now();
try {
  const response = await fetch(`${base}/api/search?${query}`, {
    signal: AbortSignal.timeout(115000),
  });
  if (!response.ok)
    throw new Error(`PointSnap returned HTTP ${response.status}`);
  const body = await response.text();
  const events = body
    .split(/\r?\n\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  const coverage = events.find((event) => event.type === "coverage")?.coverage;
  const rows = events.flatMap((event) =>
    event.type === "results" ? event.rows : [],
  );
  const complete = events.some((event) => event.type === "complete");
  const result = {
    program,
    origin,
    dest,
    departDate,
    pax: Number(pax),
    durationMs: Date.now() - started,
    complete,
    coverage,
    itineraries: rows.length,
    fares: rows.reduce((count, row) => count + (row.fares?.length ?? 0), 0),
  };
  console.log(JSON.stringify(result));
  // A finished stream with a source error is not a successful flight search.
  if (!complete || !["success", "empty"].includes(coverage?.state))
    process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      program,
      durationMs: Date.now() - started,
      error: error.message,
    }),
  );
  process.exitCode = 1;
}
