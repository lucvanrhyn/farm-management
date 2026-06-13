/**
 * @vitest-environment node
 *
 * S32 + S33 + S34 — PayFast ITN webhook hardening (remediation wave G).
 *
 * Findings pinned by these tests:
 *
 *   S32a (H5/PF-02) — production must refuse to run with an unsalted signature:
 *     the handler calls assertPayfastConfig(), which throws when NODE_ENV is
 *     production and PAYFAST_PASSPHRASE is missing. A thrown error becomes a
 *     500 via publicHandler (loud, generic to client, full error logged).
 *
 *   S32b (PF-03) — the handler must reject (400) an ITN whose merchant_id does
 *     not match the configured PAYFAST_MERCHANT_ID (defence-in-depth; only
 *     enforced when the env var is set so sandbox stays unaffected).
 *
 *   S33a (M1) — the billing-period anchors (startedAt / nextRenewalAt) must be
 *     derived from the stable event time, NOT a fresh `new Date()`, and must be
 *     WRITE-ONCE per pf_payment_id: a retry (after a failed mutation) for the
 *     same payment must produce the IDENTICAL startedAt / nextRenewalAt so the
 *     customer's renewal date cannot drift on PayFast retries.
 *
 *   S33b (pay-M2 amount half) — the received amount_gross must be validated
 *     against the expected tier price (quoteTier). A forged/mismatched amount
 *     must NOT silently activate the subscription: the handler logs a HIGH
 *     warning and returns 200 (stops PayFast retries) WITHOUT activating.
 *
 *   S34 (pay-L1) —
 *     1. On a terminal FAILED/CANCELLED the handler must clear payfastToken
 *        (set NULL) so a leaked/rotated token can't later replay.
 *     2. A timestamp-LESS FAILED/CANCELLED must NOT downgrade an active
 *        subscription (parseEventTime falls back to "now" = max-rank, which
 *        would otherwise let a fabricated-newest stale FAILED win the ordering
 *        check and clobber a real COMPLETE).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  type EventRow = {
    pfPaymentId: string;
    paymentStatus: string;
    eventTime: Date;
    processedAt: Date;
    appliedAt: Date | null;
  };

  const mockState = {
    eventsByPaymentId: new Map<string, EventRow>(),
    nextUpdateThrows: false,
    /** Mutable view of the farm's stored subscription, read by getFarmSubscription
     *  and written by updateFarmSubscription so multi-event sequences are realistic. */
    sub: {
      subscriptionStatus: "inactive" as string,
      payfastToken: null as string | null,
      subscriptionStartedAt: null as string | null,
    },
    /** Captured updateFarmSubscription calls for assertions. */
    updateCalls: [] as Array<{
      slug: string;
      status: string;
      opts: Record<string, unknown>;
    }>,
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
    assertPayfastConfig: vi.fn(() => {}),
    getFarmSubscription: vi.fn(async (_slug: string) => ({ ...mockState.sub })),
    updateFarmSubscription: vi.fn(
      async (slug: string, status: string, opts: Record<string, unknown> = {}) => {
        if (mockState.nextUpdateThrows) {
          mockState.nextUpdateThrows = false;
          throw new Error("DB blip — simulated mutation failure");
        }
        mockState.updateCalls.push({ slug, status, opts });
        // Reflect the write back into the readable subscription view.
        mockState.sub.subscriptionStatus = status;
        if (opts.payfastToken !== undefined) {
          mockState.sub.payfastToken = (opts.payfastToken as string | null) ?? null;
        }
        if (opts.startedAt !== undefined) {
          mockState.sub.subscriptionStartedAt = opts.startedAt as string;
        }
      },
    ),
    computeFarmLsu: vi.fn(async () => 100),
    payfastEventCreate: vi.fn(
      async (args: {
        data: { pfPaymentId: string; paymentStatus: string; eventTime: Date };
      }) => {
        if (mockState.eventsByPaymentId.has(args.data.pfPaymentId)) {
          const err = new Error(
            "UNIQUE constraint failed: PayfastEvent.pfPaymentId",
          ) as Error & { code?: string };
          err.code = "P2002";
          throw err;
        }
        const row: EventRow = {
          pfPaymentId: args.data.pfPaymentId,
          paymentStatus: args.data.paymentStatus ?? "",
          eventTime: args.data.eventTime,
          processedAt: new Date(),
          appliedAt: null,
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
    payfastEventFindUnique: vi.fn(
      async (args: { where: { pfPaymentId: string } }) =>
        mockState.eventsByPaymentId.get(args.where.pfPaymentId) ?? null,
    ),
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

vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

vi.mock("@/lib/payfast", () => ({
  isValidPayFastIP: mocks.isValidPayFastIP,
  validateITN: mocks.validateITN,
  generateSignature: mocks.generateSignature,
  assertPayfastConfig: mocks.assertPayfastConfig,
}));

vi.mock("@/lib/meta-db", () => ({
  getFarmSubscription: mocks.getFarmSubscription,
  updateFarmSubscription: mocks.updateFarmSubscription,
}));

vi.mock("@/lib/pricing/farm-lsu", () => ({
  computeFarmLsu: mocks.computeFarmLsu,
}));

vi.mock("@/lib/farm-prisma", () => ({
  withFarmPrisma: vi.fn(
    async (_slug: string, fn: (db: unknown) => Promise<unknown>) =>
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

// ── Fixtures ───────────────────────────────────────────────────────────────

// 100 LSU, basic, monthly → quoteTier('basic', 100).monthlyZar.
// computeAnnual('basic', 100) = round(1800 + 0.75*100) = 1875.
// monthlyZar = round(1875 * 1.2 / 12) = round(187.5) = 188.
const EXPECTED_MONTHLY_BASIC_100 = 188;

function buildBody(overrides: Record<string, string> = {}): string {
  const params: Record<string, string> = {
    pf_payment_id: "PF-12345",
    payment_status: "COMPLETE",
    custom_str1: "basson",
    custom_str2: "basic",
    custom_str3: "monthly",
    amount_gross: String(EXPECTED_MONTHLY_BASIC_100) + ".00",
    merchant_id: "test-merchant",
    token: "current-token",
    timestamp: "2026-05-03T10:00:00Z",
    signature: "match",
    ...overrides,
  };
  // Allow callers to delete a field by passing it as "" + a sentinel; simpler:
  // strip any key whose value is the literal "__DELETE__".
  for (const k of Object.keys(params)) {
    if (params[k] === "__DELETE__") delete params[k];
  }
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

const CTX = { params: Promise.resolve({}) };

const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  mocks.state.eventsByPaymentId.clear();
  mocks.state.nextUpdateThrows = false;
  mocks.state.sub = {
    subscriptionStatus: "inactive",
    payfastToken: null,
    subscriptionStartedAt: null,
  };
  mocks.state.updateCalls = [];
  vi.clearAllMocks();

  mocks.isValidPayFastIP.mockImplementation(() => true);
  mocks.validateITN.mockImplementation(async () => true);
  mocks.generateSignature.mockImplementation(() => "match");
  mocks.assertPayfastConfig.mockImplementation(() => {});
  mocks.getFarmSubscription.mockImplementation(async () => ({ ...mocks.state.sub }));
  mocks.updateFarmSubscription.mockImplementation(
    async (slug: string, status: string, opts: Record<string, unknown> = {}) => {
      if (mocks.state.nextUpdateThrows) {
        mocks.state.nextUpdateThrows = false;
        throw new Error("DB blip — simulated mutation failure");
      }
      mocks.state.updateCalls.push({ slug, status, opts });
      mocks.state.sub.subscriptionStatus = status;
      if (opts.payfastToken !== undefined) {
        mocks.state.sub.payfastToken = (opts.payfastToken as string | null) ?? null;
      }
      if (opts.startedAt !== undefined) {
        mocks.state.sub.subscriptionStartedAt = opts.startedAt as string;
      }
    },
  );
  mocks.computeFarmLsu.mockImplementation(async () => 100);
  mocks.payfastEventCreate.mockImplementation(
    async (args: {
      data: { pfPaymentId: string; paymentStatus: string; eventTime: Date };
    }) => {
      if (mocks.state.eventsByPaymentId.has(args.data.pfPaymentId)) {
        const err = new Error(
          "UNIQUE constraint failed: PayfastEvent.pfPaymentId",
        ) as Error & { code?: string };
        err.code = "P2002";
        throw err;
      }
      const row = {
        pfPaymentId: args.data.pfPaymentId,
        paymentStatus: args.data.paymentStatus ?? "",
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
    async (args: { where: { pfPaymentId: string } }) =>
      mocks.state.eventsByPaymentId.get(args.where.pfPaymentId) ?? null,
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

  envBackup.PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
  process.env.PAYFAST_MERCHANT_ID = "test-merchant";
});

afterEach(() => {
  if (envBackup.PAYFAST_MERCHANT_ID === undefined) {
    delete process.env.PAYFAST_MERCHANT_ID;
  } else {
    process.env.PAYFAST_MERCHANT_ID = envBackup.PAYFAST_MERCHANT_ID;
  }
  vi.restoreAllMocks();
});

// ── S32a — config guard ──────────────────────────────────────────────────────
describe("S32a — passphrase config guard", () => {
  it("calls assertPayfastConfig() before processing", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    await POST(makeRequest(buildBody()), CTX);
    expect(mocks.assertPayfastConfig).toHaveBeenCalled();
  });

  it("returns 500 (does NOT activate) when assertPayfastConfig throws", async () => {
    mocks.assertPayfastConfig.mockImplementation(() => {
      throw new Error("PAYFAST_PASSPHRASE must be set in production");
    });
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(makeRequest(buildBody()), CTX);
    expect(res.status).toBe(500);
    expect(mocks.updateFarmSubscription).not.toHaveBeenCalled();
  });
});

// ── S32b — merchant_id verification ──────────────────────────────────────────
describe("S32b — merchant_id verification", () => {
  it("rejects (400) an ITN whose merchant_id does not match the configured one", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(buildBody({ merchant_id: "attacker-merchant" })),
      CTX,
    );
    expect(res.status).toBe(400);
    expect(mocks.updateFarmSubscription).not.toHaveBeenCalled();
    const warned = JSON.stringify(mocks.logger.warn.mock.calls);
    expect(warned).toMatch(/merchant/i);
  });

  it("processes an ITN whose merchant_id matches", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(buildBody({ merchant_id: "test-merchant" })),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
  });

  it("does NOT enforce merchant_id when PAYFAST_MERCHANT_ID is unset (sandbox)", async () => {
    delete process.env.PAYFAST_MERCHANT_ID;
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(buildBody({ merchant_id: "anything" })),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
  });
});

// ── S33a — idempotent write-once date anchors ────────────────────────────────
describe("S33a — idempotent billing-period anchors", () => {
  it("anchors startedAt to the event timestamp, not the wall clock", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    await POST(
      makeRequest(buildBody({ timestamp: "2026-05-03T10:00:00Z" })),
      CTX,
    );
    const call = mocks.state.updateCalls[0];
    expect(call.opts.startedAt).toBe("2026-05-03T10:00:00.000Z");
    // monthly → nextRenewalAt = startedAt + 1 month.
    expect(call.opts.nextRenewalAt).toBe("2026-06-03T10:00:00.000Z");
  });

  it("annual frequency anchors nextRenewalAt to event time + 1 year", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    await POST(
      makeRequest(
        buildBody({
          custom_str3: "annual",
          amount_gross: "1875.00", // quoteTier('advanced'/'basic') annual — not asserted here
          timestamp: "2026-05-03T10:00:00Z",
        }),
      ),
      CTX,
    );
    const call = mocks.state.updateCalls[0];
    expect(call.opts.startedAt).toBe("2026-05-03T10:00:00.000Z");
    expect(call.opts.nextRenewalAt).toBe("2027-05-03T10:00:00.000Z");
  });

  it("retry-after-failure for the same pf_payment_id keeps the IDENTICAL startedAt / nextRenewalAt", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");

    // First attempt: mutation throws → appliedAt stays null, no startedAt persisted.
    mocks.state.nextUpdateThrows = true;
    try {
      await POST(
        makeRequest(buildBody({ timestamp: "2026-05-03T10:00:00Z" })),
        CTX,
      );
    } catch {
      // publicHandler may surface a 500 or the error may propagate — both fine.
    }

    // Retry the SAME payment, but PayFast re-delivers with the SAME timestamp.
    const res = await POST(
      makeRequest(buildBody({ timestamp: "2026-05-03T10:00:00Z" })),
      CTX,
    );
    expect(res.status).toBe(200);

    const applied = mocks.state.updateCalls.filter((c) => c.status === "active");
    expect(applied.length).toBe(1);
    expect(applied[0].opts.startedAt).toBe("2026-05-03T10:00:00.000Z");
    expect(applied[0].opts.nextRenewalAt).toBe("2026-06-03T10:00:00.000Z");
  });

  it("a later COMPLETE retry does NOT move the anchors once the subscription already has a startedAt", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");

    // First COMPLETE applies and persists startedAt.
    await POST(
      makeRequest(buildBody({ timestamp: "2026-05-03T10:00:00Z" })),
      CTX,
    );
    const firstStarted = mocks.state.updateCalls[0].opts.startedAt;
    expect(firstStarted).toBe("2026-05-03T10:00:00.000Z");

    // PayFast re-delivers the SAME pf_payment_id with a DIFFERENT (later) timestamp.
    // The dedup ledger short-circuits this as already-applied, so no new activation
    // happens and the persisted anchor cannot drift.
    const res = await POST(
      makeRequest(buildBody({ timestamp: "2026-05-03T12:00:00Z" })),
      CTX,
    );
    expect(res.status).toBe(200);
    const activations = mocks.state.updateCalls.filter((c) => c.status === "active");
    expect(activations.length).toBe(1); // still only the original
    expect(mocks.state.sub.subscriptionStartedAt).toBe("2026-05-03T10:00:00.000Z");
  });
});

// ── S33b — amount validation against tier price ──────────────────────────────
describe("S33b — amount validation", () => {
  it("activates when amount_gross matches the expected tier price", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(
        buildBody({ amount_gross: String(EXPECTED_MONTHLY_BASIC_100) + ".00" }),
      ),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(mocks.updateFarmSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.state.updateCalls[0].status).toBe("active");
  });

  it("tolerates a one-rand rounding difference (does not block legitimate activation)", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(
        buildBody({ amount_gross: String(EXPECTED_MONTHLY_BASIC_100 + 1) + ".00" }),
      ),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(mocks.state.updateCalls[0]?.status).toBe("active");
  });

  it("does NOT activate when amount_gross is materially wrong (forged amount), logs HIGH warning, returns 200", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(buildBody({ amount_gross: "1.00" })),
      CTX,
    );
    // 200 so PayFast stops retrying, but NO activation.
    expect(res.status).toBe(200);
    const activations = mocks.state.updateCalls.filter((c) => c.status === "active");
    expect(activations.length).toBe(0);
    const warned = JSON.stringify(mocks.logger.warn.mock.calls);
    expect(warned).toMatch(/amount/i);
  });

  it("the amount-mismatch warning includes both the received and expected amounts", async () => {
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    await POST(makeRequest(buildBody({ amount_gross: "1.00" })), CTX);
    const warned = JSON.stringify(mocks.logger.warn.mock.calls);
    expect(warned).toContain(String(EXPECTED_MONTHLY_BASIC_100)); // expected
    expect(warned).toContain("1"); // received
  });
});

