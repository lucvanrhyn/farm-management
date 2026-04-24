/**
 * Phase K — Wave 2C — Tenant map layer: infrastructure.
 *
 * GET /api/[farmSlug]/map/infrastructure
 *   → GeoJSON FeatureCollection of GameInfrastructure rows.
 *
 * The schema currently models infrastructure as Points only (gpsLat/gpsLon —
 * no `geojson` field). If a future migration adds a `geojson` column for
 * LineString fences / paths, extend this route to parse + forward it as the
 * feature geometry. For now, only Point features are emitted.
 *
 * Phase G (P6.5): migrated to `getFarmContextForSlug`.
 *
 * Error codes:
 *   AUTH_REQUIRED              — 401, no session
 *   CROSS_TENANT_FORBIDDEN     — 403, session.farms doesn't include farmSlug
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { classifyFarmContextFailure } from "@/lib/server/farm-context-errors";

export const dynamic = "force-dynamic";

function asErr(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: code, message },
    { status },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) {
    const { code, status } = await classifyFarmContextFailure(req);
    return asErr(code, code === "AUTH_REQUIRED" ? "Sign in required" : "Forbidden", status);
  }

  const rows = await ctx.prisma.gameInfrastructure.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      condition: true,
      gpsLat: true,
      gpsLon: true,
      lengthKm: true,
      capacityAnimals: true,
    },
  });

  const features = rows
    .filter(
      (r): r is typeof r & { gpsLat: number; gpsLon: number } =>
        typeof r.gpsLat === "number" && typeof r.gpsLon === "number",
    )
    .map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [r.gpsLon, r.gpsLat],
      },
      properties: {
        id: r.id,
        name: r.name,
        infrastructureType: r.type,
        condition: r.condition,
        lengthKm: r.lengthKm,
        capacityAnimals: r.capacityAnimals,
      },
    }));

  return NextResponse.json({
    type: "FeatureCollection",
    features,
  });
}
