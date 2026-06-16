"use client";

/**
 * FarmMap — shell that owns the Mapbox viewport, controls, draw/move modes,
 * and layer-mount dispatch. Individual layer logic lives in
 * `components/map/layers/*`.
 *
 * Scope of this shell (Wave 2D + Overhaul map-pixel):
 *   - Dark chrome HEADER bar (back chevron, serif title + mono geometry sub,
 *     centred map-theme Segmented tabs, "CAMPS LIST" toggle, optional extra
 *     slot for admin's "Route today" link).
 *   - Right CAMP-LIST split panel (desktop) / overlay (phone), toggled from
 *     the header.
 *   - Viewport + globe flyover + terrain/sky
 *   - Mapbox controls (geolocate / nav / scale)
 *   - Camp overlay-mode selector (drives CampLayer color ramp)
 *   - Map-theme switcher (satellite / terrain / outdoors / dark / schematic /
 *     blueprint → Mapbox mapStyle)
 *   - LayerToggle panel (9 layers, persisted to localStorage)
 *   - Draw + Move-mob toolbar + modals
 *   - Camp-click popup (via shared CampPopupContent)
 *   - Long-press handler (desktop contextmenu + mobile 600ms timer) → onLongPress
 *   - Phone overlay layout (floating glass top bar, scrolling filter chips,
 *     bottom-right zoom, bottom sheet hint).
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
import Link from "next/link";
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
import { Icon, Segmented, StatusDot, type Status } from "@/components/ds";
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

  // ── Dark chrome header (Overhaul map-pixel) ──────────────────────────────
  /** Serif title in the dark header bar. Header hides entirely when omitted. */
  headerTitle?: string;
  /** Mono sub-line under the title (e.g. "9 camps · 8 with boundary geometry · 412 head"). */
  headerSubtext?: string;
  /** Back-chevron destination (defaults to the farm home). */
  backHref?: string;
  /** Optional right-aligned extra node in the header (admin "Route today →"). */
  headerExtra?: React.ReactNode;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

// ── Map theme → Mapbox style id ────────────────────────────────────────────────
// Public mapbox:// styles. "Schematic" / "Blueprint" reuse the monochrome
// light/navigation styles as a clean, low-saturation backdrop (Mapbox has no
// public "blueprint" style — light-v11 + navigation-night-v1 approximate the
// schematic/blueprint reads from the reference).
type MapTheme = "satellite" | "terrain" | "outdoors" | "dark" | "schematic" | "blueprint";

const THEME_STYLE: Record<MapTheme, string> = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain:   "mapbox://styles/mapbox/satellite-v9",
  outdoors:  "mapbox://styles/mapbox/outdoors-v12",
  dark:      "mapbox://styles/mapbox/dark-v11",
  schematic: "mapbox://styles/mapbox/light-v11",
  blueprint: "mapbox://styles/mapbox/navigation-night-v1",
};

const THEME_OPTIONS: { value: MapTheme; label: string }[] = [
  { value: "satellite", label: "Satellite" },
  { value: "terrain",   label: "Terrain" },
  { value: "outdoors",  label: "Outdoors" },
  { value: "dark",      label: "Dark" },
  { value: "schematic", label: "Schematic" },
  { value: "blueprint", label: "Blueprint" },
];

// Dark-glass chrome surface for controls floating over the (dark) satellite
// map. Tokenised under .dark-surface — these float inside a .dark-surface
// scope (the map shell root carries it) so the values come from tokens.
const DARK_GLASS: React.CSSProperties = {
  background: "color-mix(in oklab, var(--ft-surface) 86%, transparent)",
  border: "1px solid var(--ft-border2)",
  backdropFilter: "blur(8px) saturate(140%)",
  boxShadow: "var(--ft-shadow)",
};

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

// Map the camp's grazing label to a design-system Status for the dot ramp.
function grazingToStatus(grazing: string): Status {
  switch (grazing) {
    case "Good":       return "good";
    case "Fair":       return "fair";
    case "Poor":       return "poor";
    case "Overgrazed": return "critical";
    default:           return "fair";
  }
}

