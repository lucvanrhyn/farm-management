/**
 * @vitest-environment node
 *
 * Wave 4c A11 — PayFast ITN webhook idempotency.
 *
 * Codex adversarial review 2026-05-02 (HIGH severity finding #9) flagged four
 * bugs in `app/api/webhooks/payfast/route.ts`:
 *
 *   1. No event-id dedup — PayFast retries the same `pf_payment_id` and we
 *      were processing the payment N times, mutating subscription state on
 *      every retry.
 *   2. No timestamp ordering — a late-arriving FAILED event could clobber a
 *      newer COMPLETE state because we processed events in arrival order.
 *   3. No current-token check — events for a stale/rotated `payfast_token`
 *      still mutated subscription state, so a leaked old token could replay
 *      old subscriptions back into the live record.
 *   4. Logged the full `payfastToken` value on every ITN — sensitive
 *      credential leaked into log aggregation.
 *
 * These tests pin all four behaviours. They run against a heavily-mocked
 * version of the route (logger, lib/payfast, lib/meta-db, lib/farm-prisma,
 * lib/pricing/farm-lsu) so the assertions stay laser-focused on the
 * idempotency contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks (per feedback-vi-hoisted-shared-mocks.md) ──────────────
const mocks = vi.hoisted(() => {
  const mockState = {
    // Tracks rows in the per-tenant payfast_events table, keyed by pfPaymentId.
    eventsByPaymentId: new Map<
      string,
      { pfPaymentId: string; eventTime: Date; processedAt: Date }
    >(),
  };

  return {
    state: mockState,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    isValidPayFastIP: vi.fn((_ip: string) => true),
    validateITN: vi.fn(async (_params: Record<string, string>) => true),
    generateSignature: vi.fn(
      (_params: Record<string, string>, _passphrase?: string) => "match",
    ),
    getFarmSubscription: vi.fn(
      async (
        _slug: string,
      ): Promise<{
        subscriptionStatus: string;
        payfastToken: string | null;
        subscriptionStartedAt: string | null;
      }> => ({
        subscriptionStatus: "active",
        payfastToken: "current-token",
        subscriptionStartedAt: null,
      }),
    ),
    updateFarmSubscription: vi.fn(async () => {}),
    computeFarmLsu: vi.fn(async () => 100),
    payfastEventCreate: vi.fn(
      async (args: {
        data: { pfPaymentId: string; eventTime: Date };
      }) => {
        // Emulate UNIQUE constraint on pfPaymentId.
        if (mockState.eventsByPaymentId.has(args.data.pfPaymentId)) {
          const err = new Error("UNIQUE constraint failed: PayfastEvent.pfPaymentId") as Error & {
            code?: string;
          };
          err.code = "P2002";
          throw err;
        }
        const row = {
          pfPaymentId: args.data.pfPaymentId,
          eventTime: args.data.eventTime,
          processedAt: new Date(),
        };
        mockState.eventsByPaymentId.set(args.data.pfPaymentId, row);
        return row;
      },
    ),
    payfastEventFindFirst: vi.fn(
      async (_args: { orderBy: { eventTime: "desc" } }) => {
        const rows = Array.from(mockState.eventsByPaymentId.values());
        if (rows.length === 0) return null;
        rows.sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
        return rows[0];
      },
    ),
  };
});

vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

vi.mock("@/lib/payfast", () => ({
  isValidPayFastIP: mocks.isValidPayFastIP,
  validateITN: mocks.validateITN,
  generateSignature: mocks.generateSignature,
}));

vi.mock("@/lib/meta-db", () => ({
  getFarmSubscription: mocks.getFarmSubscription,
  updateFarmSubscription: mocks.updateFarmSubscription,
}));

vi.mock("@/lib/pricing/farm-lsu", () => ({
  computeFarmLsu: mocks.computeFarmLsu,
}));

vi.mock("@/lib/farm-prisma", () => ({
  withFarmPrisma: vi.fn(async (_slug: string, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      payfastEvent: {
        create: mocks.payfastEventCreate,
        findFirst: mocks.payfastEventFindFirst,
      },
    }),
  ),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────

function buildBody(overrides: Record<string, string> = {}): string {
  const params: Record<string, string> = {
    pf_payment_id: "PF-12345",
    payment_status: "COMPLETE",
    custom_str1: "basson",
    custom_str2: "basic",
    custom_str3: "monthly",
    amount_gross: "240.00",
    token: "current-token",
    timestamp: "2026-05-03T10:00:00Z",
    signature: "match",
    ...overrides,
  };
  return new URLSearchParams(params).toString();
}

function makeRequest(body: string): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/payfast", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "41.74.179.194",
    },
    body,
  });
}

describe("POST /api/webhooks/payfast — idempotency (Wave 4c A11)", () => {
  beforeEach(() => {
    mocks.state.eventsByPaymentId.clear();
    mocks.logger.debug.mockClear();
    mocks.logger.info.mockClear();
    mocks.logger.warn.mockClear();
    mocks.logger.error.mockClear();
    mocks.isValidPayFastIP.mockClear();
    mocks.isValidPayFastIP.mockImplementation(() => true);
    mocks.validateITN.mockClear();
    mocks.validateITN.mockImplementation(async () => true);
    mocks.generateSignature.mockClear();
    mocks.generateSignature.mockImplementation(() => "match");
    mocks.getFarmSubscription.mockClear();
    mocks.getFarmSubscription.mockImplementation(async () => ({
      subscriptionStatus: "active",
      payfastToken: "current-token",
      subscriptionStartedAt: null,
    }));
    mocks.updateFarmSubscription.mockClear();
    mocks.computeFarmLsu.mockClear();
    mocks.computeFarmLsu.mockImplementation(async () => 100);
    mocks.payfastEventCreate.mockClear();
    mocks.payfastEventFindFirst.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Bug 1: event-id dedup ──────────────────────────────────────────────
  describe("event-id dedup (pf_payment_id)", () => {
    it("processes the first POST for a given pf_payment_id", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");
      const res = await POST(makeRequest(buildBody()));
      expect(res.status).toBe(200);
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
    });

    it("does NOT mutate subscription state on a duplicate pf_payment_id", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      // First POST — processed.
      await POST(makeRequest(buildBody()));
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);

      // Second POST with identical pf_payment_id — must be a no-op.
      const res2 = await POST(makeRequest(buildBody()));
      expect(res2.status).toBe(200);
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
    });

    it("returns 200 (not 4xx) on a duplicate so PayFast stops retrying", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");
      await POST(makeRequest(buildBody()));
      const res = await POST(makeRequest(buildBody()));
      expect(res.status).toBe(200);
    });
  });

  // ── Bug 2: timestamp ordering ──────────────────────────────────────────
  describe("timestamp ordering", () => {
    it("rejects an event whose timestamp is older than the latest processed event for this farm", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      // Event A (newer): 2026-05-03 10:00
      await POST(
        makeRequest(
          buildBody({
            pf_payment_id: "PF-A",
            timestamp: "2026-05-03T10:00:00Z",
          }),
        ),
      );
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);

      // Event B (older, different pf_payment_id): 2026-05-03 09:00
      // It is NOT a dedup hit (different pf_payment_id) but should still
      // be skipped because it would overwrite newer state.
      const res = await POST(
        makeRequest(
          buildBody({
            pf_payment_id: "PF-B",
            payment_status: "FAILED",
            timestamp: "2026-05-03T09:00:00Z",
          }),
        ),
      );
      expect(res.status).toBe(200);
      // Subscription state must NOT have been mutated by the stale event.
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
    });

    it("processes an event whose timestamp is newer than the latest processed event", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      await POST(
        makeRequest(
          buildBody({
            pf_payment_id: "PF-A",
            timestamp: "2026-05-03T10:00:00Z",
          }),
        ),
      );
      await POST(
        makeRequest(
          buildBody({
            pf_payment_id: "PF-B",
            payment_status: "FAILED",
            timestamp: "2026-05-03T11:00:00Z",
          }),
        ),
      );
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(2);
    });
  });

  // ── Bug 3: current-token check ─────────────────────────────────────────
  describe("current-token check", () => {
    it("rejects (no-op 200) an event whose token does NOT match the farm's current payfast_token", async () => {
      mocks.getFarmSubscription.mockImplementation(async () => ({
        subscriptionStatus: "active",
        payfastToken: "current-token",
        subscriptionStartedAt: null,
      }));
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      const res = await POST(
        makeRequest(buildBody({ token: "stale-rotated-token" })),
      );
      expect(res.status).toBe(200);
      expect(mocks.updateFarmSubscription).not.toHaveBeenCalled();
    });

    it("processes an event whose token matches the farm's current payfast_token", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      const res = await POST(
        makeRequest(buildBody({ token: "current-token" })),
      );
      expect(res.status).toBe(200);
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
    });

    it("processes an event when the farm has NO current token yet (initial subscription activation)", async () => {
      // First-ever payment for this farm — meta-db payfast_token is null
      // until updateFarmSubscription persists the new token.
      mocks.getFarmSubscription.mockImplementation(async () => ({
        subscriptionStatus: "inactive",
        payfastToken: null,
        subscriptionStartedAt: null,
      }));
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      const res = await POST(
        makeRequest(buildBody({ token: "fresh-token" })),
      );
      expect(res.status).toBe(200);
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
    });
  });

  // ── Bug 4: token logging ───────────────────────────────────────────────
  describe("token logging hygiene", () => {
    it("never logs the full payfastToken value at any log level", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");
      await POST(makeRequest(buildBody({ token: "supersecrettoken123456" })));

      const allCalls = [
        ...mocks.logger.debug.mock.calls,
        ...mocks.logger.info.mock.calls,
        ...mocks.logger.warn.mock.calls,
        ...mocks.logger.error.mock.calls,
      ];
      const serialized = JSON.stringify(allCalls);
      expect(serialized).not.toContain("supersecrettoken123456");
    });

    it("emits a masked token form (prefix + ***) so support can correlate without leaking the secret", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");
      await POST(makeRequest(buildBody({ token: "supersecrettoken123456" })));

      const infoCalls = mocks.logger.info.mock.calls;
      const serialized = JSON.stringify(infoCalls);
      // Mask format: first 4 chars + "***"
      expect(serialized).toContain("supe***");
    });
  });
});
