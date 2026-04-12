"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import Map, {
  GeolocateControl,
  NavigationControl,
  ScaleControl,
  Source,
  Layer,
  Popup,
  useControl,
  type MapRef,
  type LayerProps,
} from "react-map-gl/mapbox";
import type { MapMouseEvent } from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import area from "@turf/area";
import { useParams } from "next/navigation";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import type { Camp, CampStats } from "@/lib/types";
import { DEFAULT_CAMP_COLOR } from "@/lib/camp-colors";
import DrawCampModal from "./DrawCampModal";
import MoveModePanel from "./MoveModePanel";
import { useMoveMode } from "./useMoveMode";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CampData {
  camp: Camp;
  stats: CampStats;
  grazing: string;
  waterStatus?: string;
  fenceStatus?: string;
  lastInspected?: string;
  daysSinceInspection?: number;
  censusPopulation?: number;
  rotationStatus?: "grazing" | "overstayed" | "resting" | "resting_ready" | "overdue_rest" | "unknown";
  rotationDays?: number | null;
  veldScore?: number | null;
}

interface PopupInfo {
  campId: string;
  campName: string;
  grazing: string;
  animalCount: number;
  sizeHectares: number | null;
  waterStatus: string;
  fenceStatus: string;
  daysSinceInspection: number | null;
  longitude: number;
  latitude: number;
}

interface DrawnBoundary {
  geojson: string;
  hectares: number;
}

export type OverlayMode = "grazing" | "density" | "inspection" | "water" | "census" | "rotation" | "veld_condition";

interface Props {
  campData: CampData[];
  onCampClick: (campId: string) => void;
  className?: string;
  drawMode?: boolean;
  overlayMode?: OverlayMode;
  onOverlayChange?: (mode: OverlayMode) => void;
  onBoundaryDrawn?: (campId: string | null, geojson: string, hectares: number, campName?: string) => void;
  latitude?: number | null;
  longitude?: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const GRAZING_COLORS: Record<string, string> = {
  Good:       "#22c55e",
  Fair:       "#eab308",
  Poor:       "#f97316",
  Overgrazed: "#ef4444",
};

const DEFAULT_FALLBACK_COLOR = "#94a3b8";

const WATER_COLORS: Record<string, string> = {
  Good:     "#22c55e",
  Adequate: "#eab308",
  Poor:     "#f97316",
  Critical: "#ef4444",
};

const FENCE_COLORS: Record<string, string> = {
  Intact:   "#22c55e",
  Damaged:  "#f97316",
  Critical: "#ef4444",
};

function getOverlayColor(mode: OverlayMode, cd: CampData): string {
  switch (mode) {
    case "grazing":
      return GRAZING_COLORS[cd.grazing] ?? DEFAULT_FALLBACK_COLOR;
    case "water":
      return WATER_COLORS[cd.waterStatus ?? ""] ?? DEFAULT_FALLBACK_COLOR;
    case "density": {
      const ha = cd.camp.size_hectares;
      const count = cd.stats.total;
      if (!ha || ha <= 0) return DEFAULT_FALLBACK_COLOR;
      const density = count / ha;
      if (density <= 0.5) return "#22c55e";
      if (density <= 1.0) return "#eab308";
      if (density <= 2.0) return "#f97316";
      return "#ef4444";
    }
    case "inspection": {
      const days = cd.daysSinceInspection;
      if (days == null) return DEFAULT_FALLBACK_COLOR;
      if (days <= 7) return "#22c55e";
      if (days <= 14) return "#eab308";
      if (days <= 30) return "#f97316";
      return "#ef4444";
    }
    case "census": {
      const pop = cd.censusPopulation ?? 0;
      const ha = cd.camp.size_hectares;
      if (!ha || ha <= 0 || pop === 0) return DEFAULT_FALLBACK_COLOR;
      const densityPerHa = pop / ha;
      if (densityPerHa <= 2) return "#22c55e";
      if (densityPerHa <= 5) return "#eab308";
      if (densityPerHa <= 10) return "#f97316";
      return "#ef4444";
    }
    case "rotation": {
      switch (cd.rotationStatus) {
        case "grazing":       return "#3b82f6";
        case "overstayed":    return "#dc2626";
        case "resting_ready": return "#16a34a";
        case "resting":       return "#86efac";
        case "overdue_rest":  return "#f59e0b";
        default:              return "#9ca3af";
      }
    }
    case "veld_condition": {
      const s = cd.veldScore;
      if (s == null) return "#9ca3af"; // grey = no data
      if (s < 3) return "#ef4444";     // red = critical
      if (s < 5) return "#f97316";     // orange = poor
      if (s < 7) return "#eab308";     // yellow = fair
      return "#22c55e";                 // green = good
    }
  }
}

const OVERLAY_OPTIONS: { value: OverlayMode; label: string }[] = [
  { value: "grazing",        label: "Grazing" },
  { value: "water",          label: "Water" },
  { value: "density",        label: "Density" },
  { value: "inspection",     label: "Inspection" },
  { value: "census",         label: "Census" },
  { value: "rotation",       label: "Rotation" },
  { value: "veld_condition", label: "Veld Condition" },
];

// ── GeoJSON builder ───────────────────────────────────────────────────────────

function buildCampGeoJSON(campData: CampData[], overlay: OverlayMode): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const cd of campData) {
    const { camp, stats, grazing } = cd;
    if (!camp.geojson) continue;
    try {
      const parsed = JSON.parse(camp.geojson) as GeoJSON.Geometry;
      const identityColor = camp.color ?? DEFAULT_CAMP_COLOR;
      features.push({
        type: "Feature",
        geometry: parsed,
        properties: {
          campId: camp.camp_id,
          campName: camp.camp_name,
          grazing,
          animalCount: stats.total,
          sizeHectares: camp.size_hectares ?? -1,
          waterStatus: cd.waterStatus ?? "Unknown",
          fenceStatus: cd.fenceStatus ?? "Unknown",
          daysSinceInspection: cd.daysSinceInspection ?? -1,
          censusPopulation: cd.censusPopulation ?? 0,
          labelSubtext:
            overlay === "census"
              ? `${cd.censusPopulation ?? 0} game`
              : overlay === "rotation" && cd.rotationStatus != null
              ? (cd.rotationStatus === "grazing" || cd.rotationStatus === "overstayed")
                ? `${cd.rotationDays ?? 0}d grazed`
                : cd.rotationDays != null
                ? `${cd.rotationDays}d rested`
                : cd.rotationStatus
              : overlay === "veld_condition" && cd.veldScore != null
              ? `${cd.veldScore.toFixed(1)}/10`
              : `${stats.total} head`,
          color: getOverlayColor(overlay, cd),
          borderColor: identityColor,
        },
      });
    } catch {
      // skip malformed geojson
    }
  }

  return { type: "FeatureCollection", features };
}

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

