"use client";

/**
 * RouteTodayMap — client map that renders today's route as an ordered polyline
 * through sequence-numbered pins, on top of the farm's camp polygons.
 *
 * Scope (Wave 3E):
 *   - Mounts its own Mapbox map (Wave 2D's FarmMap shell has no `children`
 *     prop, and the plan forbids modifying the shell). We reuse CampLayer
 *     for the camp polygon overlay so behaviour stays consistent.
 *   - Renders the NN tour as a thick sky-blue LineString.
 *   - Renders each pin as a large circle with its sequence number.
 *   - Click a pin → inline side-panel with task summary and a deep-link
 *     to `/admin/tasks` (no TaskDetail modal exists in the codebase).
 *   - Empty state when pins.length === 0 is handled by the parent page.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Map, {
  NavigationControl,
  ScaleControl,
  Source,
  Layer,
  type MapRef,
  type LayerProps,
} from "react-map-gl/mapbox";
import type { MapMouseEvent } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import CampLayer, { type CampData } from "./layers/CampLayer";
import type { RouteTodayPin } from "@/lib/tasks/route-today";
import type { Feature, LineString } from "geojson";

interface Props {
  farmSlug: string;
  campData: CampData[];
  pins: RouteTodayPin[];
  tour: Feature<LineString, { pinCount: number }>;
  farmLat: number | null;
  farmLng: number | null;
}

// ── Layer styles ─────────────────────────────────────────────────────────────

const tourLineLayer: LayerProps = {
  id: "route-today-tour",
  type: "line",
  paint: {
    "line-color": "#0ea5e9",
    "line-width": 4,
    "line-opacity": 0.85,
  },
};

const pinCircleLayer: LayerProps = {
  id: "route-today-pins",
  type: "circle",
  paint: {
    "circle-radius": 14,
    "circle-color": "#0ea5e9",
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2,
  },
};

const pinLabelLayer: LayerProps = {
  id: "route-today-pins-label",
  type: "symbol",
  layout: {
    "text-field": ["get", "seq"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": 14,
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  },
  paint: {
    "text-color": "#ffffff",
  },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function RouteTodayMap({
  farmSlug,
  campData,
  pins,
  tour,
  farmLat,
  farmLng,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const pinFC = useMemo(
    () => ({ type: "FeatureCollection" as const, features: pins }),
    [pins],
  );
  const tourFC = useMemo(
    () => ({ type: "FeatureCollection" as const, features: [tour] }),
    [tour],
  );

  const selectedPin = useMemo(
    () => pins.find((p) => p.properties.taskId === selectedTaskId) ?? null,
    [pins, selectedTaskId],
  );

  const initialCentre = {
    lng: farmLng ?? pins[0]?.geometry.coordinates[0] ?? 28.5,
    lat: farmLat ?? pins[0]?.geometry.coordinates[1] ?? -25.5,
  };

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.flyTo({
      center: [initialCentre.lng, initialCentre.lat],
      zoom: 13,
      pitch: 45,
      bearing: -15,
      duration: 2000,
    });
    setMapReady(true);
  }, [initialCentre.lng, initialCentre.lat]);

  const handleClick = useCallback((e: MapMouseEvent) => {
    const features = e.target.queryRenderedFeatures(e.point, { layers: ["route-today-pins"] });
    const f = features[0];
    if (!f) return;
    const taskId = f.properties?.taskId as string | undefined;
    if (taskId) setSelectedTaskId(taskId);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 12rem)" }}>
      <Map
        ref={mapRef}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""}
        initialViewState={{
          longitude: initialCentre.lng,
          latitude: initialCentre.lat,
          zoom: 2,
          pitch: 0,
          bearing: 0,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        projection="globe"
        interactiveLayerIds={["route-today-pins"]}
        onClick={handleClick}
        onLoad={handleLoad}
      >
        <NavigationControl position="bottom-right" />
        <ScaleControl position="bottom-left" />

        {mapReady && (
          <CampLayer campData={campData} overlayMode="grazing" highlightedCampId={null} />
        )}

        {mapReady && (
          <Source id="route-today-tour-source" type="geojson" data={tourFC}>
            <Layer {...tourLineLayer} />
          </Source>
        )}

        {mapReady && (
          <Source id="route-today-pins-source" type="geojson" data={pinFC}>
            <Layer {...pinCircleLayer} />
            <Layer {...pinLabelLayer} />
          </Source>
        )}
      </Map>

      {/* Pin list panel — clicking a row focuses that pin */}
      <div
        className="absolute top-4 left-4 z-[12] rounded-xl overflow-hidden shadow-lg"
        style={{
          background: "rgba(26,21,16,0.94)",
          border: "1px solid rgba(140,100,60,0.3)",
          maxWidth: 320,
          maxHeight: "70vh",
          overflowY: "auto",
        }}
      >
        <div
          className="px-4 py-3 text-xs font-bold uppercase tracking-wider"
          style={{ color: "rgba(210,180,140,0.7)", borderBottom: "1px solid rgba(140,100,60,0.25)" }}
        >
          Route today · {pins.length} stop{pins.length === 1 ? "" : "s"}
        </div>
        {pins.map((p) => {
          const isActive = selectedTaskId === p.properties.taskId;
          return (
            <button
              key={p.properties.occurrenceId}
              onClick={() => {
                setSelectedTaskId(p.properties.taskId);
                const [lng, lat] = p.geometry.coordinates;
                mapRef.current?.getMap()?.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
              }}
              className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
              style={{
                background: isActive ? "rgba(14,165,233,0.15)" : "transparent",
                borderBottom: "1px solid rgba(140,100,60,0.15)",
                color: "#F5EBD4",
                cursor: "pointer",
              }}
            >
              <span
                className="flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ width: 26, height: 26, background: "#0ea5e9", color: "#fff" }}
              >
                {p.properties.seq}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{p.properties.title}</span>
                <span className="block text-xs mt-0.5" style={{ color: "rgba(210,180,140,0.7)" }}>
                  {p.properties.campName ?? "Unassigned camp"} · {p.properties.priority}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected-pin detail card — inline (no TaskDetail component exists) */}
      {selectedPin && (
        <div
          className="absolute top-4 right-4 z-[12] rounded-xl p-4 shadow-lg"
          style={{
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.08)",
            width: 280,
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className="flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ width: 26, height: 26, background: "#0ea5e9", color: "#fff" }}
              >
                {selectedPin.properties.seq}
              </span>
              <h3 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                {selectedPin.properties.title}
              </h3>
            </div>
            <button
              onClick={() => setSelectedTaskId(null)}
              className="text-xs"
              style={{ color: "#9C8E7A" }}
            >
              Close
            </button>
          </div>
          <div className="mt-3 text-xs space-y-1" style={{ color: "#5C3D2E" }}>
            <p>
              <span style={{ color: "#9C8E7A" }}>Camp:</span>{" "}
              {selectedPin.properties.campName ?? "—"}
            </p>
            <p>
              <span style={{ color: "#9C8E7A" }}>Priority:</span>{" "}
              {selectedPin.properties.priority}
            </p>
          </div>
          <Link
            href={`/${farmSlug}/admin/tasks?focus=${encodeURIComponent(selectedPin.properties.taskId)}`}
            className="mt-3 inline-block text-xs font-medium underline"
            style={{ color: "#0ea5e9" }}
          >
            Open in Tasks board →
          </Link>
        </div>
      )}
    </div>
  );
}
