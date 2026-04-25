/**
 * Shared utilities for FarmMap layer components.
 *
 * All helpers are pure. Layers import only from here; cross-layer imports are
 * forbidden (see Wave 2D scope).
 */

import { centroid } from "@turf/centroid";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { Camp } from "@/lib/types";

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T; stale?: boolean }
  | { status: "error"; error: string };

/**
 * Fetch JSON with graceful 404 handling. A layer whose endpoint 404s (because
 * Wave 2C hasn't shipped yet) should render an "Unavailable" state, not crash.
 *
 * Pass an `AbortSignal` via `signal` to cancel in-flight requests on unmount
 * or dep change. An `AbortError` resolves to `null` (caller should ignore it).
 */
export async function fetchLayerJson<T>(
  url: string,
  options?: { signal?: AbortSignal },
): Promise<FetchState<T> | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: options?.signal });
    if (res.status === 404) return { status: "error", error: "unavailable" };
    if (!res.ok) return { status: "error", error: `http_${res.status}` };
    const body = (await res.json()) as T & { _stale?: boolean };
    return { status: "ready", data: body, stale: Boolean(body?._stale) };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return null;
    return { status: "error", error: e instanceof Error ? e.message : "fetch_failed" };
  }
}

// ── Centroid helpers ──────────────────────────────────────────────────────────

/**
 * Compute the centroid of a camp's stored GeoJSON geometry. Returns null if
 * the camp has no geojson or the geojson fails to parse.
 */
export function getCampCentroid(camp: Camp): { lng: number; lat: number } | null {
  if (!camp.geojson) return null;
  try {
    const geom = JSON.parse(camp.geojson) as Geometry;
    const feature: Feature<Geometry> = { type: "Feature", geometry: geom, properties: {} };
    const c = centroid(feature) as Feature<Point>;
    const [lng, lat] = c.geometry.coordinates;
    return { lng, lat };
  } catch {
    return null;
  }
}

/**
 * Build a centroid lookup map keyed by camp_id. Useful for layers that need to
 * anchor pins on camp centres (e.g. tasks without explicit lat/lng).
 */
export function buildCampCentroidMap(camps: Camp[]): Record<string, { lng: number; lat: number }> {
  const out: Record<string, { lng: number; lat: number }> = {};
  for (const c of camps) {
    const centre = getCampCentroid(c);
    if (centre) out[c.camp_id] = centre;
  }
  return out;
}

// ── Empty FeatureCollection ──────────────────────────────────────────────────

export const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };
