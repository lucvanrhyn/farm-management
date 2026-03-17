"use client";

import { MapContainer, TileLayer } from "react-leaflet";
import type { Camp, CampStats } from "@/lib/types";
import CampPolygon from "./CampPolygon";

export interface CampData {
  camp: Camp;
  stats: CampStats;
  grazing: string;
}

interface Props {
  campData: CampData[];
  onCampClick: (campId: string) => void;
}

export default function FarmMap({ campData, onCampClick }: Props) {
  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <MapContainer
        center={[-25.5, 28.5]}
        zoom={13}
        style={{ height: "100%", width: "100%", background: "#1A1510" }}
        zoomControl={true}
      >
        {/* ESRI World Imagery — satellite tiles, no API key required */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
          maxZoom={19}
        />
        {campData.map(({ camp, stats, grazing }) => (
          <CampPolygon
            key={camp.camp_id}
            camp={camp}
            stats={stats}
            grazing={grazing}
            onClick={onCampClick}
          />
        ))}
      </MapContainer>

      {/* Draw Camp Boundaries — disabled placeholder */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          right: 16,
          zIndex: 1000,
        }}
      >
        <button
          disabled
          title="Coming soon — Draw GPS boundaries for each camp"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            background: "rgba(36,28,20,0.88)",
            border: "1px solid rgba(140,100,60,0.25)",
            color: "rgba(210,180,140,0.4)",
            cursor: "not-allowed",
            backdropFilter: "blur(6px)",
          }}
        >
          <span style={{ fontSize: 14 }}>✦</span>
          Draw Camp Boundaries
          <span
            style={{
              fontSize: 9,
              padding: "1px 5px",
              borderRadius: 4,
              background: "rgba(139,105,20,0.2)",
              color: "#8B6914",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Coming Soon
          </span>
        </button>
      </div>
    </div>
  );
}
