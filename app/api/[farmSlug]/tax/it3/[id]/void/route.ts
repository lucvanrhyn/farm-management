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
 *   - S26 (ADR-0001 sweep) — 403 → FORBIDDEN, 404 → NOT_FOUND, 409 →
 *     SNAPSHOT_ALREADY_VOIDED converge on the canonical typed envelope
 *     `{ error: CODE, message }` (statuses unchanged). The human sentence
 *     moves to `message` for the IT3 history-table toast.
 *   - Default `"Voided by admin"` reason preserved verbatim (audit-trail string).
 */
import { NextResponse } from "next/server";

import { tenantWriteSlug } from "@/lib/server/route";
import { routeError } from "@/lib/server/route/envelope";
import { verifyFreshAdminRole } from "@/lib/auth";
import { voidIt3Snapshot } from "@/lib/server/sars-it3";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

export const POST = tenantWriteSlug<unknown, { farmSlug: string; id: string }>({
  // Issue #413 — voiding an IT3 does NOT touch an Observation row; it
  // reuses `revalidateObservationWrite` only for the dashboard tag.
  // Pass `null` to keep historical observations + dashboard tag
  // invalidation, never the `farm-<slug>-camps` tag.
  revalidate: (slug) => revalidateObservationWrite(slug, null),
  handle: async (ctx, parsedBody, _req, { id }) => {
    if (ctx.role !== "ADMIN") {
      return routeError("FORBIDDEN", "Forbidden", 403);
    }
    // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
    if (!(await verifyFreshAdminRole(ctx.session.user.id, ctx.slug))) {
      return routeError("FORBIDDEN", "Forbidden", 403);
    }

    const record = await ctx.prisma.it3Snapshot.findUnique({
      where: { id },
      select: { id: true, voidedAt: true },
    });
    if (!record) {
      return routeError("NOT_FOUND", "IT3 snapshot not found", 404);
    }
    if (record.voidedAt) {
      return routeError("SNAPSHOT_ALREADY_VOIDED", "Snapshot is already voided", 409);
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
