/**
 * Wave G3 (#167) — domain op `listInfrastructure`.
 *
 * Returns a GeoJSON `FeatureCollection` of GameInfrastructure rows. The
 * schema currently models infrastructure as Points only (gpsLat/gpsLon —
 * no `geojson` field). If a future migration adds a `geojson` column for
 * LineString fences / paths, extend this op to parse + forward it as the
 * feature geometry. For now, only Point features are emitted; rows missing
 * coordinates are silently dropped.
 *
 * Wire-shape preserved verbatim from the pre-G3 GET handler in
 * `app/api/[farmSlug]/map/infrastructure/route.ts`.
 */
import type { PrismaClient } from "@prisma/client";

import type { GeoJsonFeatureCollection } from "./types";

interface InfrastructureProperties {
  id: string;
  name: string | null;
  infrastructureType: string | null;
  condition: string | null;
  lengthKm: number | null;
  capacityAnimals: number | null;
}

export async function listInfrastructure(
  prisma: PrismaClient,
): Promise<GeoJsonFeatureCollection<InfrastructureProperties>> {
  const rows = await prisma.gameInfrastructure.findMany({
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
        coordinates: [r.gpsLon, r.gpsLat] as [number, number],
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

  return {
    type: "FeatureCollection",
    features,
  };
}
