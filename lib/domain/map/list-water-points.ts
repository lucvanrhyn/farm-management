/**
 * Wave G3 (#167) — domain op `listWaterPoints`.
 *
 * Returns a GeoJSON `FeatureCollection` of GameWaterPoint Points. Rows
 * missing coordinates are silently dropped — there's nothing to render
 * for them on the map.
 *
 * Wire-shape preserved verbatim from the pre-G3 GET handler in
 * `app/api/[farmSlug]/map/water-points/route.ts`.
 */
import type { PrismaClient } from "@prisma/client";

import type { GeoJsonFeatureCollection } from "./types";

interface WaterPointProperties {
  id: string;
  name: string | null;
  waterPointType: string | null;
  condition: string | null;
}

export async function listWaterPoints(
  prisma: PrismaClient,
): Promise<GeoJsonFeatureCollection<WaterPointProperties>> {
  const rows = await prisma.gameWaterPoint.findMany({
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
        coordinates: [r.gpsLon, r.gpsLat] as [number, number],
      },
      properties: {
        id: r.id,
        name: r.name,
        waterPointType: r.type,
        condition: r.status,
      },
    }));

  return {
    type: "FeatureCollection",
    features,
  };
}
