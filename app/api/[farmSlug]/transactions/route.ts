/**
 * GET  /api/[farmSlug]/transactions — list ledger entries (filterable by month range).
 * POST /api/[farmSlug]/transactions — create a transaction (ADMIN, fresh-admin re-verified).
 *
 * Wave G5 (#169) — migrated onto `tenantReadSlug` / `tenantWriteSlug`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G5 spec):
 *   - 200 list shape unchanged ({ transactions, summary }).
 *   - 201 create shape unchanged.
 *   - 401 envelope migrates from `{ error: "Unauthorized" }` to the
 *     adapter's canonical `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - 403 (non-admin / stale-admin) and 400 (validation) keep their bare-string
 *     `{ error: "<sentence>" }` envelopes — these are bespoke handler concerns,
 *     not adapter concerns. Phase H.2 defence-in-depth `verifyFreshAdminRole`
 *     check stays inline.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug, tenantWriteSlug } from "@/lib/server/route";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const where: Record<string, unknown> = {};
    if (from || to) {
      const dateFilter: Record<string, string> = {};
      if (from) dateFilter.gte = `${from}-01`;
      if (to) dateFilter.lte = `${to}-31`;
      where.date = dateFilter;
    }

    const transactions = await ctx.prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
    });

    // Compute summary
    let income = 0;
    let expenses = 0;
    for (const tx of transactions) {
      if (tx.type === "income") {
        income += tx.amount;
      } else {
        expenses += tx.amount;
      }
    }

    return NextResponse.json({
      transactions,
      summary: { income, expenses, net: income - expenses },
    });
  },
});

export const POST = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateTransactionWrite,
  handle: async (ctx, body) => {
    // Phase H.2 defence-in-depth — keep verbatim. Re-verify ADMIN against
    // meta-db to close the stale-ADMIN window introduced when Phase H
    // dropped the jwt-callback meta-db refresh.
    if (ctx.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const {
      type,
      category,
      amount,
      description,
      date,
      campId,
      animalId,
      reference,
      saleType,
      counterparty,
      quantity,
      avgMassKg,
      fees,
      transportCost,
      animalIds,
    } = (body ?? {}) as {
      type?: unknown;
      category?: unknown;
      amount?: unknown;
      description?: unknown;
      date?: unknown;
      campId?: unknown;
      animalId?: unknown;
      reference?: unknown;
      saleType?: unknown;
      counterparty?: unknown;
      quantity?: unknown;
      avgMassKg?: unknown;
      fees?: unknown;
      transportCost?: unknown;
      animalIds?: unknown;
    };

    if (!type || !category || amount == null || !date) {
      return NextResponse.json(
        { error: "type, category, amount, date required" },
        { status: 400 },
      );
    }

    if (saleType != null && saleType !== "auction" && saleType !== "private") {
      return NextResponse.json(
        { error: "saleType must be 'auction' or 'private'" },
        { status: 400 },
      );
    }

    const transaction = await ctx.prisma.transaction.create({
      data: {
        type: type as string,
        category: category as string,
        amount: parseFloat(amount as string),
        date: date as string,
        description: (description as string | undefined) ?? "",
        campId: (campId as string | null | undefined) ?? null,
        animalId: (animalId as string | null | undefined) ?? null,
        reference: (reference as string | null | undefined) ?? null,
        createdBy: ctx.session.user?.email ?? null,
        saleType: (saleType as string | null | undefined) ?? null,
        counterparty: (counterparty as string | null | undefined) ?? null,
        quantity: quantity != null ? parseInt(quantity as string, 10) : null,
        avgMassKg: avgMassKg != null ? parseFloat(avgMassKg as string) : null,
        fees: fees != null ? parseFloat(fees as string) : null,
        transportCost:
          transportCost != null ? parseFloat(transportCost as string) : null,
        animalIds: (animalIds as string | null | undefined) ?? null,
      },
    });

    return NextResponse.json(transaction, { status: 201 });
  },
});
