import { beforeEach, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serverSupabase: db }));
import { GET, POST } from "../route";
beforeEach(() => vi.clearAllMocks());
it("requires authentication and prevents public caching", async () => {
  db.mockResolvedValue(null);
  for (const res of [
    await GET(),
    await POST(
      new Request("https://pointsnap.test/api/trips", {
        method: "POST",
        body: "{}",
      }),
    ),
  ]) {
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  }
});
it("rejects cross-origin writes before reaching personal data", async () => {
  const res = await POST(
    new Request("https://pointsnap.test/api/trips", {
      method: "POST",
      headers: { origin: "https://another-site.test" },
      body: "{}",
    }),
  );
  expect(res.status).toBe(403);
  expect(db).not.toHaveBeenCalled();
});
it("rejects malformed or oversized writes without mutating the database", async () => {
  const from = vi.fn();
  db.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from,
  });
  for (const body of [
    "not json",
    "x".repeat(100001),
    JSON.stringify({ action: "save", name: "Trip", snapshot: {} }),
  ])
    expect(
      (
        await POST(
          new Request("https://pointsnap.test/api/trips", {
            method: "POST",
            body,
          }),
        )
      ).status,
    ).toBe(400);
  expect(from).not.toHaveBeenCalled();
});
