/**
 * PATCH /api/[farmSlug]/camps/[campId]/cover/[readingId]/attachment —
 *   attach a Vercel Blob URL to a cover reading.
 *
 * Wave G6 (#170) — migrated onto `tenantWriteSlug`.
 *
 * NB: NO admin gate — any authenticated farm member may attach (the auth
 *     check is the adapter's farm-scope hop). The Blob upload happens
 *     client-side via signed URLs elsewhere; this route is JSON-only and
 *     records the resulting `attachmentUrl` on an existing reading.
 *
 * Wire-shape preservation (hybrid per ADR-0001 / Wave G6 spec):
 *   - 200 success shape unchanged: `{ success: true, attachmentUrl }`.
 *   - 401 envelope migrates to the adapter's canonical
 *     `{ error: "AUTH_REQUIRED", message: "..." }`.
 *   - 400 (validation), 404 (not-found), 500 (DB) keep their bare-string
 *     `{ error: "<sentence>" }` envelopes — bespoke handler concerns.
 *
 * Existing nested-ownership check `{ id: readingId, campId }` preserved
 * verbatim (no farm-scope check on `campId` — that's a defence-in-depth
 * gap acknowledged in the Wave G6 spec, OUT OF SCOPE for this wave).
 */
import { NextResponse } from "next/server";

import { tenantWriteSlug } from "@/lib/server/route";
import { logger } from "@/lib/logger";

export const PATCH = tenantWriteSlug<
  unknown,
  { farmSlug: string; campId: string; readingId: string }
>({
  handle: async (ctx, body, _req, { campId, readingId }) => {
    // No role check — any authenticated farm member can attach.
    const { attachmentUrl } = (body ?? {}) as { attachmentUrl?: unknown };

    if (typeof attachmentUrl !== "string" || !attachmentUrl) {
      return NextResponse.json(
        { error: "attachmentUrl must be a non-empty string" },
        { status: 400 },
      );
    }

    try {
      const existing = await ctx.prisma.campCoverReading.findFirst({
        where: { id: readingId, campId },
      });
      if (!existing) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const updated = await ctx.prisma.campCoverReading.update({
        where: { id: readingId },
        data: { attachmentUrl },
      });

      return NextResponse.json({ success: true, attachmentUrl: updated.attachmentUrl });
    } catch (err) {
      logger.error("[cover/attachment PATCH] DB error", err);
      return NextResponse.json(
        { error: "Failed to update attachment" },
        { status: 500 },
      );
    }
  },
});