const labelLayer: LayerProps = {
  id: "camp-label",
  type: "symbol",
  layout: {
    "text-field": [
      "format",
      ["get", "campName"], { "font-scale": 1.0, "text-font": ["literal", ["Open Sans Bold", "Arial Unicode MS Bold"]] },
      "\n", {},
      ["get", "labelSubtext"], { "font-scale": 0.75, "text-font": ["literal", ["Open Sans Regular", "Arial Unicode MS Regular"]] },
    ] as unknown as string,
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": 12,
    "text-anchor": "center",
    "text-allow-overlap": false,
    "text-line-height": 1.4,
  },
  paint: {
    "text-color": "#ffffff",
    "text-halo-color": "rgba(0,0,0,0.7)",
    "text-halo-width": 1.5,
  },
};

// ── DrawControl wrapper (useControl hook) ─────────────────────────────────────

interface DrawControlProps {
  onDrawCreate: (e: { features: GeoJSON.Feature[] }) => void;
  onDrawDelete: () => void;
  enabled: boolean;
}

function DrawControl({ onDrawCreate, onDrawDelete, enabled }: DrawControlProps) {
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

  // Switch mode when enabled changes
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function FarmMap({
  campData, onCampClick, className, drawMode = false,
  overlayMode: overlayModeProp, onOverlayChange, onBoundaryDrawn,
  latitude: farmLat, longitude: farmLng,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnBoundary, setDrawnBoundary] = useState<DrawnBoundary | null>(null);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const [localOverlay, setLocalOverlay] = useState<OverlayMode>("grazing");
  const [moveMode, moveModeActions] = useMoveMode();

  const activeOverlay = overlayModeProp ?? localOverlay;
  const setOverlay = (mode: OverlayMode) => {
    setLocalOverlay(mode);
    onOverlayChange?.(mode);
  };

  // Derived: camp name lookup for MoveModePanel
  const campNameMap = Object.fromEntries(
    campData.map((cd) => [cd.camp.camp_id, cd.camp.camp_name])
  );

  const geojsonData = buildCampGeoJSON(campData, activeOverlay);
  const campsWithoutBoundary = campData
    .filter((d) => !d.camp.geojson)
    .map((d) => ({ id: d.camp.camp_id, name: d.camp.camp_name }));

  // ── Map load: terrain + atmosphere + flyover ──────────────────────────────

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Add terrain DEM
    map.addSource("mapbox-dem", {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
    });
    map.setTerrain({ source: "mapbox-dem", exaggeration: 1.2 });

    // Sky atmosphere layer
    map.addLayer({
      id: "sky",
      type: "sky",
      paint: {
        "sky-type": "atmosphere",
        "sky-atmosphere-sun": [0.0, 0.0],
        "sky-atmosphere-sun-intensity": 15,
      },
    } as Parameters<typeof map.addLayer>[0]);

    // Globe flyover to farm — Mapbox expects [longitude, latitude]
    const lng = farmLng ?? 28.5;
    const lat = farmLat ?? -25.5;

    map.flyTo({
      center: [lng, lat],
      zoom: 14,
      pitch: 55,
      bearing: -20,
      duration: 3000,
    });
  }, [farmLat, farmLng]);

  // ── Camp polygon click ────────────────────────────────────────────────────

  const handleCampClick = useCallback(
    (e: MapMouseEvent) => {
      const features = e.features;
      if (!features || features.length === 0) return;

      const feature = features[0];
      const props = feature.properties;
      if (!props) return;

      const campId = String(props.campId);

      // Move mode intercepts all camp clicks
      if (moveMode.active) {
        const { phase } = moveMode;
        if (phase.tag === "idle") {
          moveModeActions.selectSourceCamp(campId);
        } else if (phase.tag === "source_selected") {
          // Clicking a different camp while no mob selected changes source
          if (campId !== phase.campId) moveModeActions.selectSourceCamp(campId);
        } else if (phase.tag === "mob_selected") {
          // Destination selected
          if (campId !== phase.campId) moveModeActions.selectDestCamp(campId);
        }
        // dest_selected phase: ignore further clicks until confirmed/cancelled
        return;
      }

      // Normal mode: show popup
      // Compute click point center from feature bounding box (approximate)
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

      setPopupInfo({
        campId,
        campName: String(props.campName),
        grazing: String(props.grazing),
        animalCount: Number(props.animalCount),
        sizeHectares: sizeRaw >= 0 ? sizeRaw : null,
        waterStatus: String(props.waterStatus ?? "Unknown"),
        fenceStatus: String(props.fenceStatus ?? "Unknown"),
        daysSinceInspection: daysRaw >= 0 ? daysRaw : null,
        longitude: lng,
        latitude: lat,
      });

      onCampClick(campId);
    },
    [onCampClick, moveMode, moveModeActions]
  );

  // ── Draw handlers ─────────────────────────────────────────────────────────

  const handleDrawCreate = useCallback((e: { features: GeoJSON.Feature[] }) => {
    const feature = e.features[0];
    if (!feature || !feature.geometry) return;

    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature],
    };

    const areaM2 = area(featureCollection);
    const hectares = parseFloat((areaM2 / 10000).toFixed(2));
    const geojson = JSON.stringify(feature.geometry);

    setDrawnBoundary({ geojson, hectares });
    setIsDrawing(false);
    setShowDrawModal(true);
  }, []);

  const handleDrawDelete = useCallback(() => {
    setDrawnBoundary(null);
    setShowDrawModal(false);
  }, []);

  const handleModalConfirm = useCallback(
    (campId: string | null, campName?: string) => {
      if (!drawnBoundary) return;
      setShowDrawModal(false);
      setDrawnBoundary(null);
      onBoundaryDrawn?.(campId, drawnBoundary.geojson, drawnBoundary.hectares, campName);
    },
    [drawnBoundary, onBoundaryDrawn]
  );

  const handleModalCancel = useCallback(() => {
    setShowDrawModal(false);
    setDrawnBoundary(null);
    // Clear the drawn polygon from the map
    const map = mapRef.current?.getMap();
    if (map) {
      // The draw control manages its own state; mode change will reset
    }
  }, []);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }} className={className}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          longitude: 28.5,
          latitude: -25.5,
          zoom: 2,
          pitch: 0,
          bearing: 0,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        projection="globe"
        onLoad={handleMapLoad}
        interactiveLayerIds={["camp-fill"]}
        onClick={handleCampClick}
      >
        {/* Controls */}
        <GeolocateControl position="bottom-right" />
        <NavigationControl position="bottom-right" />
        <ScaleControl position="bottom-left" />

        {/* Camp polygon layers */}
        {geojsonData.features.length > 0 && (
          <Source id="camps" type="geojson" data={geojsonData}>
            <Layer {...fillLayer} />
            <Layer {...outlineLayer} />
            {/* Amber glow on move-mode source camp */}
            {moveMode.sourceCampId && (
              <Layer
                id="move-source-outline"
                type="line"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                filter={["==", ["get", "campId"], moveMode.sourceCampId] as any}
                paint={{
                  "line-color": "#C49030",
                  "line-width": 4,
                  "line-opacity": 0.9,
                }}
              />
            )}
            <Layer {...labelLayer} />
          </Source>
        )}

        {/* Draw control (mounted when drawing is active or drawMode prop is true) */}
        {(drawMode || isDrawing) && (
          <DrawControl
            onDrawCreate={handleDrawCreate}
            onDrawDelete={handleDrawDelete}
            enabled={isDrawing}
          />
        )}

        {/* Popup on camp click */}
        {popupInfo && (
          <Popup
            longitude={popupInfo.longitude}
            latitude={popupInfo.latitude}
            anchor="bottom"
            onClose={() => setPopupInfo(null)}
            closeButton={false}
            maxWidth="280px"
          >
            <CampPopupContent
              campId={popupInfo.campId}
              campName={popupInfo.campName}
              grazing={popupInfo.grazing}
              animalCount={popupInfo.animalCount}
              sizeHectares={popupInfo.sizeHectares}
              waterStatus={popupInfo.waterStatus}
              fenceStatus={popupInfo.fenceStatus}
              daysSinceInspection={popupInfo.daysSinceInspection}
            />
          </Popup>
        )}
      </Map>

      {/* Move mode panel */}
      {moveMode.active && (
        <MoveModePanel
          phase={moveMode.phase}
          campNameMap={campNameMap}
          actions={moveModeActions}
          onMoveDone={moveModeActions.cancelMove}
        />
      )}

      {/* Overlay selector toolbar */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 10,
          display: "flex",
          gap: 4,
          padding: "4px 6px",
          borderRadius: 10,
          background: "rgba(26,21,16,0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(140,100,60,0.25)",
        }}
      >
        {OVERLAY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setOverlay(opt.value)}
            style={{
              padding: "5px 10px",
              borderRadius: 7,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              transition: "all 0.15s",
              background: activeOverlay === opt.value ? "rgba(139,105,20,0.3)" : "transparent",
              color: activeOverlay === opt.value ? "#F5EBD4" : "rgba(210,180,140,0.6)",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Drawing instructions banner */}
      {isDrawing && (
        <div
          style={{
            position: "absolute",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            borderRadius: 12,
            background: "rgba(26,21,16,0.92)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(34,197,94,0.4)",
            color: "#F5EBD4",
            fontSize: 13,
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "#22c55e", fontSize: 16 }}>&#9678;</span>
          <span>Click to place points. <strong style={{ color: "#22c55e" }}>Double-click</strong> the last point to finish.</span>
        </div>
      )}

      {/* Draw + Move buttons — bottom right of map */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          right: 120,
          zIndex: 10,
          display: "flex",
          gap: 8,
        }}
      >
        {/* Move mob button */}
        <button
          onClick={moveModeActions.toggleActive}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            background: moveMode.active
              ? "rgba(196,144,48,0.2)"
              : "rgba(36,28,20,0.88)",
            border: moveMode.active
              ? "1px solid rgba(196,144,48,0.5)"
              : "1px solid rgba(140,100,60,0.35)",
            color: moveMode.active ? "#C49030" : "#D2B48C",
            cursor: "pointer",
            backdropFilter: "blur(6px)",
            transition: "all 0.2s",
          }}
        >
          <span style={{ fontSize: 14 }}>⇄</span>
          {moveMode.active ? "Exit Move" : "Move Mob"}
        </button>

        {/* Draw camp boundary button */}
        <button
          onClick={() => setIsDrawing((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            background: isDrawing
              ? "rgba(34,197,94,0.2)"
              : "rgba(36,28,20,0.88)",
            border: isDrawing
              ? "1px solid rgba(34,197,94,0.5)"
              : "1px solid rgba(140,100,60,0.35)",
            color: isDrawing ? "#22c55e" : "#D2B48C",
            cursor: "pointer",
            backdropFilter: "blur(6px)",
            transition: "all 0.2s",
          }}
        >
          <span style={{ fontSize: 14 }}>✦</span>
          {isDrawing ? "Cancel Drawing" : "Draw Camp Boundary"}
        </button>
      </div>

      {/* Draw modal */}
      {showDrawModal && drawnBoundary && (
        <DrawCampModal
          hectares={drawnBoundary.hectares}
          campsWithoutBoundary={campsWithoutBoundary}
          onConfirm={handleModalConfirm}
          onCancel={handleModalCancel}
        />
      )}
    </div>
  );
}