// Responsive chrome: desktop keeps the split column + corner controls; phone
// turns the chrome into floating glass over a full-bleed map. CSS-only so it is
// SSR-safe (no `window` branch) and the desktop layout is byte-for-byte the
// existing one above 768px.
const RESPONSIVE_CSS = `
.ft-map-shell { display: flex; flex-direction: row; }
.ft-map-area { position: relative; flex: 1 1 auto; min-width: 0; }
.ft-map-camplist { flex: 0 0 300px; }
/* Phone bits hide on desktop. */
.ft-map-phone-topbar, .ft-map-phone-sheet, .ft-map-phone-zoom { display: none; }
/* When the dark header bar is present (desktop), nudge the Mapbox top-right
   nav/geolocate controls down so they clear the ~66px absolute header instead
   of hiding behind it. Scoped to this map area via .ft-map-has-header. */
.ft-map-has-header .mapboxgl-ctrl-top-right { margin-top: 66px; }
@media (max-width: 768px) {
  /* Phone has no desktop header → reset the control offset. */
  .ft-map-has-header .mapboxgl-ctrl-top-right { margin-top: 0; }
  /* Camp list overlays as a slide-in panel instead of a split column. */
  .ft-map-camplist {
    position: absolute !important; top: 0; right: 0; bottom: 0;
    flex-basis: auto; width: min(86vw, 320px); z-index: 30;
  }
  /* Desktop corner controls give way to the floating phone chrome. */
  .ft-map-desktop-only { display: none !important; }
  .ft-map-phone-topbar { display: flex !important; }
  .ft-map-phone-sheet { display: flex !important; }
  .ft-map-phone-zoom { display: flex !important; }
  /* Move the overlay-category selector to a horizontal-scroll chip row under
     the floating top bar. */
  .ft-map-overlay-bar {
    top: 64px !important; left: 8px !important; right: 8px !important;
    max-width: none !important; flex-wrap: nowrap !important;
    overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  .ft-map-overlay-bar::-webkit-scrollbar { display: none; }
  /* Lift the bottom-left action cluster above the floating bottom sheet so
     Move Mob / Draw never sit under it (the sheet is ~50px tall at bottom:8). */
  [data-testid="map-action-cluster"] { bottom: 64px !important; }
}
`;

// ── Main Component ────────────────────────────────────────────────────────────

