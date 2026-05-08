/**
 * GET /api/[farmSlug]/nvd/[id] — return a single NVD's full snapshot data
 *
 * Wave G1 (#165) — migrated onto `tenantReadSlug`. The not-found path is
 * wired into `mapApiDomainError` via `getNvdByIdOrThrow` →
 * `NvdNotFoundError` → 404 `{ error: "NVD_NOT_FOUND" }`.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { getNvdByIdOrThrow } from "@/lib/domain/nvd";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string; id: string }>({
  handle: async (ctx, _req, params) => {
    const record = await getNvdByIdOrThrow(ctx.prisma, params.id);
    return NextResponse.json(record);
  },
});
