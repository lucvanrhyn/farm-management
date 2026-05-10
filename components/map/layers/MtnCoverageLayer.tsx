"use client";

/**
 * MtnCoverageLayer — renders MTN network coverage as a raster tile overlay.
 *
 * Wave 2D stub: if no real tile URL is configured (env var NEXT_PUBLIC_MTN_TILES_URL),
 * we render a checkerboard placeholder raster using an inline PNG data URL so
 * the wiring is visible in dev without a real upstream.
 *
 * Real tile URL when available: an XYZ template like
 *   https://example.com/mtn/{z}/{x}/{y}.png
 *
 * IMPORTANT — PNG, not SVG. Mapbox GL JS raster sources only decode
 * PNG/JPG/WebP; SVG data URLs throw "The source image could not be decoded…
 * SVGs are not supported" once per tile request, polluting the console (141
 * errors per page in production triage P2.1, wave/181) and silently leaving
 * the layer blank. We therefore inline a tiny pre-rasterized 32×32 checker
 * PNG (114 bytes; 16×16 amber squares at 12% alpha — visually equivalent
 * to the prior SVG, just decoded by Mapbox).
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
 * Inline 32×32 PNG checkerboard (16×16 squares, semi-transparent amber
 * `rgba(255,200,50,0.12)` matching the prior SVG palette). 114 bytes.
 *
 * Mapbox tiles the source at `tileSize: 256`, so this small image is repeated
 * 8×8 across each tile — the Mapbox GPU sampler does the tiling for us, no
 * additional cost vs. a full-tile pattern.
 */
export const PLACEHOLDER_TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOUlEQVR4nO3PQQ0AMAwDsTIph/EHMFYbiDyqSo50f6fePZ1U6QAAAAAAAADGAesPAAAAAAAAAKSAD0DYMD1BRy8uAAAAAElFTkSuQmCC";

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
  // a data URL ignores those and returns the same PNG every time.
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