export default function FarmMap({
  campData, onCampClick, className, drawMode = false,
  overlayMode: overlayModeProp, onOverlayChange, onBoundaryDrawn,
  latitude: farmLat, longitude: farmLng,
  onLongPress, eskomAreaId = null,
  headerTitle, headerSubtext, backHref, headerExtra,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [mapReady, setMapReady] = useState(false);
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);
  const [localOverlay, setLocalOverlay] = useState<OverlayMode>("grazing");
  const [layerState, updateLayers] = useLayerState();
  const [theme, setTheme] = useState<MapTheme>("satellite");
  const [showCampList, setShowCampList] = useState(false);

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
  const homeHref = backHref ?? (farmSlug ? `/${farmSlug}` : "/");

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

  // Re-apply terrain + sky + flyover after a style swap (changing mapStyle wipes
  // the user-added DEM source / sky layer). `style.load` fires once per new
  // style; keep the camera where it is rather than re-flying.
  const handleStyleData = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;
    if (!map.getSource("mapbox-dem")) {
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
      });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.2 });
    }
    if (!map.getLayer("sky")) {
      map.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [0.0, 0.0],
          "sky-atmosphere-sun-intensity": 15,
        },
      } as Parameters<typeof map.addLayer>[0]);
    }
  }, []);

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

  // Camp-list row → fly to the camp + open its popup (or feed move-mode). Mirrors
  // the polygon-click selection contract so the panel is a peer entry point.
  const handleCampRowClick = useCallback(
    (cd: CampData) => {
      const map = mapRef.current?.getMap();
      const geojson = cd.camp.geojson;
      if (map && geojson) {
        try {
          const geom = JSON.parse(geojson) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
          const ring =
            geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates[0]?.[0];
          if (ring && ring.length > 0) {
            const sumLng = ring.reduce((s, c) => s + (c[0] ?? 0), 0);
            const sumLat = ring.reduce((s, c) => s + (c[1] ?? 0), 0);
            const lng = sumLng / ring.length;
            const lat = sumLat / ring.length;
            map.flyTo({ center: [lng, lat], zoom: 15, duration: 1400 });
          }
        } catch {
          // ignore malformed geojson — selection still fires below
        }
      }
      onCampClick(cd.camp.camp_id);
    },
    [onCampClick]
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

  // Custom zoom for the phone bottom-right cluster (Mapbox NavigationControl is
  // hidden on phone via .ft-map-desktop-only).
  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: 300 });
  }, []);

  const locate = useCallback(() => {
    const lng = farmLng ?? 28.5;
    const lat = farmLat ?? -25.5;
    mapRef.current?.getMap()?.flyTo({ center: [lng, lat], zoom: 14, duration: 1400 });
  }, [farmLat, farmLng]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`dark-surface ft-map-shell ${className ?? ""}`}
      style={{ position: "relative", height: "100%", width: "100%" }}
    >
      <style>{RESPONSIVE_CSS}</style>

      {/* Map area (split column on desktop; full-bleed under the phone chrome). */}
      <div className={`ft-map-area${headerTitle ? " ft-map-has-header" : ""}`}>
        {/* ── Dark chrome header bar ──────────────────────────────────────── */}
        {headerTitle && (
          <div
            data-testid="map-header-bar"
            className="ft-map-desktop-only"
            style={{
              position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
              display: "flex", alignItems: "center", gap: 16,
              padding: "12px 16px",
              background: "color-mix(in oklab, var(--ft-bg) 88%, transparent)",
              backdropFilter: "blur(10px) saturate(140%)",
              borderBottom: "1px solid var(--ft-border2)",
            }}
          >
            <Link
              href={homeHref}
              aria-label="Back to farm home"
              className="ft-action-btn"
              style={{ color: "var(--ft-text)", flexShrink: 0 }}
            >
              <Icon.chevronL size={20} />
            </Link>
            <div style={{ minWidth: 0 }}>
              <h1
                className="ft-serif"
                style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.1, margin: 0, color: "var(--ft-text)" }}
              >
                {headerTitle}
              </h1>
              {headerSubtext && (
                <p
                  className="ft-mono"
                  style={{ fontSize: 11.5, color: "var(--ft-muted)", marginTop: 4, letterSpacing: ".02em" }}
                >
                  {headerSubtext}
                </p>
              )}
            </div>

            {/* Centred theme tabs (desktop). */}
            <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <Segmented<MapTheme>
                aria-label="Map theme"
                value={theme}
                onChange={setTheme}
                options={THEME_OPTIONS}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {headerExtra}
              <button
                type="button"
                onClick={() => setShowCampList((v) => !v)}
                aria-pressed={showCampList}
                className="ft-btn"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  background: showCampList ? "var(--ft-accent)" : undefined,
                  color: showCampList ? "var(--ft-on-accent)" : undefined,
                  borderColor: showCampList ? "transparent" : undefined,
                }}
              >
                <Icon.map size={15} />
                <span>CAMPS LIST</span>
              </button>
            </div>
          </div>
        )}

        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{ longitude: 28.5, latitude: -25.5, zoom: 2, pitch: 0, bearing: 0 }}
          style={{ width: "100%", height: "100%" }}
          mapStyle={THEME_STYLE[theme]}
          projection="globe"
          onLoad={handleMapLoad}
          onStyleData={handleStyleData}
          interactiveLayerIds={layerState.campOverlay ? ["camp-fill"] : []}
          onClick={layerState.campOverlay ? handleCampClick : undefined}
        >
          <GeolocateControl position="top-right" />
          {/* Desktop nav control; phone gets the custom bottom-right zoom cluster. */}
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

        {/* ── Phone floating glass top bar (back + camps pill + layers) ────── */}
        <div
          className="ft-map-phone-topbar"
          style={{
            position: "absolute", top: 8, left: 8, right: 8, zIndex: 22,
            alignItems: "center", gap: 8,
            padding: "8px 10px", borderRadius: "var(--ft-card-r)",
            ...DARK_GLASS,
          }}
        >
          <Link
            href={homeHref}
            aria-label="Back to farm home"
            style={{ display: "inline-flex", color: "var(--ft-text)", flexShrink: 0 }}
          >
            <Icon.chevronL size={20} />
          </Link>
          <span
            className="ft-pill ft-pill-muted"
            style={{ flex: 1, minWidth: 0, justifyContent: "flex-start" }}
          >
            <span className="ft-serif" style={{ fontWeight: 500 }}>
              {headerTitle ?? "Farm Map"}
            </span>
            {headerSubtext && (
              <span className="ft-mono" style={{ marginLeft: 6, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                · {headerSubtext.split("·")[0]?.trim()}
              </span>
            )}
          </span>
          <button
            type="button"
            aria-label="Camps list"
            onClick={() => setShowCampList((v) => !v)}
            aria-pressed={showCampList}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 10, flexShrink: 0, cursor: "pointer",
              border: "none",
              background: showCampList ? "var(--ft-accent)" : "transparent",
              color: showCampList ? "var(--ft-on-accent)" : "var(--ft-text)",
            }}
          >
            <Icon.layers size={18} />
          </button>
        </div>

        {/* Overlay selector toolbar (camp overlay color ramp) — dark-glass pills,
            accent active state. Engine/handler logic unchanged; visual only. On
            phone this becomes a horizontal-scroll chip row (.ft-map-overlay-bar). */}
        <div
          className="ft-map-overlay-bar"
          style={{
            // Clear the absolute dark header on desktop; the phone media query
            // re-anchors this to top:64 under the floating glass top bar.
            position: "absolute", top: headerTitle ? 78 : 12, left: 12, zIndex: 10,
            display: "flex", flexWrap: "wrap", gap: 4, padding: 4,
            // Leave a right gutter so the wrapped row never slides under the
            // top-right Mapbox nav/geolocate control column on narrow screens.
            maxWidth: "calc(100% - 78px)",
            borderRadius: "var(--ft-card-r)", ...DARK_GLASS,
          }}
        >
          {OVERLAY_OPTIONS.map((opt) => {
            const on = activeOverlay === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setOverlay(opt.value)}
                style={{
                  padding: "7px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 500,
                  cursor: "pointer", border: "none", whiteSpace: "nowrap", transition: "all 0.15s",
                  fontFamily: "var(--ft-font-sans, inherit)",
                  background: on ? "var(--ft-accent)" : "transparent",
                  color: on ? "var(--ft-on-accent)" : "var(--ft-muted)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <LayerToggle value={layerState} onChange={updateLayers} />

        {isDrawing && (
          <div
            style={{
              position: "absolute", top: headerTitle ? 78 : 60, left: "50%", transform: "translateX(-50%)",
              zIndex: 10, display: "flex", alignItems: "center", gap: 8,
              padding: "10px 18px", borderRadius: 999,
              ...DARK_GLASS,
              border: "1px solid var(--ft-good)", color: "var(--ft-text)",
              fontSize: 13, fontWeight: 500, whiteSpace: "nowrap",
            }}
          >
            <Icon.edit size={15} style={{ color: "var(--ft-good)" }} />
            <span>Click to place points. <strong style={{ color: "var(--ft-good)" }}>Double-click</strong> the last point to finish.</span>
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
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "9px 14px", borderRadius: 10, fontSize: 13,
              whiteSpace: "nowrap", fontWeight: 500,
              ...DARK_GLASS,
              background: isMovingMob ? "var(--ft-accent)" : DARK_GLASS.background,
              border: isMovingMob ? "1px solid transparent" : DARK_GLASS.border,
              color: isMovingMob ? "var(--ft-on-accent)" : "var(--ft-text)",
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            <Icon.move size={15} />
            {isMovingMob ? "Exit Move" : "Move Mob"}
          </button>

          <button
            onClick={() => dispatch({ type: "startDrawing" })}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "9px 14px", borderRadius: 10, fontSize: 13,
              whiteSpace: "nowrap", fontWeight: 500,
              ...DARK_GLASS,
              background: isDrawing ? "var(--ft-good)" : DARK_GLASS.background,
              border: isDrawing ? "1px solid transparent" : DARK_GLASS.border,
              color: isDrawing ? "var(--ft-on-accent)" : "var(--ft-text)",
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            {isDrawing ? <Icon.close size={15} /> : <Icon.plus size={15} />}
            {isDrawing ? "Cancel Drawing" : "Draw Camp Boundary"}
          </button>
        </div>

        {/* ── Phone bottom-right zoom + locate cluster ────────────────────── */}
        <div
          className="ft-map-phone-zoom"
          style={{
            position: "absolute", bottom: 110, right: 12, zIndex: 12,
            flexDirection: "column", gap: 8,
          }}
        >
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)} style={phoneZoomBtn}>
            <Icon.plus size={18} />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)} style={phoneZoomBtn}>
            <span style={{ fontSize: 20, lineHeight: 1, fontWeight: 600 }}>−</span>
          </button>
          <button type="button" aria-label="Locate farm" onClick={locate} style={phoneZoomBtn}>
            <Icon.locate size={18} />
          </button>
        </div>

        {/* ── Phone bottom sheet hint ─────────────────────────────────────── */}
        <div
          className="ft-map-phone-sheet"
          style={{
            position: "absolute", left: 8, right: 8, bottom: 8, zIndex: 12,
            alignItems: "center", justifyContent: "space-between", gap: 8,
            padding: "10px 14px", borderRadius: "var(--ft-card-r)",
            ...DARK_GLASS, color: "var(--ft-text)",
          }}
        >
          <span style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--ft-fair)" }}>★</span>
            Tap any camp to inspect · {campData.length} camp{campData.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            aria-label="Locate"
            onClick={locate}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 10, flexShrink: 0, cursor: "pointer",
              border: "1px solid var(--ft-border2)", background: "transparent", color: "var(--ft-text)",
            }}
          >
            <Icon.locate size={16} />
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

      {/* ── Right CAMP-LIST panel (split column desktop / slide-in phone) ──── */}
      {showCampList && (
        <aside
          data-testid="map-camp-list"
          className="ft-map-camplist ft-scrollbar"
          style={{
            display: "flex", flexDirection: "column",
            borderLeft: "1px solid var(--ft-border2)",
            background: "var(--ft-surface)",
            color: "var(--ft-text)",
            overflowY: "auto",
            boxShadow: "var(--ft-shadow-lg)",
          }}
        >
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px", borderBottom: "1px solid var(--ft-border2)",
              position: "sticky", top: 0, zIndex: 1,
              background: "var(--ft-surface)",
            }}
          >
            <span
              className="ft-mono"
              style={{ fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ft-muted)" }}
            >
              All camps · {campData.length}
            </span>
            <button
              type="button"
              aria-label="Close camps list"
              onClick={() => setShowCampList(false)}
              className="ft-action-btn"
              style={{ color: "var(--ft-muted)" }}
            >
              <Icon.close size={16} />
            </button>
          </div>

          {campData.length === 0 ? (
            <p style={{ padding: 16, fontSize: 13, color: "var(--ft-muted)" }}>No camps yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {campData.map((cd) => (
                <li key={cd.camp.camp_id}>
                  <button
                    type="button"
                    onClick={() => handleCampRowClick(cd)}
                    className="ft-row-hover"
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 16px", border: "none", background: "transparent",
                      cursor: "pointer", textAlign: "left", color: "var(--ft-text)",
                      borderBottom: "1px solid var(--ft-border)",
                    }}
                  >
                    <StatusDot status={grazingToStatus(cd.grazing)} size={9} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {cd.camp.camp_name}
                    </span>
                    <span className="ft-mono" style={{ fontSize: 11.5, color: "var(--ft-muted)", flexShrink: 0 }}>
                      {cd.stats.total} head
                      {cd.camp.size_hectares != null ? ` · ${cd.camp.size_hectares} ha` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}

const phoneZoomBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 40, height: 40, borderRadius: 12, cursor: "pointer",
  border: "1px solid var(--ft-border2)",
  background: "color-mix(in oklab, var(--ft-surface) 88%, transparent)",
  backdropFilter: "blur(8px) saturate(140%)",
  boxShadow: "var(--ft-shadow)",
  color: "var(--ft-text)",
};
