/**
 * __tests__/server/transaction-finite-guard.test.ts
 *
 * api-F4 (Wave A2) — POST /api/transactions must reject non-finite numeric
 * fields at the input boundary (the route's `createTransactionSchema.parse`).
 *
 * The adapter-based route only checked `amount` *presence*; numeric coercion
 * happened downstream in `lib/domain/transactions/create-transaction.ts`
 * (parseFloat/parseInt), so NaN / Infinity / "12abc" were persisted and
 * poisoned the finance/IT3 summary aggregate.
 *
 * Contract under test:
 *   - Any non-finite numeric field → typed 400
 *     `{ error: "VALIDATION_FAILED", message }`, persisting nothing.
 *   - Valid finite values still persist (no regression).
 *   - REGRESSION: a single bad row can no longer poison a finance/IT3
 *     aggregate. This route's GET returns the raw `Transaction[]`; the admin
 *     /finansies + IT3 export sum those amounts. With the guard, the bad row
 *     never reaches the store, so any sum over the returned rows stays finite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { createMock, prismaMock, store } = vi.hoisted(() => {
  // A tiny in-memory store so the regression test can prove a sum over the
  // returned rows stays finite after a rejected poison row.
  type TxData = Record<string, unknown> & { type: string; amount: number };
  const rows: Array<TxData & { id: string }> = [];
  const create = vi.fn(({ data }: { data: TxData }) => {
    const row = { id: `tx-${rows.length + 1}`, ...data };
    rows.push(row);
    return Promise.resolve(row);
  });
  const findMany = vi.fn(() => Promise.resolve([...rows]));
  const prisma = { transaction: { create, findMany } };
  return { createMock: create, prismaMock: prisma, store: rows };
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
import { POST, GET } from "@/app/api/transactions/route";

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/transactions", { method: "GET" });
}

// The route has no dynamic segments — an empty params promise is sufficient.
const CTX = { params: Promise.resolve({}) };

const BASE = {
  type: "income",
  category: "Animal Sales",
  amount: 1000,
  date: "2026-05-01",
} as const;

describe("POST /api/transactions — finite-guard (api-F4)", () => {
  beforeEach(() => {
    createMock.mockClear();
    store.length = 0;
  });

  // See the slug test for why raw NaN / ±Infinity *numbers* are omitted: JSON
  // serializes them to `null`, so the only wire-realistic non-finite inputs are
  // the string forms below (which `parseFloat`/`Number` used to mis-coerce).
  const numericFields = [
    "amount",
    "quantity",
    "avgMassKg",
    "fees",
    "transportCost",
  ] as const;
  const badValues: Array<[string, unknown]> = [
    ['string "NaN"', "NaN"],
    ['string "Infinity"', "Infinity"],
    ['string "-Infinity"', "-Infinity"],
    ["empty string", ""],
    ["whitespace string", "   "],
    ["non-numeric string", "abc"],
    ['leading-numeric junk "12abc"', "12abc"],
  ];

  for (const field of numericFields) {
    for (const [label, bad] of badValues) {
      // amount="" is the required-presence path, not the finite-guard path.
      if (field === "amount" && bad === "") continue;
      it(`rejects ${field}=${label} with typed 400 and persists nothing`, async () => {
        const res = await POST(postReq({ ...BASE, [field]: bad }), CTX);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("VALIDATION_FAILED");
        expect(typeof json.message).toBe("string");
        expect(createMock).not.toHaveBeenCalled();
        expect(store.length).toBe(0);
      });
    }
  }

  it("persists valid finite values unchanged", async () => {
    const res = await POST(
      postReq({
        ...BASE,
        amount: "1500.50",
        quantity: "12",
        avgMassKg: "245.5",
        fees: "120",
        transportCost: "300",
      }),
      CTX,
    );
    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);
    const data = createMock.mock.calls[0][0].data;
    expect(data.amount).toBe(1500.5);
    expect(data.quantity).toBe(12);
    expect(data.avgMassKg).toBe(245.5);
    expect(data.fees).toBe(120);
    expect(data.transportCost).toBe(300);
  });

  it("accepts zero and negative finite values", async () => {
    const res = await POST(
      postReq({ ...BASE, amount: 0, fees: -50 }),
      CTX,
    );
    expect(res.status).toBe(201);
    const data = createMock.mock.calls[0][0].data;
    expect(data.amount).toBe(0);
    expect(data.fees).toBe(-50);
  });
});

describe("Finance summary aggregate cannot be poisoned by one bad row (api-F4 regression)", () => {
  beforeEach(() => {
    createMock.mockClear();
    store.length = 0;
  });

  it("a rejected NaN-amount row never reaches the store, so any sum over the returned rows stays finite", async () => {
    // 1. A legitimate income row persists.
    const ok = await POST(postReq({ ...BASE, amount: 1000 }), CTX);
    expect(ok.status).toBe(201);

    // 2. A poison row (NaN amount) is rejected at the boundary — pre-fix it
    //    would have persisted amount=NaN, so the finance/IT3 total over the
    //    GET payload would compute as NaN forever.
    const poison = await POST(postReq({ ...BASE, amount: "NaN" }), CTX);
    expect(poison.status).toBe(400);

    // 3. GET returns the raw Transaction[]; summing the amounts (as the
    //    /finansies + IT3 export do) is finite because the poison row was
    //    never stored.
    const res = await GET(getReq(), CTX);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ amount: number }>;
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBe(1000);
    expect(store.length).toBe(1);
  });
});
