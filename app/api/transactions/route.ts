/**
 * GET  /api/transactions — list transactions (filterable by type/category/date range).
 * POST /api/transactions — create a transaction (ADMIN only — fresh-admin re-verify).
 *
 * Wave D (#159) — adapter-only wiring. The hand-rolled handler shape is
 * gone; auth, body parse, typed-error envelope, and revalidate are owned
 * by the `tenantRead` / `adminWrite` adapters from `lib/server/route/`.
 * The business logic lives in `lib/domain/transactions/*`.
 *
 * Wire shapes (preserved verbatim for back-compat with admin /finansies
 * UI + offline-sync queue):
 *   - GET  200 → `Transaction[]` (raw Prisma rows)
 *   - GET  400 → `{ error: "INVALID_DATE_FORMAT", details: { field } }`
 *   - POST 201 → `Transaction` (raw row)
 *   - POST 400 → `{ error: "VALIDATION_FAILED", details: { fieldErrors } }`
 *   - POST 422 → `{ error: "INVALID_SALE_TYPE" }`
 *   - 401 / 403 — adapter-emitted (incl. stale-ADMIN re-verify on POST).
 */
import { NextResponse } from "next/server";

import { adminWrite, RouteValidationError, tenantRead } from "@/lib/server/route";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";
import {
  createTransaction,
  listTransactions,
  type CreateTransactionInput,
} from "@/lib/domain/transactions";

interface CreateTransactionBody {
  type: string;
  category: string;
  amount: number | string;
  date: string;
  description?: string | null;
  animalId?: string | null;
  campId?: string | null;
  reference?: string | null;
  saleType?: string | null;
  counterparty?: string | null;
  quantity?: number | string | null;
  avgMassKg?: number | string | null;
  fees?: number | string | null;
  transportCost?: number | string | null;
  animalIds?: string | null;
  isForeign?: boolean | null;
}

// api-F4 — the 5 numeric fields. `amount` is required; the rest are optional
// (guarded only when present and non-null). Downstream `createTransaction`
// coerces these via parseFloat/parseInt, which silently accept NaN / Infinity
// / leading-numeric junk ("12abc") — so a non-finite value used to persist and
// poison every IT3 + finance aggregate. We reject at the input boundary here.
const NUMERIC_FIELDS: readonly string[] = [
  "amount",
  "quantity",
  "avgMassKg",
  "fees",
  "transportCost",
];

/**
 * True when `v` is present (non-null/undefined) yet NOT a finite number.
 * `Number(...)` does whole-string coercion (unlike parseFloat), and an empty
 * or whitespace-only string is treated as non-finite (Number("") === 0 would
 * otherwise silently become a zero).
 */
function isNonFinite(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return true;
  return !Number.isFinite(typeof v === "number" ? v : Number(v));
}

const createTransactionSchema = {
  parse(input: unknown): CreateTransactionBody {
    const body = (input ?? {}) as Record<string, unknown>;
    const fieldErrors: Record<string, string> = {};
    if (typeof body.type !== "string" || !body.type) {
      fieldErrors.type = "type is required";
    }
    if (typeof body.category !== "string" || !body.category) {
      fieldErrors.category = "category is required";
    }
    if (body.amount === null || body.amount === undefined || body.amount === "") {
      fieldErrors.amount = "amount is required";
    }
    if (typeof body.date !== "string" || !body.date) {
      fieldErrors.date = "date is required";
    }
    // api-F4 finite-guard — runs after presence so "amount required" wins for
    // the empty/missing case; the rest catch NaN/Infinity/junk on every field.
    for (const field of NUMERIC_FIELDS) {
      if (fieldErrors[field]) continue;
      if (isNonFinite(body[field])) {
        fieldErrors[field] = `${field} must be a finite number`;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new RouteValidationError(
        "type, category, amount, date required",
        { fieldErrors },
      );
    }
    return body as unknown as CreateTransactionBody;
  },
};

export const GET = tenantRead({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const result = await listTransactions(ctx.prisma, {
      type: searchParams.get("type"),
      category: searchParams.get("category"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    });
    return NextResponse.json(result);
  },
});

export const POST = adminWrite<CreateTransactionBody>({
  schema: createTransactionSchema,
  revalidate: revalidateTransactionWrite,
  handle: async (ctx, body) => {
    const input: CreateTransactionInput = {
      type: body.type,
      category: body.category,
      amount: body.amount,
      date: body.date,
      description: body.description ?? null,
      animalId: body.animalId ?? null,
      campId: body.campId ?? null,
      reference: body.reference ?? null,
      saleType: body.saleType ?? null,
      counterparty: body.counterparty ?? null,
      quantity: body.quantity ?? null,
      avgMassKg: body.avgMassKg ?? null,
      fees: body.fees ?? null,
      transportCost: body.transportCost ?? null,
      animalIds: body.animalIds ?? null,
      isForeign: body.isForeign ?? null,
      createdBy: ctx.session.user?.email ?? null,
    };
    const result = await createTransaction(ctx.prisma, input);
    return NextResponse.json(result, { status: 201 });
  },
});
