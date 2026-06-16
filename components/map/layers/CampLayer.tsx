"use client";

/**
 * CampLayer — renders the farm's camp polygons with one of 8 overlay color
 * modes: grazing, water, density, inspection, census, rotation, veld_condition,
 * feed_on_offer.
 *
 * Color ramps and GeoJSON assembly live in `_camp-colors.ts` (pure helpers);
 * this component is just the Mapbox mount + click-payload extractor.
 *
 * Unmount is handled by react-map-gl: when the `<Source>` unmounts, Mapbox's
 * addSource/removeSource + addLayer/removeLayer are invoked automatically.
 */

import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";
import type { MapMouseEvent } from "mapbox-gl";
import { buildCampGeoJSON, type CampData, type OverlayMode } from "./_camp-colors";

export type { CampData, OverlayMode } from "./_camp-colors";

// ── Layer styles ──────────────────────────────────────────────────────────────

const fillLayer: LayerProps = {
  id: "camp-fill",
  type: "fill",
  paint: {
    "fill-color": ["get", "color"],
    "fill-opacity": 0.35,
  },
};

const outlineLayer: LayerProps = {
  id: "camp-outline",
  type: "line",
  paint: {
    "line-color": ["get", "borderColor"],
    "line-width": 3,
    "line-opacity": 0.9,
  },
};

// Camp labels read as dark "pills" floating over the satellite map. Mapbox
// symbol layers can't paint a true rounded background behind text, so the pill
// look is approximated with a strong, wide dark text-halo (the overhaul dark
// chrome ink `#14110D` at full opacity) — the halo bleeds into a soft slab
// around the glyphs, matching the reference's pill labels while keeping the
// fill-by-status polygon ramp untouched.
const labelLayer: LayerProps = {
  id: "camp-label",
  type: "symbol",
  layout: {
    "text-field": [
      "format",
      ["get", "campName"], { "font-scale": 1.0, "text-font": ["literal", ["Open Sans Bold", "Arial Unicode MS Bold"]] },
      "\n", {},
      ["get", "labelSubtext"], { "font-scale": 0.72, "text-font": ["literal", ["Open Sans Regular", "Arial Unicode MS Regular"]] },
    ] as unknown as string,
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": 12.5,
    "text-anchor": "center",
    "text-allow-overlap": false,
    "text-line-height": 1.45,
    "text-padding": 6,
  },
  paint: {
    "text-color": "#F5EBD4",
    // Wide, near-opaque dark halo → reads as a dark pill slab behind the text.
    "text-halo-color": "rgba(20,17,13,0.92)",
    "text-halo-width": 2.4,
    "text-halo-blur": 0.6,
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface CampLayerProps {
  campData: CampData[];
  overlayMode: OverlayMode;
  /** Camp ID to highlight with an amber glow (move-mode source). */
  highlightedCampId?: string | null;
}

export default function CampLayer({ campData, overlayMode, highlightedCampId }: CampLayerProps) {
  const geojsonData = buildCampGeoJSON(campData, overlayMode);
  if (geojsonData.features.length === 0) return null;

  return (
    <Source id="camps" type="geojson" data={geojsonData}>
      <Layer {...fillLayer} />
      <Layer {...outlineLayer} />
      {highlightedCampId && (
        <Layer
          id="move-source-outline"
          type="line"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter={["==", ["get", "campId"], highlightedCampId] as any}
          paint={{
            "line-color": "#C49030",
            "line-width": 4,
            "line-opacity": 0.9,
          }}
        />
      )}
      <Layer {...labelLayer} />
    </Source>
  );
}

// ── Click payload extractor (used by FarmMap's onClick handler) ──────────────

export function extractCampClickPayload(e: MapMouseEvent) {
  const features = e.features;
  if (!features || features.length === 0) return null;
  const feature = features[0];
  const props = feature.properties;
  if (!props) return null;

  const geometry = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  let lng = e.lngLat.lng;
  let lat = e.lngLat.lat;

  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates[0];
    if (coords && coords.length > 0) {
      const sumLng = coords.reduce((s, c) => s + (c[0] ?? 0), 0);
      const sumLat = coords.reduce((s, c) => s + (c[1] ?? 0), 0);
      lng = sumLng / coords.length;
      lat = sumLat / coords.length;
    }
  }

  const sizeRaw = Number(props.sizeHectares);
  const daysRaw = Number(props.daysSinceInspection);

  return {
    campId: String(props.campId),
    campName: String(props.campName),
    grazing: String(props.grazing),
    animalCount: Number(props.animalCount),
    sizeHectares: sizeRaw >= 0 ? sizeRaw : null,
    waterStatus: String(props.waterStatus ?? "Unknown"),
    fenceStatus: String(props.fenceStatus ?? "Unknown"),
    daysSinceInspection: daysRaw >= 0 ? daysRaw : null,
    longitude: lng,
    latitude: lat,
  };
}
