"use client";

/**
 * DrawControl — thin wrapper around Mapbox GL Draw that uses react-map-gl's
 * `useControl` hook to mount/unmount the draw instance cleanly. Extracted
 * from FarmMap to keep the shell ≤ 400 LOC.
 */

import { useEffect, useRef } from "react";
import { useControl } from "react-map-gl/mapbox";
import MapboxDraw from "@mapbox/mapbox-gl-draw";

interface DrawControlProps {
  onDrawCreate: (e: { features: GeoJSON.Feature[] }) => void;
  onDrawDelete: () => void;
  enabled: boolean;
}

export default function DrawControl({ onDrawCreate, onDrawDelete, enabled }: DrawControlProps) {
  const drawRef = useRef<MapboxDraw | null>(null);

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
      map.off("draw.create", onDrawCreate);
      map.off("draw.delete", onDrawDelete);
    },
    { position: "top-left" }
  );

  useEffect(() => {
    if (!drawRef.current) return;
    if (enabled) {
      drawRef.current.changeMode("draw_polygon");
    } else {
      drawRef.current.changeMode("simple_select");
    }
  }, [enabled]);

  return null;
}
