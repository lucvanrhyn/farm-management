/**
 * POST /api/[farmSlug]/nvd/[id]/void — void an issued NVD (ADMIN only)
 *
 * Wave G1 (#165) — migrated onto `adminWriteSlug`. The 404 (not found)
 * and 409 (already voided) paths come from `voidNvdById` throwing
 * `NvdNotFoundError` / `NvdAlreadyVoidedError`, which `mapApiDomainError`
 * maps onto canonical envelopes.
 */
import { NextResponse } from "next/server";

import { adminWriteSlug } from "@/lib/server/route";
import { voidNvdById } from "@/lib/domain/nvd";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

interface VoidBody {
  reason?: string;
}

export const POST = adminWriteSlug<VoidBody, { farmSlug: string; id: string }>({
  revalidate: revalidateObservationWrite,
  handle: async (ctx, body, _req, params) => {
    const reason =
      typeof body?.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Voided by admin";

    await voidNvdById(ctx.prisma, params.id, reason);

    return NextResponse.json({ ok: true });
  },
});
