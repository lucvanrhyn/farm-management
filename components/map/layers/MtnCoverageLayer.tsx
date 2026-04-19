"use client";

/**
 * MtnCoverageLayer — renders MTN network coverage as a raster tile overlay.
 *
 * Wave 2D stub: if no real tile URL is configured (env var NEXT_PUBLIC_MTN_TILES_URL),
 * we render a checkerboard placeholder raster using an inline SVG data URL so
 * the wiring is visible in dev without a real upstream.
 *
 * Real tile URL when available: an XYZ template like
 *   https://example.com/mtn/{z}/{x}/{y}.png
 *
 * Fail-gracefully contract: if the placeholder is in use, we also render a
 * small note inside the layer's footprint (via a separate notice element that
 * the shell positions — but since we can't overlay arbitrary DOM on a Mapbox
 * raster source, the "Coverage data unavailable" copy is surfaced through the
 * layer's description in the LayerToggle panel instead).
 */

import { Source, Layer, type LayerProps } from "react-map-gl/mapbox";

const MTN_TILES_URL = process.env.NEXT_PUBLIC_MTN_TILES_URL ?? "";

/**
 * Inline SVG checkerboard (256×256, semi-transparent) encoded as a data URL.
 * Mapbox's raster source accepts any image URL template; we substitute a
 * constant tile so every tile request returns the same placeholder image.
 */
const PLACEHOLDER_TILE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
      <defs>
        <pattern id="c" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="rgba(255,200,50,0.12)" />
          <rect x="16" y="16" width="16" height="16" fill="rgba(255,200,50,0.12)" />
        </pattern>
      </defs>
      <rect width="256" height="256" fill="url(#c)" />
    </svg>`
  );

const rasterLayer: LayerProps = {
  id: "mtn-coverage-layer",
  type: "raster",
  paint: {
    "raster-opacity": 0.55,
  },
};

export default function MtnCoverageLayer() {
  // Prefer the real XYZ template if available. Otherwise use a static
  // placeholder — Mapbox will request `{z}/{x}/{y}` against the template, but
  // a data URL ignores those and returns the same SVG every time.
  const tileTemplate = MTN_TILES_URL || PLACEHOLDER_TILE;

  return (
    <Source
      id="mtn-coverage-source"
      type="raster"
      tiles={[tileTemplate]}
      tileSize={256}
    >
      <Layer {...rasterLayer} />
    </Source>
  );
}

/** Exported so LayerToggle can surface an "Unavailable" badge when the real
 *  tile URL is not configured. */
export const MTN_COVERAGE_AVAILABLE: boolean = Boolean(MTN_TILES_URL);
