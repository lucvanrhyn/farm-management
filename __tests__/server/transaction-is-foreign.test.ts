/**
 * __tests__/server/transaction-is-foreign.test.ts
 *
 * TDD tests for wave/26e (refs #26 audit finding #22):
 *   `Transaction.isForeign` round-trips through the create + update API and
 *   defaults to `false` when not provided. The flag drives SARS source code
 *   0192/0193 (foreign farming income) on the ITR12 Farming Schedule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// vi.mock factories hoist above top-level const declarations, so any state the
// factories need must come from vi.hoisted so it survives the hoist.

const { createMock, updateMock, findUniqueMock, deleteMock, prismaMock } =
  vi.hoisted(() => {
    const create = vi.fn();
    const update = vi.fn();
    const findUnique = vi.fn();
    const del = vi.fn();
    const prisma = {
      transaction: {
        create,
        update,
        findUnique,
        delete: del,
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    return {
      createMock: create,
      updateMock: update,
      findUniqueMock: findUnique,
      deleteMock: del,
      prismaMock: prisma,
    };
  });

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: vi.fn().mockResolvedValue({
    prisma: prismaMock,
    role: "ADMIN",
    slug: "test-farm",
    session: { user: { id: "user-1", email: "test@farm.co.za" } },
  }),
}));

vi.mock("@/lib/auth", () => ({
  verifyFreshAdminRole: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/server/revalidate", () => ({
  revalidateTransactionWrite: vi.fn(),
}));

// Import AFTER mocks so the mocked modules are wired up.
import { POST } from "@/app/api/transactions/route";
import { PATCH } from "@/app/api/transactions/[id]/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchReq(id: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/transactions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Wave D (#159) — adapter-wrapped handlers take a Next.js 16 RouteContext
// as the second arg (`{ params: Promise<...> }`). The POST route has no
// dynamic segments, so an empty params promise is sufficient.
const POST_CTX = { params: Promise.resolve({}) };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/transactions — isForeign field (wave/26e)", () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
    findUniqueMock.mockReset();
    createMock.mockResolvedValue({ id: "tx-new" });
    updateMock.mockResolvedValue({ id: "tx-1" });
  });

  it("persists isForeign=true when provided in the request body", async () => {
    const res = await POST(
      postReq({
        type: "income",
        category: "Animal Sales",
        amount: 500,
        date: "2025-07-15",
        isForeign: true,
      }),
      POST_CTX,
    );
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data.isForeign).toBe(true);
  });

  it("defaults isForeign to false when omitted from the request", async () => {
    const res = await POST(
      postReq({
        type: "expense",
        category: "Feed/Supplements",
        amount: 200,
        date: "2025-06-01",
      }),
      POST_CTX,
    );
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].data.isForeign).toBe(false);
  });

  it("persists isForeign=false when explicitly set to false", async () => {
    const res = await POST(
      postReq({
        type: "expense",
        category: "Labour",
        amount: 100,
        date: "2025-06-01",
        isForeign: false,
      }),
      POST_CTX,
    );
    expect(res.status).toBe(201);
    expect(createMock.mock.calls[0][0].data.isForeign).toBe(false);
  });
});

describe("PATCH /api/transactions/[id] — isForeign field (wave/26e)", () => {
  beforeEach(() => {
    updateMock.mockReset();
    updateMock.mockResolvedValue({ id: "tx-1", isForeign: true });
  });

  it("updates isForeign=true when provided", async () => {
    const res = await PATCH(patchReq("tx-1", { isForeign: true }), {
      params: Promise.resolve({ id: "tx-1" }),
    });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0].data.isForeign).toBe(true);
  });

  it("updates isForeign=false when toggled off", async () => {
    const res = await PATCH(patchReq("tx-1", { isForeign: false }), {
      params: Promise.resolve({ id: "tx-1" }),
    });
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0].data.isForeign).toBe(false);
  });

  it("does not touch isForeign on PATCH when the field is omitted", async () => {
    const res = await PATCH(patchReq("tx-1", { description: "edit only" }), {
      params: Promise.resolve({ id: "tx-1" }),
    });
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0].data.isForeign).toBeUndefined();
  });
});
