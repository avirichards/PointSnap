import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { safeNext } from "../auth-redirect";
vi.mock("@/lib/supabase/server", () => ({
  currentUser: vi.fn().mockResolvedValue(null),
}));
import { currentUser } from "../supabase/server";
import { resolveUserId } from "@/app/api/auth/airline/_userId";
it("ignores browser-supplied user IDs and development fallback", async () => {
  vi.stubEnv(
    "POINTSNAP_AUTH_DEV_USER_ID",
    "11111111-1111-4111-8111-111111111111",
  );
  expect(
    await resolveUserId(
      new NextRequest(
        "http://localhost/?userId=11111111-1111-4111-8111-111111111111",
      ),
      "11111111-1111-4111-8111-111111111111",
    ),
  ).toBeNull();
  vi.unstubAllEnvs();
});
it("resolves only a verified session", async () => {
  vi.mocked(currentUser).mockResolvedValueOnce({ id: "verified" } as Awaited<
    ReturnType<typeof currentUser>
  >);
  expect(await resolveUserId()).toBe("verified");
});
it("rejects off-site and backslash redirects", () => {
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\n/evil.example",
  ])
    expect(safeNext(value)).toBe("/wallet");
  expect(safeNext("/search?origin=JFK")).toBe("/search?origin=JFK");
});
