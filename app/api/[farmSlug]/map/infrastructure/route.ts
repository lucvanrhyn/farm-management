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
 * Auth mirrors `/api/[farmSlug]/rainfall`; error codes match the sibling
 * water-points route.
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

  const rows = await db.prisma.gameInfrastructure.findMany({
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
