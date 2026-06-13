// @vitest-environment node
/**
 * lib/__tests__/fresh-farm-access.test.ts
 *
 * H3 / H4 / auth-M2 — fresh per-(user, slug) authorisation re-check at the
 * Node-runtime tenant chokepoint.
 *
 * proxy.ts trusts the 8h JWT snapshot `token.farms`, so a user removed from a
 * farm (H3), a lapsed subscription (H4), or a demoted admin keeps access for up
 * to 8h. `verifyFreshFarmAccess(userId, slug)` re-reads the canonical farms
 * list from meta-db (`getFarmsForUser`) behind a short-TTL in-memory cache so
 * the hot path stays fast while revocation propagates within the TTL.
 *
 * Cache pattern mirrors `lib/farm-creds-cache.ts` (globalThis Map + TTL).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UserFarm } from "@/lib/meta-db";

const { getFarmsForUserMock } = vi.hoisted(() => ({
  getFarmsForUserMock: vi.fn(),
}));

vi.mock("@/lib/meta-db", () => ({
  getFarmsForUser: getFarmsForUserMock,
}));

import {
  verifyFreshFarmAccess,
  __clearFreshFarmAccessCache,
  FRESH_FARM_ACCESS_TTL_MS,
} from "@/lib/fresh-farm-access";

function farm(partial: Partial<UserFarm>): UserFarm {
  return {
    slug: "delta-livestock",
    displayName: "Delta Livestock",
    role: "ADMIN",
    logoUrl: null,
    tier: "advanced",
    subscriptionStatus: "active",
    ...partial,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  getFarmsForUserMock.mockReset();
  __clearFreshFarmAccessCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyFreshFarmAccess — membership + freshness", () => {
  it("returns the fresh farm record for a current member with an active sub", async () => {
    getFarmsForUserMock.mockResolvedValue([farm({ slug: "delta-livestock" })]);

    const result = await verifyFreshFarmAccess("u1", "delta-livestock");

    expect(result).not.toBeNull();
    expect(result?.slug).toBe("delta-livestock");
    expect(result?.role).toBe("ADMIN");
    expect(result?.subscriptionStatus).toBe("active");
  });

  it("H3 — returns null for a user removed from the farm (no matching slug)", async () => {
    getFarmsForUserMock.mockResolvedValue([farm({ slug: "some-other-farm" })]);

    const result = await verifyFreshFarmAccess("u1", "delta-livestock");

    expect(result).toBeNull();
  });

  it("H3 — returns null when the user has no farms at all", async () => {
    getFarmsForUserMock.mockResolvedValue([]);

    const result = await verifyFreshFarmAccess("u1", "delta-livestock");

    expect(result).toBeNull();
  });

  it("auth-M3 — surfaces the FRESH role after a demotion (no longer ADMIN)", async () => {
    getFarmsForUserMock.mockResolvedValue([
      farm({ slug: "delta-livestock", role: "LOGGER" }),
    ]);

    const result = await verifyFreshFarmAccess("u1", "delta-livestock");

    expect(result?.role).toBe("LOGGER");
  });

  it("H4 — surfaces a lapsed subscription status (inactive)", async () => {
    getFarmsForUserMock.mockResolvedValue([
      farm({ slug: "delta-livestock", subscriptionStatus: "inactive" }),
    ]);

    const result = await verifyFreshFarmAccess("u1", "delta-livestock");

    // Membership is still valid — the CALLER decides whether `inactive` gates.
    // This helper's job is to surface the FRESH status, not the 8h-stale one.
    expect(result?.subscriptionStatus).toBe("inactive");
  });
});

describe("verifyFreshFarmAccess — short-TTL cache", () => {
  it("cache hit within TTL avoids a second getFarmsForUser round-trip", async () => {
    getFarmsForUserMock.mockResolvedValue([farm({ slug: "delta-livestock" })]);

    await verifyFreshFarmAccess("u1", "delta-livestock");
    await verifyFreshFarmAccess("u1", "delta-livestock");

    expect(getFarmsForUserMock).toHaveBeenCalledTimes(1);
  });

  it("re-queries after the TTL expires — picks up a removed membership (H3)", async () => {
    getFarmsForUserMock.mockResolvedValueOnce([farm({ slug: "delta-livestock" })]);

    const first = await verifyFreshFarmAccess("u1", "delta-livestock");
    expect(first).not.toBeNull();

    // Membership revoked in meta-db after the first cache fill.
    getFarmsForUserMock.mockResolvedValue([]);

    // Within TTL → still served from cache (stale ALLOW — bounded by TTL).
    vi.advanceTimersByTime(FRESH_FARM_ACCESS_TTL_MS - 1);
    expect(await verifyFreshFarmAccess("u1", "delta-livestock")).not.toBeNull();

    // After TTL → re-query reflects the revocation.
    vi.advanceTimersByTime(2);
    expect(await verifyFreshFarmAccess("u1", "delta-livestock")).toBeNull();
    expect(getFarmsForUserMock).toHaveBeenCalledTimes(2);
  });

  it("re-queries after the TTL expires — picks up a lapsed subscription (H4)", async () => {
    getFarmsForUserMock.mockResolvedValueOnce([
      farm({ slug: "delta-livestock", subscriptionStatus: "active" }),
    ]);
    const first = await verifyFreshFarmAccess("u1", "delta-livestock");
    expect(first?.subscriptionStatus).toBe("active");

    getFarmsForUserMock.mockResolvedValue([
      farm({ slug: "delta-livestock", subscriptionStatus: "inactive" }),
    ]);

    vi.advanceTimersByTime(FRESH_FARM_ACCESS_TTL_MS + 1);
    const second = await verifyFreshFarmAccess("u1", "delta-livestock");
    expect(second?.subscriptionStatus).toBe("inactive");
  });

  it("caches per (user, slug) — different users do not share entries", async () => {
    getFarmsForUserMock.mockImplementation(async (userId: string) => {
      if (userId === "u1") return [farm({ slug: "delta-livestock", role: "ADMIN" })];
      return [farm({ slug: "delta-livestock", role: "LOGGER" })];
    });

    const u1 = await verifyFreshFarmAccess("u1", "delta-livestock");
    const u2 = await verifyFreshFarmAccess("u2", "delta-livestock");

    expect(u1?.role).toBe("ADMIN");
    expect(u2?.role).toBe("LOGGER");
    expect(getFarmsForUserMock).toHaveBeenCalledTimes(2);
  });

  it("FAIL-CLOSED — a meta-db error resolves to null (deny) and is NOT cached", async () => {
    getFarmsForUserMock.mockRejectedValueOnce(new Error("meta-db unreachable"));

    const result = await verifyFreshFarmAccess("u1", "delta-livestock");
    expect(result).toBeNull();

    // The error must not poison the cache — next call retries.
    getFarmsForUserMock.mockResolvedValue([farm({ slug: "delta-livestock" })]);
    const retry = await verifyFreshFarmAccess("u1", "delta-livestock");
    expect(retry).not.toBeNull();
    expect(getFarmsForUserMock).toHaveBeenCalledTimes(2);
  });
});
