"use client";

/**
 * RainfallGaugeLayer — renders manual + auto rainfall gauges with 24h totals.
 *
 * Fetch: GET /api/{farmSlug}/map/rainfall-gauges
 * Source shape: { gauges: Array<{ id, name, lat, lng, mm24h?, mm7d? }> }
 */

import { useEffect, useState } from "react";
import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";
import { fetchLayerJson, EMPTY_FC, type FetchState } from "./_utils";

interface Gauge {
  id: string;
  name?: string;
  lat: number;
  lng: number;
  mm24h?: number;
  mm7d?: number;
}

interface GaugesPayload {
  gauges: Gauge[];
}

interface Props {
  farmSlug: string;
}

const circleLayer: LayerProps = {
  id: "rainfall-gauges-layer",
  type: "circle",
  paint: {
    "circle-radius": 6,
    "circle-color": "#0ea5e9",
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2,
    "circle-opacity": 0.9,
  },
};

const labelLayer: LayerProps = {
  id: "rainfall-gauges-label",
  type: "symbol",
  layout: {
    "text-field": ["get", "label"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": 11,
    "text-offset": [0, 1.2],
    "text-anchor": "top",
  },
  paint: {
    "text-color": "#F5EBD4",
    "text-halo-color": "rgba(0,0,0,0.8)",
    "text-halo-width": 1.4,
  },
};

export default function RainfallGaugeLayer({ farmSlug }: Props) {
  const fetchUrl = `/api/${encodeURIComponent(farmSlug)}/map/rainfall-gauges`;
  const [result, setResult] = useState<{ url: string; state: FetchState<GaugesPayload> } | null>(null);

  const state: FetchState<GaugesPayload> =
    result?.url === fetchUrl ? result.state : { status: "loading" };

  useEffect(() => {
    const ctrl = new AbortController();
    const url = fetchUrl;
    fetchLayerJson<GaugesPayload>(url, { signal: ctrl.signal }).then((r) => {
      if (!r) return; // aborted
      setResult({ url, state: r });
    });
    return () => ctrl.abort();
  }, [fetchUrl]);

  if (state.status !== "ready") return null;

  const features: GeoJSON.Feature[] = [];
  for (const g of state.data.gauges ?? []) {
    if (typeof g.lng !== "number" || typeof g.lat !== "number") continue;
    const mm = g.mm24h;
    const label = mm != null ? `${mm.toFixed(1)} mm` : (g.name ?? "Gauge");
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.lng, g.lat] },
      properties: {
        id: g.id,
        name: g.name ?? "Gauge",
        mm24h: mm ?? null,
        label,
      },
    });
  }

  const data: GeoJSON.FeatureCollection =
    features.length === 0 ? EMPTY_FC : { type: "FeatureCollection", features };

  return (
    <Source id="rainfall-gauges-source" type="geojson" data={data}>
      <Layer {...circleLayer} />
      <Layer {...labelLayer} />
    </Source>
  );
}
