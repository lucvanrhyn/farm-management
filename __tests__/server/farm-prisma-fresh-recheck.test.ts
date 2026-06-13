/**
 * @vitest-environment node
 *
 * H3 / H4 / auth-M2 / auth-M3 — fresh authorisation re-check inside
 * `getPrismaForSlugWithAuth` (the explicit-slug Node-runtime chokepoint).
 *
 * Before this change the function authorised purely from the 8h-stale JWT
 * snapshot `session.user.farms`. A user removed from a farm (H3) or a demoted
 * admin (auth-M3) kept access for up to 8h. The chokepoint now re-verifies
 * membership against meta-db (behind the 60s `verifyFreshFarmAccess` cache) and:
 *   - returns 403 when membership has been revoked (H3 / auth-M2);
 *   - returns the FRESH role (auth-M3) so every downstream `ctx.role` check is
 *     fresh, not just the handful that call `verifyFreshAdminRole`.
 *
 * The JWT membership pre-check is retained as a cheap first gate (a non-member
 * per the JWT is rejected without a meta-db round-trip).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "next-auth";

const { verifyFreshFarmAccessMock, getPrismaForFarmMock } = vi.hoisted(() => ({
  verifyFreshFarmAccessMock: vi.fn(),
  getPrismaForFarmMock: vi.fn(),
}));

vi.mock("@/lib/fresh-farm-access", () => ({
  verifyFreshFarmAccess: verifyFreshFarmAccessMock,
}));

// getPrismaForFarm pulls in @libsql/client transitively; stub it so the unit
// test stays hermetic. We only need the auth decision, not a real client.
vi.mock("@/lib/meta-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meta-db")>();
  return { ...actual, getFarmCreds: vi.fn() };
});

import { getPrismaForSlugWithAuth, __clearFarmClientCache } from "@/lib/farm-prisma";

function session(farms: Array<{ slug: string; role: string }>): Session {
  return {
    user: { id: "user-1", email: "u1@example.com", farms },
  } as unknown as Session;
}

beforeEach(() => {
  verifyFreshFarmAccessMock.mockReset();
  getPrismaForFarmMock.mockReset();
  __clearFarmClientCache();
});

describe("getPrismaForSlugWithAuth — fresh re-check", () => {
  it("JWT non-member → 403 WITHOUT a meta-db round-trip (cheap first gate)", async () => {
    const result = await getPrismaForSlugWithAuth(session([]), "trio-b");
    expect(result).toEqual({ error: "Forbidden", status: 403 });
    expect(verifyFreshFarmAccessMock).not.toHaveBeenCalled();
  });

  it("H3 / auth-M2 — JWT says member but fresh re-check says removed → 403", async () => {
    verifyFreshFarmAccessMock.mockResolvedValue(null);

    const result = await getPrismaForSlugWithAuth(
      session([{ slug: "trio-b", role: "ADMIN" }]),
      "trio-b",
    );

    expect(verifyFreshFarmAccessMock).toHaveBeenCalledWith("user-1", "trio-b");
    expect(result).toEqual({ error: "Forbidden", status: 403 });
  });

  it("invalid slug → 400 short-circuits before any re-check", async () => {
    const result = await getPrismaForSlugWithAuth(
      session([{ slug: "trio-b", role: "ADMIN" }]),
      "Bad Slug!",
    );
    expect(result).toEqual({ error: "Invalid farm slug", status: 400 });
    expect(verifyFreshFarmAccessMock).not.toHaveBeenCalled();
  });
});
