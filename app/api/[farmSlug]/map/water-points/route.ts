/**
 * Phase K — Wave 2C — Tenant map layer: water points.
 *
 * GET /api/[farmSlug]/map/water-points
 *   → GeoJSON FeatureCollection of GameWaterPoint rows with valid gpsLat/gpsLon.
 *
 * Rows missing coordinates are silently filtered (there's nothing to render for
 * them on the map). The auth pattern mirrors `/api/[farmSlug]/rainfall` + the
 * silent-failure cure (memory/silent-failure-pattern.md): each error branch
 * returns a typed, specific error code so the UI can map it to actionable copy.
 *
 * Phase G (P6.5): migrated to `getFarmContextForSlug` — the helper collapses
 * 401 (no session) and 403 (cross-tenant) into a single null return. We
 * differentiate via a sentinel classifier so the UI's error-code mapping
 * keeps working.
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

  const rows = await ctx.prisma.gameWaterPoint.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      gpsLat: true,
      gpsLon: true,
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
        waterPointType: r.type,
        condition: r.status,
      },
    }));

  return NextResponse.json({
    type: "FeatureCollection",
    features,
  });
}
