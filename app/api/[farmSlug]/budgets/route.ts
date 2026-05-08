/**
 * GET    /api/[farmSlug]/budgets — list budget rows (filterable by year/month).
 * POST   /api/[farmSlug]/budgets — upsert a budget row (ADMIN, fresh-admin re-verified).
 * PATCH  /api/[farmSlug]/budgets — update a budget row (ADMIN, fresh-admin re-verified).
 * DELETE /api/[farmSlug]/budgets — delete a budget row (ADMIN, fresh-admin re-verified).
 *
 * Wave G5 (#169) — migrated onto `tenantReadSlug` / `tenantWriteSlug`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G5 spec):
 *   - 200/201 success shapes unchanged.
 *   - 401 envelope migrates to the adapter's canonical
 *     `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - 403 (non-admin / stale-admin), 400 (validation), 404 (not-found) keep
 *     their bare-string `{ error: "<sentence>" }` envelopes — these are
 *     bespoke handler concerns. Phase H.2 defence-in-depth
 *     `verifyFreshAdminRole` checks stay inline.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug, tenantWriteSlug } from "@/lib/server/route";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateTransactionWrite } from "@/lib/server/revalidate";
import { logger } from "@/lib/logger";
import type { FarmContext } from "@/lib/server/farm-context";

export const dynamic = "force-dynamic";

/**
 * Phase H.2 fresh-admin gate — common to every write method on this route.
 * Returns a 403 NextResponse on failure; null on success.
 */
async function denyIfNotFreshAdmin(ctx: FarmContext): Promise<NextResponse | null> {
  if (ctx.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

function parseIntOrNull(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const year = parseIntOrNull(searchParams.get("year"));
    const month = parseIntOrNull(searchParams.get("month"));
    const fromYear = parseIntOrNull(searchParams.get("fromYear"));
    const fromMonth = parseIntOrNull(searchParams.get("fromMonth"));
    const toYear = parseIntOrNull(searchParams.get("toYear"));
    const toMonth = parseIntOrNull(searchParams.get("toMonth"));

    const where: Record<string, unknown> = {};
    if (year !== null) where.year = year;
    if (month !== null) where.month = month;

    let records = await ctx.prisma.budget.findMany({
      where,
      orderBy: [{ year: "asc" }, { month: "asc" }, { categoryName: "asc" }],
    });

    if (fromYear !== null && fromMonth !== null && toYear !== null && toMonth !== null) {
      const fromKey = fromYear * 12 + (fromMonth - 1);
      const toKey = toYear * 12 + (toMonth - 1);
      records = records.filter((r) => {
        const key = r.year * 12 + (r.month - 1);
        return key >= fromKey && key <= toKey;
      });
    }

    return NextResponse.json({ records });
  },
});

export const POST = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateTransactionWrite,
  handle: async (ctx, body) => {
    const denied = await denyIfNotFreshAdmin(ctx);
    if (denied) return denied;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { year, month, categoryName, type, amount, notes } = body as {
      year?: unknown;
      month?: unknown;
      categoryName?: unknown;
      type?: unknown;
      amount?: unknown;
      notes?: unknown;
    };

    if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "year must be an integer 2000-2100" }, { status: 400 });
    }
    if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "month must be an integer 1-12" }, { status: 400 });
    }
    if (typeof categoryName !== "string" || categoryName.trim() === "") {
      return NextResponse.json({ error: "categoryName required" }, { status: 400 });
    }
    if (type !== "income" && type !== "expense") {
      return NextResponse.json({ error: "type must be 'income' or 'expense'" }, { status: 400 });
    }
    const amt = typeof amount === "number" ? amount : Number.parseFloat(String(amount));
    if (!Number.isFinite(amt) || amt < 0) {
      return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 });
    }
    const notesStr = typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null;

    const record = await ctx.prisma.budget.upsert({
      where: {
        budget_year_month_category: {
          year,
          month,
          categoryName: categoryName.trim(),
        },
      },
      create: {
        year,
        month,
        categoryName: categoryName.trim(),
        type,
        amount: amt,
        notes: notesStr,
      },
      update: {
        type,
        amount: amt,
        notes: notesStr,
      },
    });

    return NextResponse.json(record, { status: 201 });
  },
});

export const PATCH = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateTransactionWrite,
  handle: async (ctx, body, req) => {
    const denied = await denyIfNotFreshAdmin(ctx);
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { amount, notes } = body as { amount?: unknown; notes?: unknown };
    const data: { amount?: number; notes?: string | null } = {};

    if (amount !== undefined) {
      const amt = typeof amount === "number" ? amount : Number.parseFloat(String(amount));
      if (!Number.isFinite(amt) || amt < 0) {
        return NextResponse.json({ error: "amount must be non-negative" }, { status: 400 });
      }
      data.amount = amt;
    }
    if (notes !== undefined) {
      data.notes = typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    try {
      const record = await ctx.prisma.budget.update({ where: { id }, data });
      return NextResponse.json(record);
    } catch {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
  },
});

export const DELETE = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateTransactionWrite,
  handle: async (ctx, _body, req) => {
    const denied = await denyIfNotFreshAdmin(ctx);
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await ctx.prisma.budget.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    try {
      await ctx.prisma.budget.delete({ where: { id } });
    } catch (err) {
      logger.error("[budgets DELETE] DB error", err);
      return NextResponse.json({ error: "Failed to delete budget record" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  },
});