// ── S34 — token clear + timestamp-less downgrade guard ───────────────────────
describe("S34 — terminal failure token clear", () => {
  it("clears payfastToken (sets null) on a FAILED event", async () => {
    // Seed an active subscription with a stored token.
    mocks.state.sub = {
      subscriptionStatus: "active",
      payfastToken: "current-token",
      subscriptionStartedAt: "2026-05-01T00:00:00.000Z",
    };
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(
        buildBody({
          pf_payment_id: "PF-FAIL",
          payment_status: "FAILED",
          timestamp: "2026-05-03T11:00:00Z",
        }),
      ),
      CTX,
    );
    expect(res.status).toBe(200);
    const failCall = mocks.state.updateCalls.find((c) => c.status === "inactive");
    expect(failCall).toBeDefined();
    expect(failCall!.opts.payfastToken).toBeNull();
  });

  it("clears payfastToken on a CANCELLED event", async () => {
    mocks.state.sub = {
      subscriptionStatus: "active",
      payfastToken: "current-token",
      subscriptionStartedAt: "2026-05-01T00:00:00.000Z",
    };
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    await POST(
      makeRequest(
        buildBody({
          pf_payment_id: "PF-CANCEL",
          payment_status: "CANCELLED",
          timestamp: "2026-05-03T11:00:00Z",
        }),
      ),
      CTX,
    );
    const cancelCall = mocks.state.updateCalls.find((c) => c.status === "inactive");
    expect(cancelCall!.opts.payfastToken).toBeNull();
  });
});

