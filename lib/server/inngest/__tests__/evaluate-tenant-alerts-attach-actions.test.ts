/**
 * lib/server/inngest/__tests__/evaluate-tenant-alerts-attach-actions.test.ts
 *
 * Proactive Nudges v1 — attachActions must run in the evaluate step BETWEEN
 * evaluateAllAlerts and persistNotifications, enriching action-eligible
 * candidates. It is wired as a RESILIENT step: a throw from the enrichment
 * (e.g. a creds-lookup failure) must NOT poison the cron — the un-enriched
 * candidates still flow through to persist.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { registered } = vi.hoisted(() => ({
  registered: new Map<string, (ctx: unknown) => unknown>(),
}));
vi.mock("@/lib/server/inngest/client", () => ({
  inngest: {
    createFunction: (opts: { id: string }, handler: (ctx: unknown) => unknown) => {
      registered.set(opts.id, handler);
      return { id: opts.id };
    },
  },
}));

const mockEvaluateAllAlerts = vi.fn();
const mockPersistNotifications = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/server/alerts", () => ({
  evaluateAllAlerts: (...a: unknown[]) => mockEvaluateAllAlerts(...a),
  persistNotifications: (...a: unknown[]) => mockPersistNotifications(...a),
}));

vi.mock("@/lib/server/alerts/dispatch", () => ({
  dispatchChannels: vi.fn().mockResolvedValue({ pushed: 0 }),
}));

const mockGetFarmCreds = vi.fn();
vi.mock("@/lib/meta-db", () => ({
  getAllFarmSlugs: vi.fn().mockResolvedValue([]),
  getFarmCreds: (...a: unknown[]) => mockGetFarmCreds(...a),
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

function makeStep() {
  return {
    run: (_name: string, fn: () => unknown) => Promise.resolve(fn()),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

function weighCandidate() {
  return {
    type: "NO_WEIGHING_90D",
    category: "performance",
    severity: "amber",
    dedupKey: "NO_WEIGHING_90D:a-1:2026-W25",
    collapseKey: "tenant",
    payload: { animalId: "COW-12", animalInternalId: "a-1" },
    message: "COW-12 not weighed in 95 days",
    href: "/trio/admin/animals",
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  };
}

beforeEach(() => {
  mockEvaluateAllAlerts.mockReset();
  mockPersistNotifications.mockClear();
  mockGetFarmCreds.mockReset();
});

describe("evaluateTenantAlerts — attachActions enrichment", () => {
  it("enriches candidates with payload.action before persist", async () => {
    mockEvaluateAllAlerts.mockResolvedValue([weighCandidate()]);
    mockGetFarmCreds.mockResolvedValue({ tier: "advanced" });

    const handler = registered.get("evaluate-tenant-alerts");
    await handler!({ event: { data: { slug: "trio" } }, step: makeStep() });

    expect(mockPersistNotifications).toHaveBeenCalledOnce();
    const passed = mockPersistNotifications.mock.calls[0][1] as Array<{
      payload: { action?: { taskType?: string } };
    }>;
    expect(passed[0].payload.action?.taskType).toBe("weighing");
  });

  it("does not poison the cron when creds lookup throws — persists un-enriched", async () => {
    mockEvaluateAllAlerts.mockResolvedValue([weighCandidate()]);
    mockGetFarmCreds.mockRejectedValue(new Error("meta down"));

    const handler = registered.get("evaluate-tenant-alerts");
    await expect(
      handler!({ event: { data: { slug: "trio" } }, step: makeStep() }),
    ).resolves.toBeDefined();

    expect(mockPersistNotifications).toHaveBeenCalledOnce();
    const passed = mockPersistNotifications.mock.calls[0][1] as Array<{ type: string }>;
    expect(passed).toHaveLength(1);
    expect(passed[0].type).toBe("NO_WEIGHING_90D");
  });
});
