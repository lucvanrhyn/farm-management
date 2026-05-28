"use client";

/**
 * FarmMap — shell that owns the Mapbox viewport, controls, draw/move modes,
 * and layer-mount dispatch. Individual layer logic lives in
 * `components/map/layers/*`.
 *
 * Scope of this shell (Wave 2D):
 *   - Viewport + globe flyover + terrain/sky
 *   - Mapbox controls (geolocate / nav / scale)
 *   - Camp overlay-mode selector (drives CampLayer color ramp)
 *   - LayerToggle panel (9 layers, persisted to localStorage)
 *   - Draw + Move-mob toolbar + modals
 *   - Camp-click popup (via shared CampPopupContent)
 *   - Long-press handler STUB (desktop contextmenu + mobile 600ms timer);
 *     Wave 3E wires the Create-Task sheet onto `onLongPress`.
 *
 * Shell state model (issue #392 / PRD #389 Module 2):
 *   A single `FarmMapMode` discriminated union (`./farm-map-mode.ts`) drives
 *   every overlay/panel visibility check. Mutual exclusion is enforced at
 *   the reducer level — only one of `drawing-boundary`, `naming-boundary`,
 *   or `moving-mob` can be active at a time. The legacy independent
 *   booleans (`isDrawing`, `showDrawModal`, `moveMode.active`) are gone.
 *
 * Hard constraints:
 *   - No cross-layer imports.
 *   - No behaviour regression when all non-camp layers are toggled off.
 */

import { useRef, useState, useReducer, useCallback, useMemo } from "react";
import Map, {
  GeolocateControl,
  NavigationControl,
  ScaleControl,
  Popup,
  type MapRef,
} from "react-map-gl/mapbox";
import type { MapMouseEvent } from "mapbox-gl";
import area from "@turf/area";
import { useParams } from "next/navigation";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import type { Camp } from "@/lib/types";
import DrawCampModal from "./DrawCampModal";
import DrawControl from "./DrawControl";
import MoveModePanel from "./MoveModePanel";
import CampPopupContent from "./CampPopupContent";
import { useLongPress } from "./useLongPress";
import type { MobInfo, MoveModeActions } from "./useMoveMode";
import { farmMapModeReducer, IDLE, type MobMovePhase } from "./farm-map-mode";

import LayerToggle, { useLayerState } from "./LayerToggle";
import CampLayer, {
  extractCampClickPayload,
  type CampData,
  type OverlayMode,
} from "./layers/CampLayer";
import TaskPinLayer from "./layers/TaskPinLayer";
import WaterPointLayer from "./layers/WaterPointLayer";
import InfrastructureLayer from "./layers/InfrastructureLayer";
import RainfallGaugeLayer from "./layers/RainfallGaugeLayer";
import AfisFireLayer from "./layers/AfisFireLayer";
import FmdZoneLayer from "./layers/FmdZoneLayer";
import EskomBannerLayer from "./layers/EskomBannerLayer";
import MtnCoverageLayer from "./layers/MtnCoverageLayer";

// Re-export types so existing imports (`import { OverlayMode } from "@/components/map/FarmMap"`) keep working.
export type { CampData, OverlayMode } from "./layers/CampLayer";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  /** Fired on desktop right-click or mobile 600ms touch-hold. Wave 3E uses this
   *  to open the Create-Task sheet at the tapped coordinate. */
  onLongPress?: (lngLat: { lng: number; lat: number }) => void;
  /** EskomSePush area ID to render the load-shedding banner for. Banner
   *  hides when null. */
  eskomAreaId?: string | null;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const OVERLAY_OPTIONS: { value: OverlayMode; label: string }[] = [
  { value: "grazing",        label: "Grazing" },
  { value: "water",          label: "Water" },
  { value: "density",        label: "Density" },
  { value: "inspection",     label: "Inspection" },
  { value: "census",         label: "Census" },
  { value: "rotation",       label: "Rotation" },
  { value: "veld_condition", label: "Veld Condition" },
  { value: "feed_on_offer",  label: "Feed on Offer" },
];