describe("S34 — timestamp-less terminal event must not downgrade newer COMPLETE", () => {
  it("does NOT downgrade an active subscription when a FAILED arrives with NO timestamp", async () => {
    // Active subscription already established by a real COMPLETE.
    mocks.state.sub = {
      subscriptionStatus: "active",
      payfastToken: "current-token",
      subscriptionStartedAt: "2026-05-03T10:00:00.000Z",
    };
    const { POST } = await import("@/app/api/webhooks/payfast/route");

    // A timestamp-LESS FAILED (parseEventTime would fall back to "now" = newest).
    const res = await POST(
      makeRequest(
        buildBody({
          pf_payment_id: "PF-STALE-FAIL",
          payment_status: "FAILED",
          timestamp: "__DELETE__",
        }),
      ),
      CTX,
    );
    expect(res.status).toBe(200);
    // Must NOT have flipped the subscription to inactive.
    const downgrade = mocks.state.updateCalls.find((c) => c.status === "inactive");
    expect(downgrade).toBeUndefined();
    expect(mocks.state.sub.subscriptionStatus).toBe("active");
  });

  it("STILL processes a properly-timestamped FAILED (real cancellations work)", async () => {
    mocks.state.sub = {
      subscriptionStatus: "active",
      payfastToken: "current-token",
      subscriptionStartedAt: "2026-05-03T10:00:00.000Z",
    };
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(
        buildBody({
          pf_payment_id: "PF-REAL-FAIL",
          payment_status: "FAILED",
          timestamp: "2026-05-04T10:00:00Z",
        }),
      ),
      CTX,
    );
    expect(res.status).toBe(200);
    const downgrade = mocks.state.updateCalls.find((c) => c.status === "inactive");
    expect(downgrade).toBeDefined();
  });

  it("does NOT downgrade when the subscription is already inactive (timestamp-less FAILED, nothing to protect)", async () => {
    // inactive sub: a timestamp-less FAILED is harmless either way; assert no throw
    // and a clean 200. (Conservative guard only blocks downgrades of ACTIVE subs.)
    mocks.state.sub = {
      subscriptionStatus: "inactive",
      payfastToken: null,
      subscriptionStartedAt: null,
    };
    const { POST } = await import("@/app/api/webhooks/payfast/route");
    const res = await POST(
      makeRequest(
        buildBody({
          pf_payment_id: "PF-INACTIVE-FAIL",
          payment_status: "FAILED",
          timestamp: "__DELETE__",
        }),
      ),
      CTX,
    );
    expect(res.status).toBe(200);
  });
});
