"use client";

/**
 * WaterPointLayer — renders boreholes, troughs, dams, and reservoirs.
 *
 * Fetch: GET /api/{farmSlug}/map/water-points
 * Source shape: { waterPoints: Array<{ id, name?, kind, lat, lng, status? }> }
 */

import { useEffect, useState } from "react";
import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";
import { fetchLayerJson, EMPTY_FC, type FetchState } from "./_utils";

interface WaterPoint {
  id: string;
  name?: string;
  kind?: "borehole" | "trough" | "dam" | "reservoir" | string;
  lat: number;
  lng: number;
  status?: "ok" | "low" | "dry" | string;
}

interface WaterPointsPayload {
  waterPoints: WaterPoint[];
}

interface Props {
  farmSlug: string;
}

const STATUS_COLORS: Record<string, string> = {
  ok:  "#22c55e",
  low: "#eab308",
  dry: "#ef4444",
};

const circleLayer: LayerProps = {
  id: "water-points-layer",
  type: "circle",
  paint: {
    "circle-radius": 6,
    "circle-color": ["get", "color"],
    "circle-stroke-color": "#0c4a6e",
    "circle-stroke-width": 2,
  },
};

const labelLayer: LayerProps = {
  id: "water-points-label",
  type: "symbol",
  layout: {
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
    "text-size": 10,
    "text-offset": [0, 1.1],
    "text-anchor": "top",
    "text-optional": true,
  },
  paint: {
    "text-color": "#F5EBD4",
    "text-halo-color": "rgba(0,0,0,0.75)",
    "text-halo-width": 1.2,
  },
};

export default function WaterPointLayer({ farmSlug }: Props) {
  const fetchUrl = `/api/${encodeURIComponent(farmSlug)}/map/water-points`;
  const [result, setResult] = useState<{ url: string; state: FetchState<WaterPointsPayload> } | null>(null);

  const state: FetchState<WaterPointsPayload> =
    result?.url === fetchUrl ? result.state : { status: "loading" };

  useEffect(() => {
    const ctrl = new AbortController();
    const url = fetchUrl;
    fetchLayerJson<WaterPointsPayload>(url, { signal: ctrl.signal }).then((r) => {
      if (!r) return; // aborted
      setResult({ url, state: r });
    });
    return () => ctrl.abort();
  }, [fetchUrl]);

  if (state.status !== "ready") return null;

  const features: GeoJSON.Feature[] = [];
  for (const w of state.data.waterPoints ?? []) {
    if (typeof w.lng !== "number" || typeof w.lat !== "number") continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [w.lng, w.lat] },
      properties: {
        id: w.id,
        name: w.name ?? w.kind ?? "Water",
        kind: w.kind ?? "unknown",
        status: w.status ?? "ok",
        color: STATUS_COLORS[w.status ?? "ok"] ?? "#38bdf8",
      },
    });
  }

  const data: GeoJSON.FeatureCollection =
    features.length === 0 ? EMPTY_FC : { type: "FeatureCollection", features };

  return (
    <Source id="water-points-source" type="geojson" data={data}>
      <Layer {...circleLayer} />
      <Layer {...labelLayer} />
    </Source>
  );
}
