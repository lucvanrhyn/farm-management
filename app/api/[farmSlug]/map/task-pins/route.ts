/**
 * Phase K — Wave 2C — Tenant map layer: task pins.
 *
 * GET /api/[farmSlug]/map/task-pins?status=today|open|all
 *   → GeoJSON FeatureCollection of Point features, one per Task with a
 *     resolvable coordinate.
 *
 * Coordinate resolution, in order:
 *   1. Task has explicit lat/lng                     → use them.
 *   2. Task has campId and that Camp has a geojson   → use the camp centroid.
 *   3. Otherwise                                      → skip (can't render).
 *
 * Centroid algorithm: unweighted average of all polygon-ring vertex lons/lats.
 * Good enough for marker placement; not geodesically exact. Works for Point,
 * Polygon, MultiPolygon, LineString, MultiLineString geometries.
 *
 * Status filter (default `open`):
 *   today → dueDate == today (Africa/Johannesburg day boundary) AND status in (pending,in_progress)
 *   open  → status in (pending, in_progress)
 *   all   → no status filter
 *
 * Auth mirrors `/api/[farmSlug]/rainfall`.
 *
 * Error codes:
 *   AUTH_REQUIRED              — 401, no session
 *   CROSS_TENANT_FORBIDDEN     — 403, session.farms doesn't include farmSlug
 *   FARM_NOT_FOUND             — 404, slug exists in URL but not in meta DB
 *   INVALID_FARM_SLUG          — 400, malformed slug
 *   INVALID_STATUS_FILTER      — 400, ?status= not one of today|open|all
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

const VALID_STATUS_FILTERS = new Set(["today", "open", "all"]);

/** Returns `[lng, lat]` centroid from any GeoJSON geometry, or null. */
function geometryCentroid(
  geom: unknown,
): [number, number] | null {
  if (!geom || typeof geom !== "object") return null;
  const g = geom as { type?: unknown; coordinates?: unknown };
  if (typeof g.type !== "string") return null;

  const coords: [number, number][] = [];

  const pushPoint = (p: unknown) => {
    if (
      Array.isArray(p) &&
      p.length >= 2 &&
      typeof p[0] === "number" &&
      typeof p[1] === "number" &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1])
    ) {
      coords.push([p[0], p[1]]);
    }
  };

  const walk = (node: unknown, depth: number) => {
    if (!Array.isArray(node)) return;
    if (depth === 0) {
      pushPoint(node);
      return;
    }
    for (const child of node) walk(child, depth - 1);
  };

  // Walk depth depends on geometry type.
  switch (g.type) {
    case "Point":
      pushPoint(g.coordinates);
      break;
    case "MultiPoint":
    case "LineString":
      walk(g.coordinates, 1);
      break;
    case "MultiLineString":
    case "Polygon":
      walk(g.coordinates, 2);
      break;
    case "MultiPolygon":
      walk(g.coordinates, 3);
      break;
    default:
      return null;
  }

  if (coords.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of coords) {
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / coords.length, sumLat / coords.length];
}

function todayInJohannesburg(): string {
  // YYYY-MM-DD in Africa/Johannesburg. Matches Task.dueDate format.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return asErr("AUTH_REQUIRED", "Sign in required", 401);
  }

  const { farmSlug } = await params;
  const db = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in db) return mapDbErr(db.status, db.error);

  const statusFilter = new URL(req.url).searchParams.get("status") ?? "open";
  if (!VALID_STATUS_FILTERS.has(statusFilter)) {
    return asErr(
      "INVALID_STATUS_FILTER",
      "status must be one of: today, open, all",
      400,
    );
  }

  const where: Record<string, unknown> = {};
  if (statusFilter === "today") {
    where.dueDate = todayInJohannesburg();
    where.status = { in: ["pending", "in_progress"] };
  } else if (statusFilter === "open") {
    where.status = { in: ["pending", "in_progress"] };
  }

  const [tasks, camps] = await Promise.all([
    db.prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        taskType: true,
        status: true,
        priority: true,
        dueDate: true,
        animalId: true,
        campId: true,
        lat: true,
        lng: true,
      },
    }),
    db.prisma.camp.findMany({
      select: { campId: true, geojson: true },
      where: { geojson: { not: null } },
    }),
  ]);

  // Precompute camp centroids once (O(camps), not O(tasks × camps)).
  const campCentroids = new Map<string, [number, number]>();
  for (const c of camps) {
    if (!c.geojson) continue;
    try {
      const parsed = JSON.parse(c.geojson);
      // Camp.geojson can be either a Feature or raw Geometry.
      const geom =
        parsed && typeof parsed === "object" && "geometry" in parsed
          ? (parsed as { geometry: unknown }).geometry
          : parsed;
      const centroid = geometryCentroid(geom);
      if (centroid) campCentroids.set(c.campId, centroid);
    } catch {
      // Silently skip unparseable geojson — the camp just won't provide a fallback.
    }
  }

  const features = tasks
    .map((t) => {
      let coords: [number, number] | null = null;
      if (typeof t.lat === "number" && typeof t.lng === "number") {
        coords = [t.lng, t.lat];
      } else if (t.campId) {
        const centroid = campCentroids.get(t.campId);
        if (centroid) coords = centroid;
      }
      if (!coords) return null;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coords },
        properties: {
          id: t.id,
          title: t.title,
          taskType: t.taskType,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          animalId: t.animalId,
          campId: t.campId,
        },
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  return NextResponse.json({
    type: "FeatureCollection",
    features,
  });
}
