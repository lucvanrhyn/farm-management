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
 *
 * Issue #458 — cancelling a draw (DrawControl unmounts) must hand the draw
 * instance back to `simple_select` BEFORE detaching listeners. Without it the
 * control is torn down while still in `draw_polygon`, so its DOM affordance
 * (highlighted polygon/trash button, draw-mode cursor) lingers active on the
 * map. We do this inside the `useControl` cleanup (`onRemove`) — NOT a React
 * effect — because the control is still attached at that moment, so the draw
 * instance's internal context is defined and `changeMode` is safe. A
 * defensive guard tolerates the instance/context already being gone.
 */

import { useRef } from "react";
import { useControl } from "react-map-gl/mapbox";
import MapboxDraw from "@mapbox/mapbox-gl-draw";

interface DrawControlProps {
  onDrawCreate: (e: { features: GeoJSON.Feature[] }) => void;
  onDrawDelete: () => void;
  enabled: boolean;
}

export default function DrawControl({ onDrawCreate, onDrawDelete, enabled }: DrawControlProps) {
  // Captured from the factory so the cleanup callback can reset the draw
  // instance's mode while the control is still attached (see header comment).
  // A ref (not a render-local let) so the React Compiler's immutability rule
  // is satisfied and the reference survives to the unmount cleanup.
  const drawRef = useRef<MapboxDraw | undefined>(undefined);

  useControl(
    () => {
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: enabled ? "draw_polygon" : "simple_select",
      });
      drawRef.current = draw;
      return draw;
    },
    ({ map }) => {
      map.on("draw.create", onDrawCreate);
      map.on("draw.delete", onDrawDelete);
    },
    ({ map }) => {
      // Hand the draw instance back to simple_select BEFORE detaching, so the
      // affordance is cleared while the control is still attached (its
      // internal context is defined here, unlike in a stray React effect).
      // Guard defensively in case the instance/context was already torn down.
      try {
        drawRef.current?.changeMode("simple_select");
      } catch {
        // Instance already disposed — nothing to reset.
      }
      map.off("draw.create", onDrawCreate);
      map.off("draw.delete", onDrawDelete);
    },
    { position: "top-left" }
  );

  return null;
}
