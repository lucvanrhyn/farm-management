/**
 * @vitest-environment node
 *
 * Issue #95 — PayFast idempotency can swallow successful payment (regression tests).
 *
 * Root cause (two facets):
 *
 *   A. Insert-before-mutate: the dedup ledger row was inserted BEFORE
 *      updateFarmSubscription ran. If the mutation threw, the row was already
 *      committed — PayFast retries got 200'd as "already processed" and the
 *      tenant never went active. Silent revenue loss.
 *
 *   B. PENDING blocks COMPLETE: PayFast sends PENDING then COMPLETE with the
 *      same pf_payment_id. The PENDING insert claimed the unique index; the
 *      later COMPLETE was deduped as already-processed without ever running the
 *      subscription activation. Subscription stayed inactive.
 *
 * Fix contract (these tests pin it):
 *   1. A COMPLETE retry succeeds if a prior attempt's subscription mutation
 *      failed (i.e. appliedAt is still NULL on the existing ledger row).
 *   2. A PENDING event does NOT block a later COMPLETE for the same pf_payment_id.
 *   3. A COMPLETE arriving after an already-applied COMPLETE is a safe no-op.
 *   4. A PENDING arriving after an already-applied COMPLETE does NOT downgrade
 *      the subscription.
 *   5. Telemetry: a warn-level log is emitted when we detect a retry after a
 *      failed mutation (the "retry pending" branch).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Shared mock state ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  type EventRow = {
    id: string;
    pfPaymentId: string;
    paymentStatus: string;
    eventTime: Date;
    processedAt: Date;
    /** NULL until the subscription mutation completes successfully. */
    appliedAt: Date | null;
  };

  const mockState = {
    /** Ledger rows keyed by pfPaymentId. */
    eventsByPaymentId: new Map<string, EventRow>(),
    /** Controls whether updateFarmSubscription should throw on the next call. */
    nextUpdateThrows: false,
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
    updateFarmSubscription: vi.fn(async () => {
      if (mockState.nextUpdateThrows) {
        mockState.nextUpdateThrows = false;
        throw new Error("DB blip — simulated mutation failure");
      }
    }),
    computeFarmLsu: vi.fn(async () => 100),

    /** Simulates db.payfastEvent.create — throws P2002 on duplicate pfPaymentId. */
    payfastEventCreate: vi.fn(
      async (args: {
        data: {
          pfPaymentId: string;
          paymentStatus: string;
          eventTime: Date;
          payloadHash: string;
        };
      }) => {
        if (mockState.eventsByPaymentId.has(args.data.pfPaymentId)) {
          const err = new Error(
            "UNIQUE constraint failed: PayfastEvent.pfPaymentId",
          ) as Error & { code?: string };
          err.code = "P2002";
          throw err;
        }
        const row: EventRow = {
          id: `id-${args.data.pfPaymentId}`,
          pfPaymentId: args.data.pfPaymentId,
          paymentStatus: args.data.paymentStatus,
          eventTime: args.data.eventTime,
          processedAt: new Date(),
          appliedAt: null, // starts as NULL — not yet applied
        };
        mockState.eventsByPaymentId.set(args.data.pfPaymentId, row);
        return row;
      },
    ),

    /** Simulates db.payfastEvent.findFirst — returns most recent by eventTime. */
    payfastEventFindFirst: vi.fn(
      async (_args: { orderBy: { eventTime: "desc" } }) => {
        const rows = Array.from(mockState.eventsByPaymentId.values());
        if (rows.length === 0) return null;
        rows.sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
        return rows[0];
      },
    ),

    /**
     * Simulates db.payfastEvent.findUnique — looks up row by pfPaymentId.
     * Used by the fix to inspect an existing row on P2002.
     */
    payfastEventFindUnique: vi.fn(
      async (args: { where: { pfPaymentId: string } }) => {
        return mockState.eventsByPaymentId.get(args.where.pfPaymentId) ?? null;
      },
    ),

    /**
     * Simulates db.payfastEvent.update — used by the fix to:
     *   (a) set appliedAt after successful mutation, or
     *   (b) upgrade a PENDING row to COMPLETE status.
     */
    payfastEventUpdate: vi.fn(
      async (args: {
        where: { pfPaymentId: string };
        data: Partial<EventRow>;
      }) => {
        const row = mockState.eventsByPaymentId.get(args.where.pfPaymentId);
        if (!row) throw new Error(`Row not found: ${args.where.pfPaymentId}`);
        Object.assign(row, args.data);
        return row;
      },
    ),
  };
});

