"use client";

import { Polygon } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import type { Camp } from "@/lib/types";
import type { CampStats } from "@/lib/types";
import CampPopup from "./CampPopup";

interface Props {
  camp: Camp;
  stats: CampStats;
  grazing: string;
  onClick: (campId: string) => void;
}

const GRAZING_COLORS: Record<string, string> = {
  Good:       "#22c55e",
  Fair:       "#eab308",
  Poor:       "#f97316",
  Overgrazed: "#ef4444",
};

function parseCoords(geojson: string): LatLngExpression[] {
  try {
    const parsed = JSON.parse(geojson) as { type: string; coordinates: number[][][] };
    // GeoJSON is [lng, lat], Leaflet wants [lat, lng]
    return parsed.coordinates[0].map(([lng, lat]) => [lat, lng] as LatLngExpression);
  } catch {
    return [];
  }
}

export default function CampPolygon({ camp, stats, grazing, onClick }: Props) {
  if (!camp.geojson) return null;
  const positions = parseCoords(camp.geojson);
  if (positions.length === 0) return null;

  const color = GRAZING_COLORS[grazing] ?? "#94a3b8";

  return (
    <Polygon
      positions={positions}
      pathOptions={{
        color,
        fillColor: color,
        fillOpacity: 0.4,
        weight: 2,
        opacity: 0.85,
      }}
      eventHandlers={{
        click: () => onClick(camp.camp_id),
      }}
    >
      <CampPopup camp={camp} stats={stats} grazing={grazing} />
    </Polygon>
  );
}
