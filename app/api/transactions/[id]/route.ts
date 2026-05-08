/**
 * PATCH  /api/transactions/[id] — partial-update a transaction (ADMIN only).
 * DELETE /api/transactions/[id] — delete a transaction (ADMIN only).
 *
 * Wave D (#159) — adapter-only wiring. Both endpoints are ADMIN-gated
 * with stale-ADMIN re-verify owned by the adapter. Business logic lives
 * in `lib/domain/transactions/{update,delete}-transaction.ts`.
 *
 * Wire shapes (preserved verbatim):
 *   - PATCH  200 → updated `Transaction` row
 *   - PATCH  404 → `{ error: "TRANSACTION_NOT_FOUND" }`
 *   - PATCH  422 → `{ error: "INVALID_SALE_TYPE" }`
 *   - DELETE 200 → `{ ok: true }`
 *   - DELETE 404 → `{ error: "TRANSACTION_NOT_FOUND" }`
 */
import { NextResponse } from "next/server";

import { adminWrite } from "@/lib/server/route";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";
import {
  deleteTransaction,
  updateTransaction,
  type UpdateTransactionInput,
} from "@/lib/domain/transactions";

type PatchTransactionBody = UpdateTransactionInput;

export const PATCH = adminWrite<PatchTransactionBody, { id: string }>({
  revalidate: revalidateTransactionWrite,
  handle: async (ctx, body, _req, params) => {
    const updated = await updateTransaction(ctx.prisma, params.id, body);
    return NextResponse.json(updated);
  },
});

export const DELETE = adminWrite<unknown, { id: string }>({
  revalidate: revalidateTransactionWrite,
  handle: async (ctx, _body, _req, params) => {
    const result = await deleteTransaction(ctx.prisma, params.id);
    return NextResponse.json(result);
  },
});
