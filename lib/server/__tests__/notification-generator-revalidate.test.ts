/**
 * lib/server/__tests__/notification-generator-revalidate.test.ts
 *
 * Phase 4 — cache invalidation contract for the notification generator.
 *
 * When the cron writes fresh notification rows for a farm, the cached feed
 * served to `/api/notifications` must be invalidated so the NotificationBell
 * surfaces the new alerts without waiting for the 30-second TTL to expire.
 *
 * This test exercises the generator with a minimal prisma double and asserts
 * that `revalidateTag("farm-<slug>-notifications")` fires whenever new rows
 * are written. When no rows are written (dedup hit, or zero alerts) the tag
 * must NOT fire — otherwise every cron tick would needlessly bust the cache.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRevalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

// The generator pulls dashboard alerts through this module — stub it so we
// can script the alert set per test without invoking the real analytics path.
const mockGetDashboardAlerts = vi.fn();
vi.mock("@/lib/server/dashboard-alerts", () => ({
  getDashboardAlerts: (...args: unknown[]) => mockGetDashboardAlerts(...args),
}));

// Push sender is best-effort; silence it during tests.
vi.mock("@/lib/server/push-sender", () => ({
  sendPushToFarm: vi.fn().mockResolvedValue(undefined),
}));

import { generateNotifications } from "@/lib/server/notification-generator";
import { farmTag } from "@/lib/server/cache-tags";

type MockPrisma = {
  farmSettings: { findUnique: ReturnType<typeof vi.fn> };
  notification: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(): MockPrisma {
  return {
    farmSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

beforeEach(() => {
  mockRevalidateTag.mockClear();
  mockGetDashboardAlerts.mockReset();
});

describe("generateNotifications() cache invalidation", () => {
  it("fires the farm-scoped notifications tag when new rows are written", async () => {
    mockGetDashboardAlerts.mockResolvedValue({
      red: [
        {
          id: "CALVING_OVERDUE",
          severity: "red",
          message: "Cow 123 calving overdue",
          href: "/admin/animals/123",
        },
      ],
      amber: [],
    });
    const prisma = makePrisma();
    // Use the real Prisma type loosely — the generator only exercises the
    // handful of methods our double provides.
    const created = await generateNotifications(prisma as unknown as never, "trio-b");

    expect(created).toBe(1);
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);

    const firedTags = mockRevalidateTag.mock.calls.map((c) => c[0]);
    expect(firedTags).toContain(farmTag("trio-b", "notifications"));
  });

  it("does NOT fire the tag when dedup suppresses every alert (no write)", async () => {
    mockGetDashboardAlerts.mockResolvedValue({
      red: [
        {
          id: "CALVING_OVERDUE",
          severity: "red",
          message: "Cow 123 calving overdue",
          href: "/admin/animals/123",
        },
      ],
      amber: [],
    });
    const prisma = makePrisma();
    // Simulate dedup: the same alert type was already emitted in the last 24h.
    prisma.notification.findMany.mockResolvedValueOnce([{ type: "CALVING_OVERDUE" }]);

    const created = await generateNotifications(prisma as unknown as never, "trio-b");

    expect(created).toBe(0);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();

    const firedTags = mockRevalidateTag.mock.calls.map((c) => c[0]);
    expect(firedTags).not.toContain(farmTag("trio-b", "notifications"));
  });

  it("does NOT fire the tag when there are no alerts at all", async () => {
    mockGetDashboardAlerts.mockResolvedValue({ red: [], amber: [] });
    const prisma = makePrisma();

    const created = await generateNotifications(prisma as unknown as never, "trio-b");

    expect(created).toBe(0);
    const firedTags = mockRevalidateTag.mock.calls.map((c) => c[0]);
    expect(firedTags).not.toContain(farmTag("trio-b", "notifications"));
  });
});
