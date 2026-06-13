/**
 * @vitest-environment node
 *
 * Write-path coverage for the Budget TABLE CRUD route
 * (POST / PATCH / DELETE /api/[farmSlug]/budgets).
 *
 * Closes a residual-closeout gap: the route previously had ONLY a static
 * source-scan (__tests__/auth/admin-write-routes-check-role.test.ts) that
 * readFileSync's the file and asserts an admin check exists — it never invoked
 * a handler, never asserted the upsert persisted, and never exercised any
 * 400/404/403 envelope. (The __tests__/einstein/budget.test.ts covers a
 * DIFFERENT module — the AI-spend counter — not this Budget table.) These
 * tests drive the real handlers, exactly the path a "live replay editing a
 * budget row" would exercise.
 *
 * The bare-string 403/400/404 envelopes are the deliberate ADR-0001/Wave G5
 * hybrid wire-shape (documented inline via audit-allow-error-envelope
 * pragmas); these tests pin that contract verbatim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const hoisted = vi.hoisted(() => ({
  getFarmContextForSlug: vi.fn(),
  verifyFreshAdminRole: vi.fn(),
  budget: {
    upsert: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/server/farm-context-slug", () => ({
  getFarmContextForSlug: hoisted.getFarmContextForSlug,
}));
vi.mock("@/lib/auth", () => ({
  verifyFreshAdminRole: hoisted.verifyFreshAdminRole,
}));
vi.mock("@/lib/server/revalidate", () => ({
  revalidateTransactionWrite: vi.fn(),
}));

import { POST, PATCH, DELETE } from "@/app/api/[farmSlug]/budgets/route";

const prisma = { budget: hoisted.budget };

function ctx(role = "ADMIN") {
  return {
    session: { user: { id: "u1", email: "u@x", role } },
    prisma,
    slug: "farm-a",
    role,
  };
}

function req(
  body: unknown,
  { method = "POST", search = "" }: { method?: string; search?: string } = {},
): NextRequest {
  return new NextRequest(`http://localhost/api/farm-a/budgets${search}`, {
    method,
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const params = Promise.resolve({ farmSlug: "farm-a" });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getFarmContextForSlug.mockResolvedValue(ctx("ADMIN"));
  hoisted.verifyFreshAdminRole.mockResolvedValue(true);
});

describe("POST /api/[farmSlug]/budgets — persistence + validation", () => {
  it("upserts a valid row → 201 with trimmed category + parsed amount", async () => {
    hoisted.budget.upsert.mockResolvedValue({
      id: "b1",
      year: 2026,
      month: 6,
      categoryName: "Feed",
      type: "expense",
      amount: 1500,
      notes: null,
    });

    const res = await POST(
      req({ year: 2026, month: 6, categoryName: " Feed ", type: "expense", amount: 1500 }),
      { params },
    );

    expect(res.status).toBe(201);
    expect(hoisted.budget.upsert).toHaveBeenCalledTimes(1);
    const arg = hoisted.budget.upsert.mock.calls[0][0];
    expect(arg.where.budget_year_month_category).toEqual({
      year: 2026,
      month: 6,
      categoryName: "Feed",
    });
    expect(arg.create).toMatchObject({ categoryName: "Feed", amount: 1500, type: "expense" });
  });

  it.each([
    ["year", { year: 1999, month: 6, categoryName: "Feed", type: "expense", amount: 1 }, "year must be an integer 2000-2100"],
    ["month", { year: 2026, month: 13, categoryName: "Feed", type: "expense", amount: 1 }, "month must be an integer 1-12"],
    ["categoryName", { year: 2026, month: 6, categoryName: "  ", type: "expense", amount: 1 }, "categoryName required"],
    ["type", { year: 2026, month: 6, categoryName: "Feed", type: "foo", amount: 1 }, "type must be 'income' or 'expense'"],
    ["amount", { year: 2026, month: 6, categoryName: "Feed", type: "expense", amount: -1 }, "amount must be a non-negative number"],
  ])("rejects bad %s → 400 (no write)", async (_label, body, msg) => {
    const res = await POST(req(body), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: msg });
    expect(hoisted.budget.upsert).not.toHaveBeenCalled();
  });

  it("non-object JSON body → 400 'Invalid JSON body' (route branch)", async () => {
    const res = await POST(req(123), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(hoisted.budget.upsert).not.toHaveBeenCalled();
  });

  it("non-admin role → 403, no write", async () => {
    hoisted.getFarmContextForSlug.mockResolvedValue(ctx("LOGGER"));
    const res = await POST(
      req({ year: 2026, month: 6, categoryName: "Feed", type: "expense", amount: 1 }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(hoisted.budget.upsert).not.toHaveBeenCalled();
  });

  it("stale admin (fresh re-check fails) → 403, no write", async () => {
    hoisted.verifyFreshAdminRole.mockResolvedValue(false);
    const res = await POST(
      req({ year: 2026, month: 6, categoryName: "Feed", type: "expense", amount: 1 }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(hoisted.budget.upsert).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/[farmSlug]/budgets — update + not-found", () => {
  it("missing id → 400", async () => {
    const res = await PATCH(req({ amount: 5 }, { method: "PATCH" }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "id required" });
  });

  it("updates an existing row → 200", async () => {
    hoisted.budget.update.mockResolvedValue({ id: "b1", amount: 99 });
    const res = await PATCH(
      req({ amount: 99 }, { method: "PATCH", search: "?id=b1" }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(hoisted.budget.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { amount: 99 },
    });
  });

  it("update throws (missing row) → 404", async () => {
    hoisted.budget.update.mockRejectedValue(new Error("no row"));
    const res = await PATCH(
      req({ amount: 99 }, { method: "PATCH", search: "?id=missing" }),
      { params },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Record not found" });
  });
});

describe("DELETE /api/[farmSlug]/budgets — guard + delete", () => {
  it("missing id → 400", async () => {
    const res = await DELETE(req(undefined, { method: "DELETE" }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "id required" });
  });

  it("not-found → 404, no delete", async () => {
    hoisted.budget.findUnique.mockResolvedValue(null);
    const res = await DELETE(
      req(undefined, { method: "DELETE", search: "?id=missing" }),
      { params },
    );
    expect(res.status).toBe(404);
    expect(hoisted.budget.delete).not.toHaveBeenCalled();
  });

  it("existing row → {ok:true} and delete called", async () => {
    hoisted.budget.findUnique.mockResolvedValue({ id: "b1" });
    hoisted.budget.delete.mockResolvedValue({});
    const res = await DELETE(
      req(undefined, { method: "DELETE", search: "?id=b1" }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(hoisted.budget.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
  });
});
