/**
 * DELETE /api/transactions/reset — admin bulk-delete every transaction
 * AND every transactionCategory row in the tenant.
 *
 * Wave D (#159) — adapter-only wiring under `adminWrite` (ADMIN role +
 * fresh-admin re-verify enforced by the adapter).
 *
 * Wire shape `{ success: true }` is preserved verbatim.
 */
import { NextResponse } from "next/server";

import { adminWrite } from "@/lib/server/route";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";
import { resetTransactions } from "@/lib/domain/transactions";

export const DELETE = adminWrite({
  revalidate: revalidateTransactionWrite,
  handle: async (ctx) => {
    const result = await resetTransactions(ctx.prisma);
    return NextResponse.json(result);
  },
});
