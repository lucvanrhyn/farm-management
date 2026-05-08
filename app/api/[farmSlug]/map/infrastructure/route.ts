/**
 * GET /api/[farmSlug]/map/infrastructure — GeoJSON FeatureCollection of
 * GameInfrastructure rows (Point features).
 *
 * Wave G3 (#167) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation:
 *   - 200 GeoJSON FeatureCollection unchanged (delegates to
 *     `listInfrastructure` from the map domain barrel).
 *   - 401 / 403 envelopes migrate from the per-route hand-rolled
 *     `{ success: false, error: CODE, message }` to the adapter's
 *     canonical `{ error: "AUTH_REQUIRED" | ..., message }` — same
 *     SCREAMING_SNAKE codes, same HTTP statuses.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { listInfrastructure } from "@/lib/domain/map";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx) => {
    const payload = await listInfrastructure(ctx.prisma);
    return NextResponse.json(payload);
  },
});