// ── Popup content (plain React, no Leaflet) ───────────────────────────────────

const POPUP_COLORS: Record<string, string> = {
  Good:       "#4ade80",
  Fair:       "#fbbf24",
  Poor:       "#fb923c",
  Overgrazed: "#f87171",
};

const POPUP_BG: Record<string, string> = {
  Good:       "rgba(74,222,128,0.1)",
  Fair:       "rgba(251,191,36,0.1)",
  Poor:       "rgba(251,146,60,0.1)",
  Overgrazed: "rgba(248,113,113,0.1)",
};

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  Good:     { color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  Intact:   { color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  Adequate: { color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  Fair:     { color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  Damaged:  { color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  Poor:     { color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  Overgrazed: { color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  Critical: { color: "#f87171", bg: "rgba(248,113,113,0.1)" },
};

const DEFAULT_STATUS = { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };

function StatusBadge({ label, value }: { label: string; value: string }) {
  const s = STATUS_COLORS[value] ?? DEFAULT_STATUS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 8, color: "rgba(210,180,140,0.5)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          background: s.bg, color: s.color,
          border: `1px solid ${s.color}44`,
          borderRadius: 6, fontSize: 10, padding: "2px 7px", fontWeight: 600,
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color }} />
        {value}
      </div>
    </div>
  );
}

function CampPopupContent({
  campId,
  campName,
  grazing,
  animalCount,
  sizeHectares,
  waterStatus,
  fenceStatus,
  daysSinceInspection,
}: {
  campId: string;
  campName: string;
  grazing: string;
  animalCount: number;
  sizeHectares: number | null;
  waterStatus: string;
  fenceStatus: string;
  daysSinceInspection: number | null;
}) {
  const params = useParams();
  const farmSlug = params?.farmSlug as string | undefined;
  return (
    <div
      style={{
        background: "#1E1710",
        border: "1px solid rgba(139,105,20,0.3)",
        borderRadius: "14px",
        padding: "14px 16px",
        color: "#F5EBD4",
        minWidth: "220px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      {/* Camp name + size */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10 }}>
        <p style={{ fontWeight: 700, fontSize: 15, fontFamily: "var(--font-display, serif)", color: "#F5EBD4", margin: 0 }}>
          {campName}
        </p>
        {sizeHectares != null && (
          <span style={{ fontSize: 10, color: "rgba(210,180,140,0.5)" }}>
            {sizeHectares} ha
          </span>
        )}
      </div>

      {/* Animal count + grazing badge row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div
          style={{
            display: "flex", flexDirection: "column",
            padding: "4px 10px", borderRadius: 8,
            background: "rgba(255,248,235,0.06)",
            border: "1px solid rgba(210,180,140,0.15)",
            minWidth: 56, alignItems: "center",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "#F5EBD4", lineHeight: 1.2 }}>
            {animalCount}
          </span>
          <span style={{ fontSize: 9, color: "rgba(210,180,140,0.6)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            animals
          </span>
        </div>
        <StatusBadge label="Grazing" value={grazing} />
      </div>

      {/* Water + Fence + Inspection row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {waterStatus !== "Unknown" && <StatusBadge label="Water" value={waterStatus} />}
        {fenceStatus !== "Unknown" && <StatusBadge label="Fence" value={fenceStatus} />}
        {daysSinceInspection != null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 8, color: "rgba(210,180,140,0.5)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Last check
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 6,
              background: daysSinceInspection <= 7 ? "rgba(74,222,128,0.1)" : daysSinceInspection <= 14 ? "rgba(251,191,36,0.1)" : "rgba(251,146,60,0.1)",
              color: daysSinceInspection <= 7 ? "#4ade80" : daysSinceInspection <= 14 ? "#fbbf24" : "#fb923c",
            }}>
              {daysSinceInspection === 0 ? "Today" : `${daysSinceInspection}d ago`}
            </span>
          </div>
        )}
      </div>

      {/* Action links */}
      <div style={{ display: "flex", gap: 16 }}>
        {farmSlug && (
          <a
            href={`/${encodeURIComponent(farmSlug)}/dashboard/camp/${encodeURIComponent(campId)}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, color: "#D2B48C", fontWeight: 600,
              textDecoration: "none", letterSpacing: "0.02em",
            }}
          >
            View Details &rarr;
          </a>
        )}
        {farmSlug && (
          <a
            href={`/${encodeURIComponent(farmSlug)}/logger/${encodeURIComponent(campId)}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, color: "#8B6914", fontWeight: 600,
              textDecoration: "none", letterSpacing: "0.02em",
            }}
          >
            Log now &rarr;
          </a>
        )}
      </div>
    </div>
  );
}
