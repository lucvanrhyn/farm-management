/**
 * Color ramps and GeoJSON builder for CampLayer.
 *
 * Extracted to keep CampLayer.tsx ≤ 200 LOC. These helpers are pure and have
 * no runtime side-effects.
 */

import type { Camp, CampStats } from "@/lib/types";
import { DEFAULT_CAMP_COLOR } from "@/lib/camp-colors";

export interface CampData {
  camp: Camp;
  stats: CampStats;
  grazing: string;
  waterStatus?: string;
  fenceStatus?: string;
  lastInspected?: string;
  daysSinceInspection?: number;
  censusPopulation?: number;
  rotationStatus?: "grazing" | "overstayed" | "resting" | "resting_ready" | "overdue_rest" | "unknown";
  rotationDays?: number | null;
  veldScore?: number | null;
  feedOnOfferKgDmPerHa?: number | null;
}

export type OverlayMode =
  | "grazing"
  | "density"
  | "inspection"
  | "water"
  | "census"
  | "rotation"
  | "veld_condition"
  | "feed_on_offer";

const GRAZING_COLORS: Record<string, string> = {
  Good:       "#22c55e",
  Fair:       "#eab308",
  Poor:       "#f97316",
  Overgrazed: "#ef4444",
};

const DEFAULT_FALLBACK_COLOR = "#94a3b8";

const WATER_COLORS: Record<string, string> = {
  Good:     "#22c55e",
  Adequate: "#eab308",
  Poor:     "#f97316",
  Critical: "#ef4444",
};

export function getOverlayColor(mode: OverlayMode, cd: CampData): string {
  switch (mode) {
    case "grazing":
      return GRAZING_COLORS[cd.grazing] ?? DEFAULT_FALLBACK_COLOR;
    case "water":
      return WATER_COLORS[cd.waterStatus ?? ""] ?? DEFAULT_FALLBACK_COLOR;
    case "density": {
      const ha = cd.camp.size_hectares;
      const count = cd.stats.total;
      if (!ha || ha <= 0) return DEFAULT_FALLBACK_COLOR;
      const density = count / ha;
      if (density <= 0.5) return "#22c55e";
      if (density <= 1.0) return "#eab308";
      if (density <= 2.0) return "#f97316";
      return "#ef4444";
    }
    case "inspection": {
      const days = cd.daysSinceInspection;
      if (days == null) return DEFAULT_FALLBACK_COLOR;
      if (days <= 7) return "#22c55e";
      if (days <= 14) return "#eab308";
      if (days <= 30) return "#f97316";
      return "#ef4444";
    }
    case "census": {
      const pop = cd.censusPopulation ?? 0;
      const ha = cd.camp.size_hectares;
      if (!ha || ha <= 0 || pop === 0) return DEFAULT_FALLBACK_COLOR;
      const densityPerHa = pop / ha;
      if (densityPerHa <= 2) return "#22c55e";
      if (densityPerHa <= 5) return "#eab308";
      if (densityPerHa <= 10) return "#f97316";
      return "#ef4444";
    }
    case "rotation": {
      switch (cd.rotationStatus) {
        case "grazing":       return "#3b82f6";
        case "overstayed":    return "#dc2626";
        case "resting_ready": return "#16a34a";
        case "resting":       return "#86efac";
        case "overdue_rest":  return "#f59e0b";
        default:              return "#9ca3af";
      }
    }
    case "veld_condition": {
      const s = cd.veldScore;
      if (s == null) return "#9ca3af";
      if (s < 3) return "#ef4444";
      if (s < 5) return "#f97316";
      if (s < 7) return "#eab308";
      return "#22c55e";
    }
    case "feed_on_offer": {
      const f = cd.feedOnOfferKgDmPerHa;
      if (f == null) return "#9ca3af";
      if (f < 500) return "#ef4444";
      if (f < 1000) return "#f97316";
      if (f < 2000) return "#eab308";
      return "#22c55e";
    }
  }
}

export function buildCampGeoJSON(campData: CampData[], overlay: OverlayMode): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const cd of campData) {
    const { camp, stats, grazing } = cd;
    if (!camp.geojson) continue;
    try {
      const parsed = JSON.parse(camp.geojson) as GeoJSON.Geometry;
      const identityColor = camp.color ?? DEFAULT_CAMP_COLOR;
      features.push({
        type: "Feature",
        geometry: parsed,
        properties: {
          campId: camp.camp_id,
          campName: camp.camp_name,
          grazing,
          animalCount: stats.total,
          sizeHectares: camp.size_hectares ?? -1,
          waterStatus: cd.waterStatus ?? "Unknown",
          fenceStatus: cd.fenceStatus ?? "Unknown",
          daysSinceInspection: cd.daysSinceInspection ?? -1,
          censusPopulation: cd.censusPopulation ?? 0,
          labelSubtext:
            overlay === "census"
              ? `${cd.censusPopulation ?? 0} game`
              : overlay === "rotation" && cd.rotationStatus != null
              ? (cd.rotationStatus === "grazing" || cd.rotationStatus === "overstayed")
                ? `${cd.rotationDays ?? 0}d grazed`
                : cd.rotationDays != null
                ? `${cd.rotationDays}d rested`
                : cd.rotationStatus
              : overlay === "veld_condition" && cd.veldScore != null
              ? `${cd.veldScore.toFixed(1)}/10`
              : overlay === "feed_on_offer" && cd.feedOnOfferKgDmPerHa != null
              ? `${Math.round(cd.feedOnOfferKgDmPerHa)} kg/ha`
              : `${stats.total} head`,
          color: getOverlayColor(overlay, cd),
          borderColor: identityColor,
        },
      });
    } catch {
      // skip malformed geojson
    }
  }

  return { type: "FeatureCollection", features };
}
