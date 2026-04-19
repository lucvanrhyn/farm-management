"use client";

/**
 * useLongPress — wires a Mapbox container for desktop right-click (contextmenu)
 * and mobile 600ms touch-hold events. Fires `onLongPress` with the lngLat at
 * the gesture point.
 *
 * Used by FarmMap to emit a stub long-press signal that Wave 3E attaches a
 * Create-Task sheet to.
 */

import { useEffect } from "react";
import type { MapRef } from "react-map-gl/mapbox";

const LONG_PRESS_MS = 600;

export function useLongPress(
  mapRef: React.RefObject<MapRef | null>,
  onLongPress?: (p: { lng: number; lat: number }) => void
) {
  useEffect(() => {
    if (!onLongPress) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const container = map.getContainer();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startLngLat: { lng: number; lat: number } | null = null;

    const clearTimer = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      startLngLat = null;
    };

    const handleContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      const rect = container.getBoundingClientRect();
      const point: [number, number] = [ev.clientX - rect.left, ev.clientY - rect.top];
      const lngLat = map.unproject(point);
      onLongPress({ lng: lngLat.lng, lat: lngLat.lat });
    };

    const handleTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length !== 1) return;
      const touch = ev.touches[0];
      const rect = container.getBoundingClientRect();
      const point: [number, number] = [touch.clientX - rect.left, touch.clientY - rect.top];
      const lngLat = map.unproject(point);
      startLngLat = { lng: lngLat.lng, lat: lngLat.lat };
      timer = setTimeout(() => {
        if (startLngLat) onLongPress(startLngLat);
        timer = null;
      }, LONG_PRESS_MS);
    };

    container.addEventListener("contextmenu", handleContextMenu);
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", clearTimer);
    container.addEventListener("touchmove", clearTimer);
    container.addEventListener("touchcancel", clearTimer);

    return () => {
      clearTimer();
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", clearTimer);
      container.removeEventListener("touchmove", clearTimer);
      container.removeEventListener("touchcancel", clearTimer);
    };
  }, [mapRef, onLongPress]);
}
