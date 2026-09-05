/** Opt-in real network smoke checks; never runs in the hermetic test suite. */
const base = process.env.POINTSNAP_TEST_URL || "http://127.0.0.1:3000";
const date =
  process.argv[2] ||
  new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const routes = [
  ["AS_MILEAGEPLAN", "SEA", "SFO"],
  ["B6_TRUEBLUE", "JFK", "LAX"],
  ["VS_FLYING_CLUB", "JFK", "LHR"],
];
let failed = false;
for (const [programs, origin, dest] of routes) {
  const params = new URLSearchParams({
    programs,
    origin,
    dest,
    departDate: date,
    pax: "1",
    minCabin: "Y",
  });
  const started = Date.now();
  try {
    const response = await fetch(`${base}/api/search?${params}`, {
      signal: AbortSignal.timeout(50000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    const events = body
      .split(/\r?\n\r?\n/)
      .filter((s) => s.startsWith("data: "))
      .map((s) => JSON.parse(s.slice(6)));
    const coverage = events.find((e) => e.type === "coverage")?.coverage;
    const rows = events.flatMap((e) => (e.type === "results" ? e.rows : []));
    if (
      !events.some((e) => e.type === "complete") ||
      !["success", "empty"].includes(coverage?.state)
    )
      throw new Error(coverage?.message || "Incomplete search");
    console.log(
      JSON.stringify({
        program: programs,
        origin,
        dest,
        date,
        state: coverage.state,
        rows: rows.length,
        ms: Date.now() - started,
        first: rows[0] ? { kind: rows[0].kind, prices: rows[0].prices } : null,
      }),
    );
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({ program: programs, error: error.message }));
  }
}
if (failed) process.exitCode = 1;
