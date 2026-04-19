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
 * Error codes:
 *   AUTH_REQUIRED              — 401, no session
 *   CROSS_TENANT_FORBIDDEN     — 403, session.farms doesn't include farmSlug
 *   FARM_NOT_FOUND             — 404, slug exists in URL but not in meta DB
 *   INVALID_FARM_SLUG          — 400, malformed slug
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";

export const dynamic = "force-dynamic";

function asErr(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, error: code, message },
    { status },
  );
}

function mapDbErr(status: number, message: string) {
  if (status === 403) return asErr("CROSS_TENANT_FORBIDDEN", message, 403);
  if (status === 404) return asErr("FARM_NOT_FOUND", message, 404);
  if (status === 400) return asErr("INVALID_FARM_SLUG", message, 400);
  return asErr("INTERNAL_ERROR", message, status);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return asErr("AUTH_REQUIRED", "Sign in required", 401);
  }

  const { farmSlug } = await params;
  const db = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in db) return mapDbErr(db.status, db.error);

  const rows = await db.prisma.gameWaterPoint.findMany({
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
