"use client";

/**
 * InfrastructureLayer — renders farm infrastructure: fences (lines), gates,
 * buildings, roads (lines).
 *
 * Fetch: GET /api/{farmSlug}/map/infrastructure
 * Source shape: { infrastructure: FeatureCollection | Array<Feature> }
 *
 * The endpoint may return either a raw FeatureCollection or an envelope. We
 * accept both and render lines + points in separate layers.
 */

import { useEffect, useState } from "react";
import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";
import { fetchLayerJson, EMPTY_FC, type FetchState } from "./_utils";

interface InfraPayload {
  infrastructure?: GeoJSON.FeatureCollection | GeoJSON.Feature[];
}

interface Props {
  farmSlug: string;
}

const lineLayer: LayerProps = {
  id: "infrastructure-line-layer",
  type: "line",
  filter: ["in", "$type", "LineString"],
  paint: {
    "line-color": [
      "match",
      ["get", "kind"],
      "fence", "#a3a3a3",
      "road",  "#fbbf24",
      "#8b5cf6",
    ],
    "line-width": 2,
    "line-opacity": 0.85,
  },
};

const pointLayer: LayerProps = {
  id: "infrastructure-point-layer",
  type: "circle",
  filter: ["in", "$type", "Point"],
  paint: {
    "circle-radius": 5,
    "circle-color": [
      "match",
      ["get", "kind"],
      "gate",     "#fbbf24",
      "building", "#8b5cf6",
      "#64748b",
    ],
    "circle-stroke-color": "#1A1510",
    "circle-stroke-width": 1.5,
  },
};

function normalise(payload: InfraPayload | null): GeoJSON.FeatureCollection {
  if (!payload) return EMPTY_FC;
  const raw = payload.infrastructure;
  if (!raw) return EMPTY_FC;
  if (Array.isArray(raw)) return { type: "FeatureCollection", features: raw };
  if (raw.type === "FeatureCollection") return raw;
  return EMPTY_FC;
}

export default function InfrastructureLayer({ farmSlug }: Props) {
  const fetchUrl = `/api/${encodeURIComponent(farmSlug)}/map/infrastructure`;
  const [result, setResult] = useState<{ url: string; state: FetchState<InfraPayload> } | null>(null);

  const state: FetchState<InfraPayload> =
    result?.url === fetchUrl ? result.state : { status: "loading" };

  useEffect(() => {
    const ctrl = new AbortController();
    const url = fetchUrl;
    fetchLayerJson<InfraPayload>(url, { signal: ctrl.signal }).then((r) => {
      if (!r) return; // aborted
      setResult({ url, state: r });
    });
    return () => ctrl.abort();
  }, [fetchUrl]);

  if (state.status !== "ready") return null;

  const fc = normalise(state.data);
  if (fc.features.length === 0) return null;

  return (
    <Source id="infrastructure-source" type="geojson" data={fc}>
      <Layer {...lineLayer} />
      <Layer {...pointLayer} />
    </Source>
  );
}
