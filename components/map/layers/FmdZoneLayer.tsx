"use client";

/**
 * FmdZoneLayer — renders the SA foot-and-mouth disease red-line as a thick
 * red stroke with no fill.
 *
 * Fetch: GET /api/map/gis/fmd-zones
 * Source shape: { zones: FeatureCollection } | FeatureCollection
 */

import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";
import { useLayerFetch, EMPTY_FC } from "./_utils";

interface FmdPayload {
  zones?: GeoJSON.FeatureCollection | GeoJSON.Feature[];
}

const outlineLayer: LayerProps = {
  id: "fmd-zone-outline-layer",
  type: "line",
  paint: {
    "line-color": "#b91c1c",
    "line-width": 3,
    "line-opacity": 0.85,
    "line-dasharray": [2, 1],
  },
};

function normalise(payload: FmdPayload | null): GeoJSON.FeatureCollection {
  if (!payload) return EMPTY_FC;
  const raw = payload.zones;
  if (!raw) return EMPTY_FC;
  if (Array.isArray(raw)) return { type: "FeatureCollection", features: raw };
  if (raw.type === "FeatureCollection") return raw;
  return EMPTY_FC;
}

export default function FmdZoneLayer() {
  const state = useLayerFetch<FmdPayload>("/api/map/gis/fmd-zones");

  if (state.status !== "ready") return null;
  const fc = normalise(state.data);
  if (fc.features.length === 0) return null;

  return (
    <Source id="fmd-zone-source" type="geojson" data={fc}>
      <Layer {...outlineLayer} />
    </Source>
  );
}
