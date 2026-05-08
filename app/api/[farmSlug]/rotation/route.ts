/**
 * GET /api/[farmSlug]/rotation — full rotation payload (per-camp status,
 * counts, next-to-graze ranking, season multiplier).
 *
 * Wave G2 (#166) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation:
 *   - 200 RotationPayload shape unchanged (delegates to
 *     `getRotationStatusByCamp` from the rotation domain barrel).
 *   - 401 envelope migrates from `{ error: "Unauthorized" }` to the
 *     adapter's canonical `{ error: "AUTH_REQUIRED", message: "..." }`.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { getRotationStatusByCamp } from "@/lib/domain/rotation";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx) => {
    const payload = await getRotationStatusByCamp(ctx.prisma);
    return NextResponse.json(payload);
  },
});
