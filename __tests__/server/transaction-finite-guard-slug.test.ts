/**
 * __tests__/server/transaction-finite-guard-slug.test.ts
 *
 * api-F4 (Wave A2) — POST /api/[farmSlug]/transactions must reject non-finite
 * numeric fields at the input boundary.
 *
 * Root cause: the inline handler null-checked only `amount`, then ran
 * `parseFloat`/`parseInt` straight into `prisma.transaction.create`. NaN /
 * Infinity / leading-numeric junk ("12abc") were therefore PERSISTED and
 * silently poisoned IT3 + finance aggregates.
 *
 * Contract under test:
 *   - Any of the 5 numeric fields (amount, quantity, avgMassKg, fees,
 *     transportCost) being non-finite → typed 400
 *     `{ error: "VALIDATION_FAILED", message }` and NOTHING is persisted.
 *   - Valid finite values still persist unchanged (no regression).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.mock factories hoist above top-level const declarations, so shared mock
// state must come from vi.hoisted to survive the hoist.
const { createMock, prismaMock, store } = vi.hoisted(() => {
  // A tiny in-memory store so the aggregate-poisoning regression test can
  // prove the inline GET summary reducer stays finite after a rejected row.
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

vi.mock("@/lib/server/farm-context-slug", () => ({
  getFarmContextForSlug: vi.fn().mockResolvedValue({
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
import { POST, GET } from "@/app/api/[farmSlug]/transactions/route";

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/test-farm/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(): NextRequest {
  return new NextRequest("http://localhost/api/test-farm/transactions", {
    method: "GET",
  });
}

const CTX = { params: Promise.resolve({ farmSlug: "test-farm" }) };

const BASE = {
  type: "income",
  category: "Animal Sales",
  amount: 1000,
  date: "2026-05-01",
} as const;

describe("POST /api/[farmSlug]/transactions — finite-guard (api-F4)", () => {
  beforeEach(() => {
    createMock.mockClear();
    store.length = 0;
  });

  // The 5 numeric fields and the bad inputs that previously leaked through
  // parseFloat/parseInt. "12abc" matters because parseFloat("12abc") === 12.
  //
  // NOTE: raw NaN / ±Infinity *numbers* are deliberately absent — JSON has no
  // literal for them, so `JSON.stringify({ amount: NaN })` emits `null`. Over
  // the HTTP wire (both routes parse via JSON.parse) a non-finite number can
  // only ever arrive as `null` (= omitted). The real poison vectors are the
  // string forms below, which survive serialization intact.
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
      // amount="" is already caught by the required-presence check; skip that
      // one combination so this test isolates the finite-guard behaviour.
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

  it("persists when optional numeric fields are omitted (null), guarding only present ones", async () => {
    const res = await POST(postReq({ ...BASE, amount: 800 }), CTX);
    expect(res.status).toBe(201);
    const data = createMock.mock.calls[0][0].data;
    expect(data.amount).toBe(800);
    expect(data.quantity).toBeNull();
    expect(data.avgMassKg).toBeNull();
    expect(data.fees).toBeNull();
    expect(data.transportCost).toBeNull();
  });

  it("accepts zero and negative finite values (valid debits/credits)", async () => {
    const res = await POST(
      postReq({ ...BASE, amount: 0, fees: -50, transportCost: 0 }),
      CTX,
    );
    expect(res.status).toBe(201);
    const data = createMock.mock.calls[0][0].data;
    expect(data.amount).toBe(0);
    expect(data.fees).toBe(-50);
    expect(data.transportCost).toBe(0);
  });
});

describe("[farmSlug] finance summary cannot be poisoned by one bad row (api-F4 regression)", () => {
  beforeEach(() => {
    createMock.mockClear();
    store.length = 0;
  });

  it("a rejected NaN-amount row never reaches the store, so the GET summary stays finite", async () => {
    // 1. A legitimate income row persists.
    const ok = await POST(postReq({ ...BASE, type: "income", amount: 1000 }), CTX);
    expect(ok.status).toBe(201);

    // 2. A poison row (NaN amount) is rejected at the boundary. Pre-fix this
    //    persisted amount=NaN; the inline GET reducer (`income += tx.amount`)
    //    would then return NaN for income AND net, silently poisoning the
    //    finance + IT3 dashboards.
    const poison = await POST(postReq({ ...BASE, type: "income", amount: "NaN" }), CTX);
    expect(poison.status).toBe(400);

    // 3. The GET summary reducer sums amounts. With the poison row blocked,
    //    every aggregate is finite.
    const res = await GET(getReq(), CTX);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Number.isFinite(json.summary.income)).toBe(true);
    expect(Number.isFinite(json.summary.expenses)).toBe(true);
    expect(Number.isFinite(json.summary.net)).toBe(true);
    expect(json.summary.income).toBe(1000);
    expect(json.summary.net).toBe(1000);
    expect(store.length).toBe(1);
  });
});
