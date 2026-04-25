"use client";

/**
 * FmdZoneLayer — renders the SA foot-and-mouth disease red-line as a thick
 * red stroke with no fill.
 *
 * Fetch: GET /api/map/gis/fmd-zones
 * Source shape: { zones: FeatureCollection } | FeatureCollection
 */

import { useEffect, useState } from "react";
import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";
import { fetchLayerJson, EMPTY_FC, type FetchState } from "./_utils";

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

const FMD_URL = "/api/map/gis/fmd-zones";

export default function FmdZoneLayer() {
  const [result, setResult] = useState<FetchState<FmdPayload> | null>(null);

  // Derived: show loading until we have a result (fetch fires once on mount).
  const state: FetchState<FmdPayload> = result ?? { status: "loading" };

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLayerJson<FmdPayload>(FMD_URL, { signal: ctrl.signal }).then((r) => {
      if (!r) return; // aborted
      setResult(r);
    });
    return () => ctrl.abort();
  }, []);

  if (state.status !== "ready") return null;
  const fc = normalise(state.data);
  if (fc.features.length === 0) return null;

  return (
    <Source id="fmd-zone-source" type="geojson" data={fc}>
      <Layer {...outlineLayer} />
    </Source>
  );
}
