"use client";

/**
 * EskomBannerLayer — renders a top banner above the map with current
 * load-shedding status for a given EskomSePush area ID.
 *
 * NOT a Mapbox layer; this is a plain React banner element positioned
 * absolutely inside the FarmMap container. If `areaId` is null the banner
 * does not render.
 *
 * Fetch: GET /api/map/gis/eskom-se-push/status/{areaId}
 * Source shape: { stage: number, nextStart?: string, nextEnd?: string, area?: string }
 */

import { useEffect, useState } from "react";
import { fetchLayerJson, type FetchState } from "./_utils";

interface EskomStatus {
  stage: number;
  nextStart?: string;
  nextEnd?: string;
  area?: string;
}

interface Props {
  areaId: string | null;
}

function stageColor(stage: number): { bg: string; fg: string } {
  if (stage <= 0) return { bg: "rgba(34,197,94,0.15)", fg: "#4ade80" };
  if (stage <= 2) return { bg: "rgba(251,191,36,0.15)", fg: "#fbbf24" };
  if (stage <= 4) return { bg: "rgba(251,146,60,0.15)", fg: "#fb923c" };
  return { bg: "rgba(239,68,68,0.18)", fg: "#f87171" };
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function EskomBannerLayer({ areaId }: Props) {
  const [state, setState] = useState<FetchState<EskomStatus>>({ status: "idle" });

  useEffect(() => {
    if (!areaId) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchLayerJson<EskomStatus>(`/api/map/gis/eskom-se-push/status/${encodeURIComponent(areaId)}`).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => { cancelled = true; };
  }, [areaId]);

  if (!areaId) return null;
  if (state.status !== "ready") return null;

  const { stage, nextStart, nextEnd, area } = state.data;
  const colors = stageColor(stage);
  const label = stage <= 0 ? "No load-shedding" : `Stage ${stage}`;
  const window = nextStart ? ` — next ${formatTime(nextStart)}${nextEnd ? `–${formatTime(nextEnd)}` : ""}` : "";

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 12,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        borderRadius: 10,
        background: colors.bg,
        backdropFilter: "blur(8px)",
        border: `1px solid ${colors.fg}44`,
        color: colors.fg,
        fontSize: 12,
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: colors.fg }} />
      <span>⚡ {label}{area ? ` · ${area}` : ""}{window}</span>
    </div>
  );
}