// ── Module mocks ─────────────────────────────────────────────────────────────

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
        findUnique: mocks.payfastEventFindUnique,
        update: mocks.payfastEventUpdate,
      },
    }),
  ),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/payfast — Issue #95 regression", () => {
  beforeEach(() => {
    mocks.state.eventsByPaymentId.clear();
    mocks.state.nextUpdateThrows = false;
    vi.clearAllMocks();
    // Restore default implementations after clearAllMocks wipes them.
    mocks.isValidPayFastIP.mockImplementation(() => true);
    mocks.validateITN.mockImplementation(async () => true);
    mocks.generateSignature.mockImplementation(() => "match");
    mocks.getFarmSubscription.mockImplementation(async () => ({
      subscriptionStatus: "active",
      payfastToken: "current-token",
      subscriptionStartedAt: null,
    }));
    mocks.updateFarmSubscription.mockImplementation(async () => {
      if (mocks.state.nextUpdateThrows) {
        mocks.state.nextUpdateThrows = false;
        throw new Error("DB blip — simulated mutation failure");
      }
    });
    mocks.computeFarmLsu.mockImplementation(async () => 100);
    mocks.payfastEventCreate.mockImplementation(
      async (args: {
        data: {
          pfPaymentId: string;
          paymentStatus: string;
          eventTime: Date;
          payloadHash: string;
        };
      }) => {
        if (mocks.state.eventsByPaymentId.has(args.data.pfPaymentId)) {
          const err = new Error(
            "UNIQUE constraint failed: PayfastEvent.pfPaymentId",
          ) as Error & { code?: string };
          err.code = "P2002";
          throw err;
        }
        const row = {
          id: `id-${args.data.pfPaymentId}`,
          pfPaymentId: args.data.pfPaymentId,
          paymentStatus: args.data.paymentStatus,
          eventTime: args.data.eventTime,
          processedAt: new Date(),
          appliedAt: null as Date | null,
        };
        mocks.state.eventsByPaymentId.set(args.data.pfPaymentId, row);
        return row;
      },
    );
    mocks.payfastEventFindFirst.mockImplementation(
      async (_args: { orderBy: { eventTime: "desc" } }) => {
        const rows = Array.from(mocks.state.eventsByPaymentId.values());
        if (rows.length === 0) return null;
        rows.sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
        return rows[0];
      },
    );
    mocks.payfastEventFindUnique.mockImplementation(
      async (args: { where: { pfPaymentId: string } }) => {
        return mocks.state.eventsByPaymentId.get(args.where.pfPaymentId) ?? null;
      },
    );
    mocks.payfastEventUpdate.mockImplementation(
      async (args: {
        where: { pfPaymentId: string };
        data: Record<string, unknown>;
      }) => {
        const row = mocks.state.eventsByPaymentId.get(args.where.pfPaymentId);
        if (!row) throw new Error(`Row not found: ${args.where.pfPaymentId}`);
        Object.assign(row, args.data);
        return row;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Facet A: insert-before-mutate ──────────────────────────────────────────

  describe("Facet A — retry after failed mutation should re-process (not 200 as duplicate)", () => {
    it("[A1] first COMPLETE processes the subscription", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");
      const res = await POST(makeRequest(buildBody()));
      expect(res.status).toBe(200);
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
    });

    it("[A2] when the first attempt's subscription mutation fails, a retry MUST re-apply it", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      // First call: mutation throws. The route may either return a non-200 response
      // or propagate the error — both indicate "not silently swallowed".
      mocks.state.nextUpdateThrows = true;
      let firstRes: Response | undefined;
      try {
        firstRes = await POST(makeRequest(buildBody()));
        // If it returned a response, it must NOT be 200 (that would falsely signal success).
        expect(firstRes.status).not.toBe(200);
      } catch {
        // Route propagated the error — that's also acceptable (not silently swallowed).
        // updateFarmSubscription was called once (and threw).
        expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
      }

      // Retry: same pf_payment_id. The mutation should run again.
      const res2 = await POST(makeRequest(buildBody()));
      expect(res2.status).toBe(200);
      // updateFarmSubscription must have been called on the retry.
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(2);
    });

    it("[A3] appliedAt is set on the ledger row only after a successful mutation", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      // First call: mutation throws — appliedAt must remain null.
      mocks.state.nextUpdateThrows = true;
      try {
        await POST(makeRequest(buildBody()));
      } catch {
        // Route propagated — expected.
      }

      const rowAfterFailure = mocks.state.eventsByPaymentId.get("PF-12345");
      // Row may or may not exist depending on implementation detail, but if it
      // does exist its appliedAt must be null (not yet applied).
      if (rowAfterFailure) {
        expect(rowAfterFailure.appliedAt).toBeNull();
      }

      // Retry succeeds — appliedAt must now be set.
      const res2 = await POST(makeRequest(buildBody()));
      expect(res2.status).toBe(200);

      const rowAfterSuccess = mocks.state.eventsByPaymentId.get("PF-12345");
      expect(rowAfterSuccess).toBeDefined();
      expect(rowAfterSuccess!.appliedAt).not.toBeNull();
    });

    it("[A4] a second COMPLETE for the same pf_payment_id is a no-op once appliedAt is set", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      // First call succeeds fully.
      await POST(makeRequest(buildBody()));
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);

      // Second call (normal PayFast retry) — must be a no-op.
      const res2 = await POST(makeRequest(buildBody()));
      expect(res2.status).toBe(200);
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1); // still 1
    });

    it("[A5] emits a warn-level log on the retry-after-failure branch", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      // Fail first attempt.
      mocks.state.nextUpdateThrows = true;
      try {
        await POST(makeRequest(buildBody()));
      } catch {
        // expected
      }

      // Reset call counts but keep implementations (don't use vi.clearAllMocks
      // since that would also clear mock implementations set in beforeEach).
      mocks.logger.warn.mockClear();
      mocks.logger.info.mockClear();
      mocks.logger.error.mockClear();
      mocks.updateFarmSubscription.mockClear();
      mocks.updateFarmSubscription.mockImplementation(async () => {});

      // Retry.
      await POST(makeRequest(buildBody()));

      // Should have warned about the retry (incomplete-apply / retry-after-failure branch).
      const warnCalls = mocks.logger.warn.mock.calls;
      const warnMessages = JSON.stringify(warnCalls);
      expect(warnMessages).toMatch(/retry|re-apply|incomplete|appliedAt/i);
    });
  });

  // ── Facet B: PENDING blocks COMPLETE ──────────────────────────────────────

  describe("Facet B — PENDING event must NOT block a later COMPLETE for same pf_payment_id", () => {
    it("[B1] PENDING event is recorded but does NOT activate the subscription", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      const res = await POST(
        makeRequest(buildBody({ payment_status: "PENDING" })),
      );
      expect(res.status).toBe(200);
      // PENDING should not call updateFarmSubscription at all (it's a no-op status).
      expect(mocks.updateFarmSubscription).not.toHaveBeenCalled();
    });

    it("[B2] COMPLETE arriving after PENDING for same pf_payment_id DOES activate subscription", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      // PENDING first.
      await POST(makeRequest(buildBody({ payment_status: "PENDING" })));
      expect(mocks.updateFarmSubscription).not.toHaveBeenCalled();

      // COMPLETE arrives — must trigger activation despite same pf_payment_id.
      const res = await POST(
        makeRequest(buildBody({ payment_status: "COMPLETE" })),
      );
      expect(res.status).toBe(200);
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
      expect(mocks.updateFarmSubscription).toHaveBeenCalledWith(
        "basson",
        "active",
        expect.any(Object),
      );
    });

    it("[B3] PENDING arriving AFTER a fully-applied COMPLETE does NOT downgrade to inactive/pending", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      // COMPLETE first — fully applied.
      await POST(makeRequest(buildBody({ payment_status: "COMPLETE" })));
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);

      // Stale PENDING arrives (late PayFast retry). Must be a no-op.
      const res = await POST(
        makeRequest(
          buildBody({
            payment_status: "PENDING",
            timestamp: "2026-05-03T09:00:00Z", // older timestamp
          }),
        ),
      );
      expect(res.status).toBe(200);
      // updateFarmSubscription must NOT have been called again.
      expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
    });

    it("[B4] subscription ends up COMPLETE after PENDING→COMPLETE sequence", async () => {
      const { POST } = await import("@/app/api/webhooks/payfast/route");

      await POST(makeRequest(buildBody({ payment_status: "PENDING" })));
      await POST(makeRequest(buildBody({ payment_status: "COMPLETE" })));

      // The activation call must have fired with "active".
      expect(mocks.updateFarmSubscription).toHaveBeenCalledWith(
        "basson",
        "active",
        expect.any(Object),
      );
    });
  });
});
