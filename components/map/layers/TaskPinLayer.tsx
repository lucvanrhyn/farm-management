"use client";

/**
 * TaskPinLayer — renders farm tasks as priority-colored "live" pins.
 *
 * Fetch: GET /api/{farmSlug}/map/task-pins?status={statusFilter}
 * Source shape: { tasks: Array<{ id, title, priority, status, lat?, lng?, campId? }> }
 *
 * Rendering rules:
 *  - If task has lat && lng → use them.
 *  - Else if task has campId and the camp's GeoJSON is available → centroid.
 *  - Else → skip the task (no pin).
 *
 * Overhaul (Wave map-pixel): pins are HTML <Marker>s wearing the shared
 * `.ft-pulse-soft` accent halo so live tasks/fires read as gently pulsing
 * markers (Mapbox `circle` paint cannot animate without a per-frame interval).
 * The fetch/centroid wiring is unchanged.
 */

import { useEffect, useState } from "react";
import { Marker } from "react-map-gl/mapbox";
import type { Camp } from "@/lib/types";
import { fetchLayerJson, buildCampCentroidMap, type FetchState } from "./_utils";

interface TaskPin {
  id: string;
  title: string;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: string;
  lat?: number;
  lng?: number;
  campId?: string;
}

interface TaskPinsPayload {
  tasks: TaskPin[];
}

interface Props {
  farmSlug: string;
  camps: Camp[];
  statusFilter?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#dc2626",
  high:   "#f97316",
  medium: "#eab308",
  low:    "#3b82f6",
};

interface PlacedPin {
  id: string;
  title: string;
  color: string;
  lng: number;
  lat: number;
}

export default function TaskPinLayer({ farmSlug, camps, statusFilter }: Props) {
  const fetchUrl = statusFilter
    ? `/api/${encodeURIComponent(farmSlug)}/map/task-pins?status=${encodeURIComponent(statusFilter)}`
    : `/api/${encodeURIComponent(farmSlug)}/map/task-pins`;
  const [result, setResult] = useState<{ url: string; state: FetchState<TaskPinsPayload> } | null>(null);

  const state: FetchState<TaskPinsPayload> =
    result?.url === fetchUrl ? result.state : { status: "loading" };

  useEffect(() => {
    const ctrl = new AbortController();
    const url = fetchUrl;
    fetchLayerJson<TaskPinsPayload>(url, { signal: ctrl.signal }).then((r) => {
      if (!r) return; // aborted
      setResult({ url, state: r });
    });
    return () => ctrl.abort();
  }, [fetchUrl]);

  if (state.status !== "ready") return null;

  const centroidMap = buildCampCentroidMap(camps);
  const pins: PlacedPin[] = [];

  for (const t of state.data.tasks ?? []) {
    let lng: number | null = null;
    let lat: number | null = null;
    if (typeof t.lng === "number" && typeof t.lat === "number") {
      lng = t.lng;
      lat = t.lat;
    } else if (t.campId && centroidMap[t.campId]) {
      lng = centroidMap[t.campId].lng;
      lat = centroidMap[t.campId].lat;
    }
    if (lng == null || lat == null) continue;

    pins.push({
      id: t.id,
      title: t.title,
      color: PRIORITY_COLORS[t.priority ?? "medium"] ?? PRIORITY_COLORS.medium,
      lng,
      lat,
    });
  }

  if (pins.length === 0) return null;

  return (
    <>
      {pins.map((p) => (
        <Marker key={p.id} longitude={p.lng} latitude={p.lat} anchor="bottom">
          <div
            data-testid={`task-pin-${p.id}`}
            title={p.title}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              pointerEvents: "none",
            }}
          >
            {/* Pulsing dot — the .ft-pulse-soft accent halo telegraphs "live". */}
            <span
              className="ft-pulse-soft"
              style={{
                display: "block",
                width: 14,
                height: 14,
                borderRadius: 999,
                background: p.color,
                border: "2px solid #14110D",
                boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
              }}
            />
            <span
              className="ft-mono"
              style={{
                fontSize: 10.5,
                lineHeight: 1.1,
                maxWidth: 120,
                padding: "2px 6px",
                borderRadius: 6,
                background: "rgba(20,17,13,0.86)",
                color: "#F5EBD4",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {p.title}
            </span>
          </div>
        </Marker>
      ))}
    </>
  );
}
