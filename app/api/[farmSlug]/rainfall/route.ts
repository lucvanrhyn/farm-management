/**
 * GET    /api/[farmSlug]/rainfall — list rainfall records + monthly summary.
 * POST   /api/[farmSlug]/rainfall — create a rainfall record (ADMIN, fresh-admin re-verified).
 * DELETE /api/[farmSlug]/rainfall — delete a rainfall record (ADMIN, fresh-admin re-verified).
 *
 * Wave G5 (#169) — migrated onto `tenantReadSlug` / `tenantWriteSlug`.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G5 spec):
 *   - 200/201 success shapes unchanged.
 *   - 401 envelope migrates to the adapter's canonical
 *     `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - 403 (non-admin / stale-admin), 400 (validation), 404 (not-found),
 *     500 (DB) keep their bare-string `{ error: "<sentence>" }` envelopes —
 *     these are bespoke handler concerns. Phase H.2 defence-in-depth
 *     `verifyFreshAdminRole` checks stay inline.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug, tenantWriteSlug } from "@/lib/server/route";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateAlertWrite } from "@/lib/server/revalidate";
import { logger } from "@/lib/logger";
import type { FarmContext } from "@/lib/server/farm-context";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const campId = searchParams.get("campId");

    const where: Record<string, unknown> = {};
    if (from || to) {
      const dateFilter: Record<string, string> = {};
      if (from) dateFilter.gte = from;
      if (to) dateFilter.lte = to;
      where.date = dateFilter;
    }
    if (campId) {
      where.campId = campId;
    }

    const records = await ctx.prisma.rainfallRecord.findMany({
      where,
      orderBy: { date: "desc" },
    });

    // Compute monthly summary for chart
    const monthly = new Map<string, number>();
    for (const r of records) {
      const month = r.date.slice(0, 7);
      monthly.set(month, (monthly.get(month) ?? 0) + r.rainfallMm);
    }
    const monthlySummary = Array.from(monthly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, totalMm]) => ({
        month,
        totalMm: Math.round(totalMm * 10) / 10,
      }));

    return NextResponse.json({ records, monthlySummary });
  },
});

export const POST = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateAlertWrite,
  handle: async (ctx, body) => {
    const denied = await denyIfNotFreshAdmin(ctx);
    if (denied) return denied;

    const { date, rainfallMm, campId, stationName } = (body ?? {}) as {
      date?: unknown;
      rainfallMm?: unknown;
      campId?: unknown;
      stationName?: unknown;
    };

    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return NextResponse.json(
        { error: "date required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const mm = parseFloat(rainfallMm as string);
    if (isNaN(mm) || mm < 0) {
      return NextResponse.json(
        { error: "rainfallMm must be a non-negative number" },
        { status: 400 },
      );
    }

    const record = await ctx.prisma.rainfallRecord.create({
      data: {
        date,
        rainfallMm: mm,
        campId: (campId as string | undefined) || null,
        stationName: (stationName as string | undefined) || null,
      },
    });

    return NextResponse.json(record, { status: 201 });
  },
});

export const DELETE = tenantWriteSlug<unknown, { farmSlug: string }>({
  revalidate: revalidateAlertWrite,
  handle: async (ctx, _body, req) => {
    const denied = await denyIfNotFreshAdmin(ctx);
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    try {
      await ctx.prisma.rainfallRecord.delete({ where: { id } });
    } catch (err) {
      // Differentiate the "not found" case from actual DB failures so the
      // operator sees the real error instead of a misleading 404. Prisma's
      // P2025 is the "record to delete does not exist" code — anything else
      // is a connection / permission / constraint problem worth surfacing.
      const code = (err as { code?: string })?.code;
      if (code === "P2025") {
        return NextResponse.json({ error: "Record not found" }, { status: 404 });
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[rainfall DELETE]", { message, stack: err instanceof Error ? err.stack : "" });
      return NextResponse.json(
        { error: "Could not delete rainfall record" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  },
});
