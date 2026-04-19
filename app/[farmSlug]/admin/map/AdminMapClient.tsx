"use client";

/**
 * AdminMapClient — thin client boundary that wraps FarmMap + wires the
 * long-press → LogAtSpotSheet state. Basic-tier farms get a small upgrade
 * toast instead of the sheet (tier gating lives here, not inside the
 * FarmMap shell, to keep the shell generic).
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import FarmMap from "@/components/map/FarmMap";
import LogAtSpotSheet from "@/components/map/LogAtSpotSheet";
import type { CampData } from "@/components/map/layers/CampLayer";

interface Props {
  farmSlug: string;
  tier: string;
  campData: CampData[];
  farmLat: number | null;
  farmLng: number | null;
}

export default function AdminMapClient({
  farmSlug,
  tier,
  campData,
  farmLat,
  farmLng,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lngLat, setLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [upgradeToast, setUpgradeToast] = useState(false);

  const handleCampClick = useCallback((_campId: string) => {
    // Camp click routing is handled by FarmMap's built-in popup.
  }, []);

  const handleLongPress = useCallback(
    (pt: { lng: number; lat: number }) => {
      if (tier === "basic") {
        setUpgradeToast(true);
        // Auto-dismiss after 4 s; no toast library in this repo.
        setTimeout(() => setUpgradeToast(false), 4000);
        return;
      }
      setLngLat(pt);
      setSheetOpen(true);
    },
    [tier],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 12rem)" }}>
      <FarmMap
        campData={campData}
        onCampClick={handleCampClick}
        onLongPress={handleLongPress}
        latitude={farmLat}
        longitude={farmLng}
      />

      <LogAtSpotSheet
        open={sheetOpen}
        lngLat={lngLat}
        farmSlug={farmSlug}
        onClose={() => setSheetOpen(false)}
      />

      {upgradeToast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] rounded-xl px-5 py-3 shadow-lg flex items-center gap-3"
          style={{ background: "#1C1815", color: "#F5EBD4", border: "1px solid rgba(196,144,48,0.4)" }}
        >
          <span className="text-sm">Log-at-spot is an Advanced-tier feature.</span>
          <Link
            href={`/${farmSlug}/subscribe/upgrade`}
            className="text-xs font-semibold rounded-md px-2.5 py-1"
            style={{ background: "#0ea5e9", color: "#fff" }}
          >
            Upgrade
          </Link>
        </div>
      )}
    </div>
  );
}
