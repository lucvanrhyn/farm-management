/**
 * POST /api/[farmSlug]/tax/it3/[id]/void — void an issued IT3 snapshot (ADMIN)
 *
 * Wave G8 (#172) — migrated onto `tenantWriteSlug`. Final feature wave of the
 * ADR-0001 7/8 rollout.
 *
 * Wire-shape preservation:
 *   - 200 success `{ ok: true }` unchanged.
 *   - 401 envelope migrates to the adapter's canonical `AUTH_REQUIRED` typed
 *     envelope.
 *   - 400 INVALID_BODY on malformed JSON now flows through the adapter's typed
 *     envelope (matches G5-G7 precedent). Empty body is naturally tolerated —
 *     the adapter parses an empty stream as `{}` and `body.reason` falls back
 *     to the default audit-trail string.
 *   - 403 (`Forbidden`), 404 (`IT3 snapshot not found`),
 *     409 (`Snapshot is already voided`) preserved verbatim as bare-string
 *     `{ error: "<sentence>" }` for the IT3 history-table toast.
 *   - Default `"Voided by admin"` reason preserved verbatim (audit-trail string).
 */
import { NextResponse } from "next/server";

import { tenantWriteSlug } from "@/lib/server/route";
import { verifyFreshAdminRole } from "@/lib/auth";
import { voidIt3Snapshot } from "@/lib/server/sars-it3";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

export const POST = tenantWriteSlug<unknown, { farmSlug: string; id: string }>({
  revalidate: revalidateObservationWrite,
  handle: async (ctx, parsedBody, _req, { id }) => {
    if (ctx.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const record = await ctx.prisma.it3Snapshot.findUnique({
      where: { id },
      select: { id: true, voidedAt: true },
    });
    if (!record) {
      return NextResponse.json({ error: "IT3 snapshot not found" }, { status: 404 });
    }
    if (record.voidedAt) {
      return NextResponse.json({ error: "Snapshot is already voided" }, { status: 409 });
    }

    // Adapter has already parsed JSON; an empty body resolves to `{}`. Verify
    // shape before reading the optional `reason` field — defence-in-depth so
    // arrays/primitives don't blow up the typeof guard below.
    const body =
      parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
        ? (parsedBody as { reason?: unknown })
        : {};

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Voided by admin";

    await voidIt3Snapshot(ctx.prisma, id, reason);

    return NextResponse.json({ ok: true });
  },
});
