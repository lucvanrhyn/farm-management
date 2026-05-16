"use client";

/**
 * MtnCoverageLayer — renders MTN network coverage as a raster tile overlay.
 *
 * Tile source: a real XYZ template configured via env var
 * NEXT_PUBLIC_MTN_TILES_URL, e.g.
 *   https://example.com/mtn/{z}/{x}/{y}.png
 *
 * No real tile-source URL configured (`NEXT_PUBLIC_MTN_TILES_URL` unset)?
 * The component renders `null`. It used to mount the raster <Source> with an
 * inline `data:image/png;base64,...` placeholder PNG so the wiring was
 * "visible" in dev, but Mapbox treats the data-URI as an XYZ tile template
 * and fires one (failed) fetch per tile per redraw — flooding the
 * console/network during map use, pan/zoom and draw mode (issue #284). The
 * missing-data state is communicated through the LayerToggle "unavailable"
 * affordance instead (see `MTN_COVERAGE_AVAILABLE` below), so there is
 * nothing useful to render.
 *
 * `PLACEHOLDER_TILE` is retained as an exported constant (and regression-
 * tested) so the PNG-not-SVG contract from production triage P2.1
 * (wave/181 — Mapbox raster sources cannot decode SVG data URLs) stays
 * locked even though the placeholder is no longer mounted as a tile source.
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
  // No real upstream tile source configured? Render nothing.
  //
  // We used to mount the raster <Source> with a `data:image/png;base64,...`
  // placeholder so the wiring was "visible" in dev. But Mapbox treats the
  // data-URI as an XYZ tile template and issues one (failed) fetch per tile
  // per redraw — flooding the console/network during map use, pan/zoom and
  // draw mode (issue #284). The missing-data state is already communicated
  // via the LayerToggle "unavailable" affordance (MTN_COVERAGE_AVAILABLE
  // === false), so there is nothing useful to render here.
  if (!MTN_TILES_URL) return null;

  // Real XYZ template configured — render the raster overlay normally.
  return (
    <Source
      id="mtn-coverage-source"
      type="raster"
      tiles={[MTN_TILES_URL]}
      tileSize={256}
    >
      <Layer {...rasterLayer} />
    </Source>
  );
}

/** Exported so LayerToggle can surface an "Unavailable" badge when the real
 *  tile URL is not configured. */
export const MTN_COVERAGE_AVAILABLE: boolean = Boolean(MTN_TILES_URL);
