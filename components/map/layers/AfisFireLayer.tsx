"use client";

/**
 * AfisFireLayer — renders active fires from the AFIS feed.
 *
 * Fetch: GET /api/map/gis/afis?bbox={minLng,minLat,maxLng,maxLat}
 * Source shape: { fires: FeatureCollection } | FeatureCollection
 * Envelope may include `_stale: true` when the upstream feed is degraded; we
 * surface a small "stale" badge in the layer's caller (via onStale callback).
 *
 * We render both polygon/MultiPolygon fires (as red fills) and point fires
 * (as red circles).
 */

import { useEffect, useState } from "react";
import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";
import { fetchLayerJson, EMPTY_FC, type FetchState } from "./_utils";

interface AfisPayload {
  fires?: GeoJSON.FeatureCollection | GeoJSON.Feature[];
  _stale?: boolean;
}

interface Props {
  /** Optional bbox `[minLng, minLat, maxLng, maxLat]` to constrain the feed. */
  bbox?: [number, number, number, number] | null;
  onStaleChange?: (isStale: boolean) => void;
}

const fillLayer: LayerProps = {
  id: "afis-fire-fill-layer",
  type: "fill",
  filter: ["in", "$type", "Polygon"],
  paint: {
    "fill-color": "#ef4444",
    "fill-opacity": 0.35,
  },
};

const pointLayer: LayerProps = {
  id: "afis-fire-point-layer",
  type: "circle",
  filter: ["in", "$type", "Point"],
  paint: {
    "circle-radius": 7,
    "circle-color": "#ef4444",
    "circle-stroke-color": "#fff5f5",
    "circle-stroke-width": 1.5,
    "circle-opacity": 0.85,
  },
};

function normalise(payload: AfisPayload | null): GeoJSON.FeatureCollection {
  if (!payload) return EMPTY_FC;
  const raw = payload.fires;
  if (!raw) return EMPTY_FC;
  if (Array.isArray(raw)) return { type: "FeatureCollection", features: raw };
  if (raw.type === "FeatureCollection") return raw;
  return EMPTY_FC;
}

export default function AfisFireLayer({ bbox, onStaleChange }: Props) {
  // Layer state keyed by request URL. Loading is derived in render from whether
  // the result is for the current key — no synchronous setState in the effect body.
  const qs = bbox ? `?bbox=${bbox.join(",")}` : "";
  const fetchUrl = `/api/map/gis/afis${qs}`;
  const [result, setResult] = useState<{ url: string; state: FetchState<AfisPayload> } | null>(null);

  // Derived: show as loading when we haven't settled for the current URL yet.
  const state: FetchState<AfisPayload> =
    result?.url === fetchUrl ? result.state : { status: "loading" };

  useEffect(() => {
    const ctrl = new AbortController();
    const url = fetchUrl;
    fetchLayerJson<AfisPayload>(url, { signal: ctrl.signal }).then((r) => {
      if (!r) return; // aborted
      setResult({ url, state: r });
      if (r.status === "ready" && onStaleChange) onStaleChange(Boolean(r.stale));
    });
    return () => ctrl.abort();
  }, [fetchUrl, onStaleChange]);

  if (state.status !== "ready") return null;
  const fc = normalise(state.data);
  if (fc.features.length === 0) return null;

  return (
    <Source id="afis-fire-source" type="geojson" data={fc}>
      <Layer {...fillLayer} />
      <Layer {...pointLayer} />
    </Source>
  );
}
