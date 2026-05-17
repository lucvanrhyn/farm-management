/**
 * lib/server/inngest/__tests__/evaluate-tenant-alerts-revalidate.test.ts
 *
 * Phase 4 cache-invalidation contract, now enforced on the LIVE path.
 *
 * The cron-write cache-bust — "after the Inngest persist step writes ≥1
 * notification row for a tenant, invalidate the farm-scoped notifications
 * cache tag so NotificationBell surfaces fresh alerts before the feed TTL" —
 * historically lived only in the now-deleted dead module
 * `lib/server/notification-generator.ts`. The live tenant pipeline
 * (`evaluateTenantAlerts` in lib/server/inngest/functions.ts) never invoked
 * `revalidateNotificationWrite`, so production cron-written alerts lagged the
 * bell by the cache TTL.
 *
 * This test drives the live Inngest function's persist step with a scripted
 * `persistNotifications` result and asserts:
 *   1. ≥1 persisted row → `revalidateTag(farmTag(slug,"notifications"))` fires
 *      exactly once for the tenant cycle.
 *   2. `persistNotifications` returns `[]` (no alerts / all deduped) → the tag
 *      is NOT invalidated (no needless cron-tick cache bust).
 *
 * `next/cache` is mocked so we observe the contract through `revalidateTag`
 * calls, mirroring the mocking convention of the deleted dead-module test.
 * The Inngest client is mocked so `createFunction` captures the handler and we
 * invoke it directly with a fake `step` that runs each step inline.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Notification } from "@prisma/client";

// ── next/cache: capture revalidateTag calls.
const mockRevalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

// ── Inngest client: createFunction just records (opts, handler) so the test
// can invoke the handler directly with a fake step runner.
const { registered } = vi.hoisted(() => ({
  registered: new Map<string, (ctx: unknown) => unknown>(),
}));
vi.mock("@/lib/server/inngest/client", () => ({
  inngest: {
    createFunction: (
      opts: { id: string },
      handler: (ctx: unknown) => unknown,
    ) => {
      registered.set(opts.id, handler);
      return { id: opts.id };
    },
  },
}));

// ── Tenant + alert engine dependencies. We script persistNotifications per
// test; evaluate/dispatch are inert.
const mockEvaluateAllAlerts = vi.fn().mockResolvedValue([]);
const mockPersistNotifications = vi.fn();
vi.mock("@/lib/server/alerts", () => ({
  evaluateAllAlerts: (...args: unknown[]) => mockEvaluateAllAlerts(...args),
  persistNotifications: (...args: unknown[]) =>
    mockPersistNotifications(...args),
}));

const mockDispatchChannels = vi.fn().mockResolvedValue({ pushed: 0 });
vi.mock("@/lib/server/alerts/dispatch", () => ({
  dispatchChannels: (...args: unknown[]) => mockDispatchChannels(...args),
}));

vi.mock("@/lib/meta-db", () => ({
  getAllFarmSlugs: vi.fn().mockResolvedValue([]),
}));

const { fakePrisma } = vi.hoisted(() => ({
  fakePrisma: {
    farmSettings: { findFirst: vi.fn().mockResolvedValue({ id: "singleton" }) },
  },
}));
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: vi.fn().mockResolvedValue(fakePrisma),
}));

import "@/lib/server/inngest/functions";
import { farmTag } from "@/lib/server/cache-tags";

/** Minimal Notification row — only fields serializeNotifications reads. */
function makeRow(id: string): Notification {
  const now = new Date();
  return {
    id,
    type: "CALVING_OVERDUE",
    severity: "red",
    message: "Cow 123 calving overdue",
    href: "/admin/animals/123",
    dedupKey: `dk-${id}`,
    collapseKey: null,
    payload: null,
    isRead: false,
    pushDispatchedAt: null,
    digestDispatchedAt: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
  } as Notification;
}

/** Fake Inngest step: runs each step.run callback inline. */
function makeStep() {
  return {
    run: (_name: string, fn: () => unknown) => Promise.resolve(fn()),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  mockRevalidateTag.mockClear();
  mockPersistNotifications.mockReset();
  mockDispatchChannels.mockClear();
});

describe("evaluateTenantAlerts persist step — cron-write cache invalidation", () => {
  it("fires the farm-scoped notifications tag exactly once when ≥1 row is persisted", async () => {
    mockPersistNotifications.mockResolvedValue([makeRow("n1"), makeRow("n2")]);

    const handler = registered.get("evaluate-tenant-alerts");
    expect(handler).toBeTypeOf("function");

    await handler!({ event: { data: { slug: "trio-b" } }, step: makeStep() });

    const firedTags = mockRevalidateTag.mock.calls.map((c) => c[0]);
    const tag = farmTag("trio-b", "notifications");
    expect(firedTags).toContain(tag);
    expect(firedTags.filter((t) => t === tag)).toHaveLength(1);
  });

  it("does NOT fire the tag when persistNotifications returns no rows", async () => {
    mockPersistNotifications.mockResolvedValue([]);

    const handler = registered.get("evaluate-tenant-alerts");
    expect(handler).toBeTypeOf("function");

    await handler!({ event: { data: { slug: "trio-b" } }, step: makeStep() });

    const firedTags = mockRevalidateTag.mock.calls.map((c) => c[0]);
    expect(firedTags).not.toContain(farmTag("trio-b", "notifications"));
  });
});