// ── Main Component ────────────────────────────────────────────────────────────

export default function FarmMap({
  campData, onCampClick, className, drawMode = false,
  overlayMode: overlayModeProp, onOverlayChange, onBoundaryDrawn,
  latitude: farmLat, longitude: farmLng,
  onLongPress, eskomAreaId = null,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);
  const [localOverlay, setLocalOverlay] = useState<OverlayMode>("grazing");
  const [layerState, updateLayers] = useLayerState();

  // Single discriminated-union state for the FarmMap shell. The reducer
  // enforces mutual exclusion — only one of (drawing-boundary,
  // naming-boundary, moving-mob) can be active at a time, so the panel
  // overlap from issue #392 is impossible to render.
  const [mode, dispatch] = useReducer(farmMapModeReducer, IDLE);
  const isDrawing = mode.kind === "drawing-boundary";
  const isMovingMob = mode.kind === "moving-mob";
  const mobPhase: MobMovePhase = isMovingMob ? mode.phase : { tag: "idle" };
  const sourceCampId: string | null =
    isMovingMob && mobPhase.tag !== "idle" ? mobPhase.campId : null;

  // Stable MoveModeActions facade so MoveModePanel's interface contract
  // doesn't have to change. All actions route through the unified reducer.
  const moveModeActions: MoveModeActions = useMemo(
    () => ({
      toggleActive: () => dispatch({ type: "startMobMove" }),
      selectSourceCamp: (campId: string) =>
        dispatch({
          type: "updateMobPhase",
          phase: { tag: "source_selected", campId },
        }),
      selectMob: (mob: MobInfo) =>
        dispatch({
          type: "updateMobPhase",
          phase: { tag: "mob_selected", campId: mob.current_camp, mob },
        }),
      selectDestCamp: (destCampId: string) => {
        // Only valid mid-flow; the reducer ignores updates from idle, but
        // we want the type-narrow available here.
        if (mobPhase.tag === "mob_selected" && destCampId !== mobPhase.campId) {
          dispatch({
            type: "updateMobPhase",
            phase: {
              tag: "dest_selected",
              campId: mobPhase.campId,
              mob: mobPhase.mob,
              destCampId,
            },
          });
        }
      },
      cancelMove: () => dispatch({ type: "cancel" }),
      resetToSourceSelect: () => {
        if (mobPhase.tag !== "idle") {
          dispatch({
            type: "updateMobPhase",
            phase: { tag: "source_selected", campId: mobPhase.campId },
          });
        }
      },
    }),
    [mobPhase]
  );

  useLongPress(mapRef, onLongPress);

  const activeOverlay = overlayModeProp ?? localOverlay;
  const setOverlay = (mode: OverlayMode) => {
    setLocalOverlay(mode);
    onOverlayChange?.(mode);
  };

  const params = useParams();
  const farmSlug = (params?.farmSlug as string | undefined) ?? "";

  const camps: Camp[] = campData.map((cd) => cd.camp);
  const campNameMap = Object.fromEntries(campData.map((cd) => [cd.camp.camp_id, cd.camp.camp_name]));
  const campsWithoutBoundary = campData
    .filter((d) => !d.camp.geojson)
    .map((d) => ({ id: d.camp.camp_id, name: d.camp.camp_name }));

  // ── Map load: terrain + atmosphere + flyover ──────────────────────────────

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    map.addSource("mapbox-dem", {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
    });
    map.setTerrain({ source: "mapbox-dem", exaggeration: 1.2 });

    map.addLayer({
      id: "sky",
      type: "sky",
      paint: {
        "sky-type": "atmosphere",
        "sky-atmosphere-sun": [0.0, 0.0],
        "sky-atmosphere-sun-intensity": 15,
      },
    } as Parameters<typeof map.addLayer>[0]);

    const lng = farmLng ?? 28.5;
    const lat = farmLat ?? -25.5;
    map.flyTo({ center: [lng, lat], zoom: 14, pitch: 55, bearing: -20, duration: 3000 });
    setMapReady(true);
  }, [farmLat, farmLng]);

  // ── Camp polygon click ────────────────────────────────────────────────────

  const handleCampClick = useCallback(
    (e: MapMouseEvent) => {
      const payload = extractCampClickPayload(e);
      if (!payload) return;

      if (isMovingMob) {
        if (mobPhase.tag === "idle") {
          moveModeActions.selectSourceCamp(payload.campId);
        } else if (mobPhase.tag === "source_selected") {
          if (payload.campId !== mobPhase.campId) moveModeActions.selectSourceCamp(payload.campId);
        } else if (mobPhase.tag === "mob_selected") {
          if (payload.campId !== mobPhase.campId) moveModeActions.selectDestCamp(payload.campId);
        }
        return;
      }

      setPopupInfo(payload);
      onCampClick(payload.campId);
    },
    [onCampClick, isMovingMob, mobPhase, moveModeActions]
  );

  // ── Draw handlers ─────────────────────────────────────────────────────────

  const handleDrawCreate = useCallback((e: { features: GeoJSON.Feature[] }) => {
    const feature = e.features[0];
    if (!feature || !feature.geometry) return;
    const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [feature] };
    const hectares = parseFloat((area(fc) / 10000).toFixed(2));
    dispatch({
      type: "boundaryDrawn",
      geojson: JSON.stringify(feature.geometry),
      hectares,
    });
  }, []);

  const handleDrawDelete = useCallback(() => {
    dispatch({ type: "cancel" });
  }, []);

  const handleModalConfirm = useCallback(
    (campId: string | null, campName?: string) => {
      if (mode.kind !== "naming-boundary") return;
      const { geojson, hectares } = mode;
      dispatch({ type: "completeBoundary", geojson, hectares });
      onBoundaryDrawn?.(campId, geojson, hectares, campName);
    },
    [mode, onBoundaryDrawn]
  );

  const handleModalCancel = useCallback(() => {
    dispatch({ type: "cancel" });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }} className={className}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: 28.5, latitude: -25.5, zoom: 2, pitch: 0, bearing: 0 }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        projection="globe"
        onLoad={handleMapLoad}
        interactiveLayerIds={layerState.campOverlay ? ["camp-fill"] : []}
        onClick={layerState.campOverlay ? handleCampClick : undefined}
      >
        <GeolocateControl position="top-right" />
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" />

        {/* Layer mount dispatch — each layer is independent and mounts only when its toggle is on. */}
        {mapReady && layerState.campOverlay && (
          <CampLayer
            campData={campData}
            overlayMode={activeOverlay}
            highlightedCampId={sourceCampId}
          />
        )}
        {mapReady && layerState.taskPins && farmSlug && (
          <TaskPinLayer farmSlug={farmSlug} camps={camps} />
        )}
        {mapReady && layerState.waterPoints && farmSlug && (
          <WaterPointLayer farmSlug={farmSlug} />
        )}
        {mapReady && layerState.infrastructure && farmSlug && (
          <InfrastructureLayer farmSlug={farmSlug} />
        )}
        {mapReady && layerState.rainfallGauges && farmSlug && (
          <RainfallGaugeLayer farmSlug={farmSlug} />
        )}
        {mapReady && layerState.afisFire && <AfisFireLayer />}
        {mapReady && layerState.fmdZones && <FmdZoneLayer />}
        {mapReady && layerState.mtnCoverage && <MtnCoverageLayer />}

        {(drawMode || isDrawing) && (
          <DrawControl onDrawCreate={handleDrawCreate} onDrawDelete={handleDrawDelete} enabled={isDrawing} />
        )}

        {popupInfo && (
          <Popup
            longitude={popupInfo.longitude}
            latitude={popupInfo.latitude}
            anchor="bottom"
            onClose={() => setPopupInfo(null)}
            closeButton={false}
            maxWidth="280px"
          >
            <CampPopupContent {...popupInfo} />
          </Popup>
        )}
      </Map>

      {/* Eskom banner (not a Mapbox layer — absolutely positioned above map). */}
      {layerState.eskomBanner && <EskomBannerLayer areaId={eskomAreaId} />}

      {isMovingMob && (
        <MoveModePanel
          phase={mobPhase}
          campNameMap={campNameMap}
          actions={moveModeActions}
          onMoveDone={moveModeActions.cancelMove}
        />
      )}

      {/* Overlay selector toolbar (camp overlay color ramp) */}
      <div
        style={{
          position: "absolute", top: 12, left: 12, zIndex: 10,
          display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 6px",
          // Leave a right gutter so the wrapped row never slides under the
          // top-right Mapbox nav/geolocate control column on narrow screens.
          maxWidth: "calc(100% - 78px)",
          borderRadius: 10, background: "rgba(26,21,16,0.85)",
          backdropFilter: "blur(8px)", border: "1px solid rgba(140,100,60,0.25)",
        }}
      >
        {OVERLAY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setOverlay(opt.value)}
            style={{
              padding: "5px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
              cursor: "pointer", border: "none", transition: "all 0.15s",
              background: activeOverlay === opt.value ? "rgba(139,105,20,0.3)" : "transparent",
              color: activeOverlay === opt.value ? "#F5EBD4" : "rgba(210,180,140,0.6)",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <LayerToggle value={layerState} onChange={updateLayers} />

      {isDrawing && (
        <div
          style={{
            position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)",
            zIndex: 10, display: "flex", alignItems: "center", gap: 8,
            padding: "10px 20px", borderRadius: 12,
            background: "rgba(26,21,16,0.92)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(34,197,94,0.4)", color: "#F5EBD4",
            fontSize: 13, fontFamily: "var(--font-sans)", fontWeight: 500,
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)", whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "#22c55e", fontSize: 16 }}>&#9678;</span>
          <span>Click to place points. <strong style={{ color: "#22c55e" }}>Double-click</strong> the last point to finish.</span>
        </div>
      )}

      {/* Bottom-left action cluster. A compact vertical stack keeps it narrow.
          On mobile the bottom-right Layers panel re-anchors to the top-right
          (see LayerToggle.tsx, issue #468) so the two overlays never intersect
          and the full "Draw Camp Boundary" label stays visible. */}
      <div data-testid="map-action-cluster" style={{ position: "absolute", bottom: 36, left: 12, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
        <button
          onClick={() => dispatch({ type: "startMobMove" })}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8, fontSize: 11,
            whiteSpace: "nowrap",
            fontFamily: "var(--font-sans)", fontWeight: 500,
            background: isMovingMob ? "rgba(196,144,48,0.2)" : "rgba(36,28,20,0.88)",
            border: isMovingMob ? "1px solid rgba(196,144,48,0.5)" : "1px solid rgba(140,100,60,0.35)",
            color: isMovingMob ? "#C49030" : "#D2B48C",
            cursor: "pointer", backdropFilter: "blur(6px)", transition: "all 0.2s",
          }}
        >
          <span style={{ fontSize: 14 }}>⇄</span>
          {isMovingMob ? "Exit Move" : "Move Mob"}
        </button>

        <button
          onClick={() => dispatch({ type: "startDrawing" })}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8, fontSize: 11,
            whiteSpace: "nowrap",
            fontFamily: "var(--font-sans)", fontWeight: 500,
            background: isDrawing ? "rgba(34,197,94,0.2)" : "rgba(36,28,20,0.88)",
            border: isDrawing ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(140,100,60,0.35)",
            color: isDrawing ? "#22c55e" : "#D2B48C",
            cursor: "pointer", backdropFilter: "blur(6px)", transition: "all 0.2s",
          }}
        >
          <span style={{ fontSize: 14 }}>✦</span>
          {isDrawing ? "Cancel Drawing" : "Draw Camp Boundary"}
        </button>
      </div>

      {mode.kind === "naming-boundary" && (
        <DrawCampModal
          hectares={mode.hectares}
          campsWithoutBoundary={campsWithoutBoundary}
          onConfirm={handleModalConfirm}
          onCancel={handleModalCancel}
        />
      )}
    </div>
  );
}
