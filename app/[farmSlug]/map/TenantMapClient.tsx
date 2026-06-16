"use client";

/**
 * TenantMapClient — client boundary for `/<farmSlug>/map` (issue #256).
 *
 * Mirrors AdminMapClient but strips admin-only chrome (Log-at-Spot sheet,
 * tier-gated upgrade toast, "Route today" link). The page is reachable for
 * every tenant role, so this client only wires:
 *
 *   - Lazy-loaded FarmMap shell (Mapbox cannot SSR — react-map-gl reads
 *     `window` during mount).
 *   - Mode-flip → router.refresh, so flipping the species switcher in the
 *     app shell re-fetches camps from the species-scoped facade in
 *     `page.tsx` without a full page reload.
 *   - `data-testid="tenant-map"` on the outer container so the Playwright
 *     spec for #256 can assert the map shell mounted.
 */

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { CampData } from "@/components/map/layers/CampLayer";
import { useFarmModeSafe } from "@/lib/farm-mode";
import CampPresenceFallback from "@/components/map/CampPresenceFallback";

// Lazy-load FarmMap so mapbox-gl + react-map-gl land in a separate client
// chunk and never reach the server bundle (matches DashboardClient pattern).
const FarmMap = dynamic(() => import("@/components/map/FarmMap"), {
  ssr: false,
  loading: () => (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: "#1A1510" }}
      aria-hidden
    >
      <div className="text-center">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
          style={{ borderColor: "#8B6914", borderTopColor: "transparent" }}
        />
        <p className="text-sm" style={{ color: "#8B6914" }}>
          Loading satellite map…
        </p>
      </div>
    </div>
  ),
});

interface Props {
  campData: CampData[];
  farmLat: number | null;
  farmLng: number | null;
  farmSlug: string;
  /** Mono geometry sub-line for the dark map header (computed server-side). */
  headerSubtext?: string;
}

export default function TenantMapClient({
  campData,
  farmLat,
  farmLng,
  farmSlug,
  headerSubtext,
}: Props) {
  const router = useRouter();
  const { mode } = useFarmModeSafe();
  const lastModeRef = useRef(mode);

  // Re-render the server page when the FarmMode cookie flips so the
  // species-scoped camp.findMany re-runs with the new mode.
  useEffect(() => {
    if (lastModeRef.current !== mode) {
      lastModeRef.current = mode;
      router.refresh();
    }
  }, [mode, router]);

  // Camp clicks are handled by FarmMap's built-in popup. No-op here keeps
  // the popup live without forcing this surface to host a side panel.
  const handleCampClick = useCallback((_campId: string) => {}, []);

  return (
    <>
      <div
        data-testid="tenant-map"
        style={{
          position: "relative",
          width: "100%",
          // The dark chrome header now lives INSIDE FarmMap, so the map shell
          // owns the full viewport band (minus the app chrome + outer page
          // padding). `100dvh` honours the dynamic viewport on mobile.
          height: "calc(100dvh - 5rem)",
          minHeight: "320px",
          borderRadius: "var(--ft-card-r)",
          overflow: "hidden",
        }}
      >
        <FarmMap
          campData={campData}
          onCampClick={handleCampClick}
          latitude={farmLat}
          longitude={farmLng}
          headerTitle="Farm Map"
          headerSubtext={headerSubtext}
          backHref={`/${farmSlug}`}
        />
      </div>

      {/*
        Issue #322: camps without a drawn boundary are skipped by the GeoJSON
        builder and would otherwise be unreachable on this surface. The
        fallback list + setup-state CTA is a SIBLING to the map container (NOT
        inside FarmMap.tsx — PR #305 owns that file), so it flows below the
        map instead of overlaying the satellite view. It self-hides when every
        camp already has geometry.
      */}
      <CampPresenceFallback
        campData={campData}
        farmSlug={farmSlug}
        onCampClick={handleCampClick}
      />
    </>
  );
}
