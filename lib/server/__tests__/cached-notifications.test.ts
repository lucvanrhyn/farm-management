/**
 * lib/server/__tests__/cached-notifications.test.ts
 *
 * Phase 4 — /api/notifications cache contract.
 *
 * `getCachedNotifications()` wraps the prisma fetch in `unstable_cache` so
 * that the NotificationBell poll does not hammer Turso every 60 seconds.
 *
 * Two behaviours are asserted:
 *   1. Two calls within the TTL window with the same (slug, email) serve
 *      the same data from a single underlying prisma.notification.findMany
 *      invocation. This is the "browser-less" server cache — the shield that
 *      matters even when the client has the wrong Cache-Control.
 *   2. The cache entry is tagged with BOTH the farm-scoped
 *      `farm-<slug>-notifications` tag AND the per-user
 *      `notificationTag(email)` tag so mutations on either axis invalidate.
 *
 * Cache keying is observed through the shape of the underlying mock, not
 * through internal properties of `unstable_cache` — the latter would couple
 * the test to Next.js internals.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── unstable_cache: stub that respects the key so cache hits short-circuit
// the underlying fetcher. This mimics the real behaviour closely enough to
// assert the contract without pulling in Next's cache runtime.
// The tags are captured per-call so the second assertion can verify them.
const cacheStore = new Map<string, unknown>();
const cacheTagsByKey = new Map<string, readonly string[]>();

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[],
    opts?: { tags?: readonly string[]; revalidate?: number },
  ) => {
    return async (...args: unknown[]) => {
      const key = [...keyParts, ...args.map((a) => JSON.stringify(a))].join("|");
      if (opts?.tags) cacheTagsByKey.set(key, opts.tags);
      if (cacheStore.has(key)) return cacheStore.get(key);
      const result = await fn(...args);
      cacheStore.set(key, result);
      return result;
    };
  },
  revalidateTag: vi.fn(),
}));

// ── withFarmPrisma mock: the only thing the cached wrapper should call when
// the key is a miss. Counting invocations is the load-bearing assertion.
const mockFindMany = vi.fn();
const mockPrisma = {
  notification: { findMany: mockFindMany },
};
vi.mock("@/lib/farm-prisma", () => ({
  withFarmPrisma: vi.fn(async (_slug: string, fn: (p: typeof mockPrisma) => Promise<unknown>) =>
    fn(mockPrisma),
  ),
}));

import { getCachedNotifications } from "@/lib/server/cached";
import { farmTag, notificationTag } from "@/lib/server/cache-tags";

beforeEach(() => {
  mockFindMany.mockReset();
  cacheStore.clear();
  cacheTagsByKey.clear();
  mockFindMany.mockResolvedValue([
    { id: "n1", type: "CALVING_ALERT", severity: "red", message: "x", href: "/a", isRead: false, createdAt: new Date("2026-04-23") },
  ]);
});

describe("getCachedNotifications()", () => {
  it("serves a second call within the TTL window from the cache (single prisma hit)", async () => {
    const a = await getCachedNotifications("trio-b", "alice@example.com");
    const b = await getCachedNotifications("trio-b", "alice@example.com");

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("keys cache entries by (slug, email) so two users do not share a feed", async () => {
    await getCachedNotifications("trio-b", "alice@example.com");
    await getCachedNotifications("trio-b", "bob@example.com");

    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });

  it("tags each entry with both the farm scope and the per-user tag", async () => {
    await getCachedNotifications("trio-b", "alice@example.com");

    const tags = Array.from(cacheTagsByKey.values()).flat();
    expect(tags).toContain(farmTag("trio-b", "notifications"));
    expect(tags).toContain(notificationTag("alice@example.com"));
  });

  it("returns the shape /api/notifications expects: { notifications, unreadCount }", async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: "n1", isRead: false },
      { id: "n2", isRead: true },
      { id: "n3", isRead: false },
    ]);

    const result = await getCachedNotifications("trio-b", "alice@example.com");

    expect(result).toHaveProperty("notifications");
    expect(result).toHaveProperty("unreadCount");
    expect(result.unreadCount).toBe(2);
    expect(result.notifications).toHaveLength(3);
  });
});
