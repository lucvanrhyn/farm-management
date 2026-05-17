"use client";

/**
 * DrawControl — thin wrapper around Mapbox GL Draw that uses react-map-gl's
 * `useControl` hook to mount/unmount the draw instance cleanly. Extracted
 * from FarmMap to keep the shell ≤ 400 LOC.
 *
 * Mode is set ONCE via the MapboxDraw constructor's `defaultMode`, which
 * mapbox-gl-draw applies internally *after* react-map-gl has attached the
 * control and wired its store/context. We deliberately do NOT drive
 * `draw.changeMode()` from a React effect: such an effect is not
 * synchronised with the `useControl` attach lifecycle, so it can run while
 * the draw instance's internal context is still undefined and throw
 * "Cannot read properties of undefined (reading 'changeMode')", taking the
 * whole map down via the error boundary. DrawControl is mounted only while
 * the user is drawing (`enabled` is true for the entire mounted lifetime)
 * and unmounted when drawing stops, so `defaultMode` alone is correct and
 * race-free — no post-mount mode switching is ever required.
 */

import { useControl } from "react-map-gl/mapbox";
import MapboxDraw from "@mapbox/mapbox-gl-draw";

interface DrawControlProps {
  onDrawCreate: (e: { features: GeoJSON.Feature[] }) => void;
  onDrawDelete: () => void;
  enabled: boolean;
}

export default function DrawControl({ onDrawCreate, onDrawDelete, enabled }: DrawControlProps) {
  useControl(
    () =>
      new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: enabled ? "draw_polygon" : "simple_select",
      }),
    ({ map }) => {
      map.on("draw.create", onDrawCreate);
      map.on("draw.delete", onDrawDelete);
    },
    ({ map }) => {
      map.off("draw.create", onDrawCreate);
      map.off("draw.delete", onDrawDelete);
    },
    { position: "top-left" }
  );

  return null;
}
