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

import { routeError, tenantReadSlug, tenantWriteSlug } from "@/lib/server/route";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

/**
 * api-F4 — parse a single numeric field, rejecting non-finite input.
 *
 * `parseFloat`/`parseInt` silently accept leading-numeric junk
 * (`parseFloat("12abc") === 12`) and the literals `NaN`/`Infinity`, so a
 * non-finite or junk value used to be PERSISTED and poison every IT3 /
 * finance aggregate that sums these columns. We use `Number(...)` (whole-string
 * coercion) + `Number.isFinite` so only genuinely finite values pass.
 *
 * Returns `{ value }` on success or `{ error: true }` when the field is present
 * but non-finite. `null`/`undefined` optional fields are caller-handled before
 * this is reached.
 */
function parseFiniteNumber(
  v: unknown,
  opts: { integer?: boolean } = {},
): { value: number } | { error: true } {
  // Reject empty / whitespace-only strings outright — Number("") === 0, which
  // would otherwise silently coerce a blank to zero.
  if (typeof v === "string" && v.trim() === "") return { error: true };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return { error: true };
  return { value: opts.integer ? Math.trunc(n) : n };
}

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

    // api-F4 — finite-guard every numeric field at the input boundary. A
    // non-finite value (NaN / ±Infinity / "12abc" / blank) must NOT persist:
    // it silently poisons every IT3 + finance aggregate that sums these
    // columns. `amount` is required (presence checked above); the rest are
    // optional and guarded only when present. Rejections use the canonical
    // ADR-0001 typed envelope.
    const amountParsed = parseFiniteNumber(amount);
    if ("error" in amountParsed) {
      return routeError("VALIDATION_FAILED", "amount must be a finite number", 400);
    }

    const optionalNumerics: Array<{
      field: string;
      raw: unknown;
      integer?: boolean;
    }> = [
      { field: "quantity", raw: quantity, integer: true },
      { field: "avgMassKg", raw: avgMassKg },
      { field: "fees", raw: fees },
      { field: "transportCost", raw: transportCost },
    ];
    const optionalValues: Record<string, number | null> = {};
    for (const { field, raw, integer } of optionalNumerics) {
      if (raw == null) {
        optionalValues[field] = null;
        continue;
      }
      const parsed = parseFiniteNumber(raw, { integer });
      if ("error" in parsed) {
        return routeError(
          "VALIDATION_FAILED",
          `${field} must be a finite number`,
          400,
        );
      }
      optionalValues[field] = parsed.value;
    }

    const transaction = await ctx.prisma.transaction.create({
      data: {
        type: type as string,
        category: category as string,
        amount: amountParsed.value,
        date: date as string,
        description: (description as string | undefined) ?? "",
        campId: (campId as string | null | undefined) ?? null,
        animalId: (animalId as string | null | undefined) ?? null,
        reference: (reference as string | null | undefined) ?? null,
        createdBy: ctx.session.user?.email ?? null,
        saleType: (saleType as string | null | undefined) ?? null,
        counterparty: (counterparty as string | null | undefined) ?? null,
        quantity: optionalValues.quantity,
        avgMassKg: optionalValues.avgMassKg,
        fees: optionalValues.fees,
        transportCost: optionalValues.transportCost,
        animalIds: (animalIds as string | null | undefined) ?? null,
      },
    });

    return NextResponse.json(transaction, { status: 201 });
  },
});
