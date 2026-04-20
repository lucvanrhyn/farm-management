"use client";

/**
 * TaskPinLayer — renders farm tasks as priority-colored pins.
 *
 * Fetch: GET /api/{farmSlug}/map/task-pins?status={statusFilter}
 * Source shape: { tasks: Array<{ id, title, priority, status, lat?, lng?, campId? }> }
 *
 * Rendering rules:
 *  - If task has lat && lng → use them.
 *  - Else if task has campId and the camp's GeoJSON is available → centroid.
 *  - Else → skip the task (no pin).
 */

import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";
import type { Camp } from "@/lib/types";
import { useLayerFetch, buildCampCentroidMap, EMPTY_FC } from "./_utils";

interface TaskPin {
  id: string;
  title: string;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: string;
  lat?: number;
  lng?: number;
  campId?: string;
}

interface TaskPinsPayload {
  tasks: TaskPin[];
}

interface Props {
  farmSlug: string;
  camps: Camp[];
  statusFilter?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#dc2626",
  high:   "#f97316",
  medium: "#eab308",
  low:    "#3b82f6",
};

const circleLayer: LayerProps = {
  id: "task-pins-layer",
  type: "circle",
  paint: {
    "circle-radius": 7,
    "circle-color": ["get", "color"],
    "circle-stroke-color": "#1A1510",
    "circle-stroke-width": 2,
  },
};

const labelLayer: LayerProps = {
  id: "task-pins-label",
  type: "symbol",
  layout: {
    "text-field": ["get", "title"],
    "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
    "text-size": 11,
    "text-offset": [0, 1.2],
    "text-anchor": "top",
    "text-optional": true,
    "text-allow-overlap": false,
  },
  paint: {
    "text-color": "#F5EBD4",
    "text-halo-color": "rgba(0,0,0,0.75)",
    "text-halo-width": 1.2,
  },
};

export default function TaskPinLayer({ farmSlug, camps, statusFilter }: Props) {
  const url = statusFilter
    ? `/api/${encodeURIComponent(farmSlug)}/map/task-pins?status=${encodeURIComponent(statusFilter)}`
    : `/api/${encodeURIComponent(farmSlug)}/map/task-pins`;
  const state = useLayerFetch<TaskPinsPayload>(url);

  if (state.status !== "ready") return null;

  const centroidMap = buildCampCentroidMap(camps);
  const features: GeoJSON.Feature[] = [];

  for (const t of state.data.tasks ?? []) {
    let lng: number | null = null;
    let lat: number | null = null;
    if (typeof t.lng === "number" && typeof t.lat === "number") {
      lng = t.lng;
      lat = t.lat;
    } else if (t.campId && centroidMap[t.campId]) {
      lng = centroidMap[t.campId].lng;
      lat = centroidMap[t.campId].lat;
    }
    if (lng == null || lat == null) continue;

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        id: t.id,
        title: t.title,
        priority: t.priority ?? "medium",
        color: PRIORITY_COLORS[t.priority ?? "medium"] ?? PRIORITY_COLORS.medium,
      },
    });
  }

  const data: GeoJSON.FeatureCollection =
    features.length === 0 ? EMPTY_FC : { type: "FeatureCollection", features };

  return (
    <Source id="task-pins-source" type="geojson" data={data}>
      <Layer {...circleLayer} />
      <Layer {...labelLayer} />
    </Source>
  );
}
