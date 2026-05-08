/**
 * GET /api/[farmSlug]/map/rainfall-gauges — GeoJSON FeatureCollection of
 * Point features, one per unique (lat,lng) gauge with last24h / last7d
 * totals aggregated from RainfallRecord rows in the last 7 days.
 *
 * Wave G3 (#167) — migrated onto `tenantReadSlug`.
 *
 * Wire-shape preservation:
 *   - 200 GeoJSON FeatureCollection unchanged (delegates to
 *     `listRainfallGauges` from the map domain barrel).
 *   - 401 / 403 envelopes migrate from the per-route hand-rolled
 *     `{ success: false, error: CODE, message }` to the adapter's
 *     canonical `{ error: "AUTH_REQUIRED" | ..., message }` — same
 *     SCREAMING_SNAKE codes, same HTTP statuses.
 */
import { NextResponse } from "next/server";

import { tenantReadSlug } from "@/lib/server/route";
import { listRainfallGauges } from "@/lib/domain/map";

export const dynamic = "force-dynamic";

export const GET = tenantReadSlug<{ farmSlug: string }>({
  handle: async (ctx) => {
    const payload = await listRainfallGauges(ctx.prisma);
    return NextResponse.json(payload);
  },
});
