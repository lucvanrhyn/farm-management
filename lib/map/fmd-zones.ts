/**
 * lib/map/fmd-zones.ts
 *
 * Pure helpers for computing the farm centroid from Camp geojson strings
 * and for point-in-polygon testing against the FMD-zone geojson shipped
 * at public/gis/fmd-zones.geojson.
 *
 * No DOM/node-specific I/O here — callers (server page, tests) read the
 * file themselves and pass features in. Keeps these helpers unit-testable
 * without fs mocking.
 *
 * Ray-casting algorithm: we accept GeoJSON Polygon and MultiPolygon
 * geometries. All other geometry types are ignored.
 */

import centroidOfFeature from "@turf/centroid";
import { polygon as turfPolygon } from "@turf/helpers";

// ── Types ────────────────────────────────────────────────────────────────

export interface Point2D {
  lng: number;
  lat: number;
}

type PolygonRings = number[][][];           // [ring][vertex][lng,lat]
type MultiPolygonRings = number[][][][];    // [polygon][ring][vertex][lng,lat]

interface FmdFeature {
  properties?: Record<string, unknown>;
  geometry?:
    | { type: "Polygon"; coordinates: PolygonRings }
    | { type: "MultiPolygon"; coordinates: MultiPolygonRings }
    | { type: string; coordinates: unknown };
}

// ── Centroid ─────────────────────────────────────────────────────────────

/**
 * Compute the centroid (lng/lat) of a set of camp polygons, given the raw
 * geojson strings stored on `Camp.geojson`. Returns null if no valid
 * polygons can be parsed (e.g. fresh farm with no camps yet).
 *
 * We build a single FeatureCollection out of all camps and feed it to
 * @turf/centroid — that gives an area-weighted centre that degrades
 * gracefully when only one polygon is present.
 */
export function computeFarmCentroid(geojsonStrings: Array<string | null | undefined>): Point2D | null {
  const polygons: ReturnType<typeof turfPolygon>[] = [];

  for (const raw of geojsonStrings) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as FmdFeature["geometry"] | FmdFeature | null;
      if (!parsed) continue;
      // Accept both bare geometries and full Feature shapes.
      const geom =
        "geometry" in (parsed as object)
          ? (parsed as FmdFeature).geometry
          : (parsed as FmdFeature["geometry"]);
      if (!geom) continue;
      if (geom.type === "Polygon") {
        polygons.push(turfPolygon(geom.coordinates as PolygonRings));
      } else if (geom.type === "MultiPolygon") {
        for (const ring of geom.coordinates as MultiPolygonRings) {
          polygons.push(turfPolygon(ring));
        }
      }
    } catch {
      // Skip malformed records — computeFarmCentroid is best-effort.
    }
  }

  if (polygons.length === 0) return null;

  // Average the individual centroids. Turf's `centroid` returns a Point.
  let sumLng = 0;
  let sumLat = 0;
  for (const p of polygons) {
    const c = centroidOfFeature(p);
    const [lng, lat] = c.geometry.coordinates;
    sumLng += lng;
    sumLat += lat;
  }
  return { lng: sumLng / polygons.length, lat: sumLat / polygons.length };
}

// ── Point-in-polygon ─────────────────────────────────────────────────────

/**
 * Standard ray-casting algorithm. `point` is [lng, lat]; `ring` is an
 * array of [lng, lat] vertices (closed or not — the algorithm is robust
 * to the last==first convention).
 */
function pointInRing(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: [number, number], rings: PolygonRings): boolean {
  if (rings.length === 0) return false;
  // First ring is outer; subsequent rings are holes.
  if (!pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false; // in a hole
  }
  return true;
}

/**
 * Returns the zone name/id the point is inside, or null if outside all
 * zones. Only Polygon and MultiPolygon features are honoured; others are
 * silently skipped.
 *
 * "Zone name" is pulled from properties in this order: zoneName, name,
 * zone, ZONE. Falls back to the feature index if none are present.
 */
export function pointInFmdZone(
  point: Point2D,
  features: FmdFeature[],
): string | null {
  const pt: [number, number] = [point.lng, point.lat];
  for (let idx = 0; idx < features.length; idx++) {
    const f = features[idx];
    const geom = f.geometry;
    if (!geom) continue;
    let inside = false;
    if (geom.type === "Polygon") {
      inside = pointInPolygon(pt, geom.coordinates as PolygonRings);
    } else if (geom.type === "MultiPolygon") {
      for (const polygonRings of geom.coordinates as MultiPolygonRings) {
        if (pointInPolygon(pt, polygonRings)) {
          inside = true;
          break;
        }
      }
    }
    if (inside) {
      const props = f.properties ?? {};
      const name =
        (props.zoneName as string | undefined) ??
        (props.name as string | undefined) ??
        (props.zone as string | undefined) ??
        (props.ZONE as string | undefined) ??
        `Zone ${idx + 1}`;
      return name;
    }
  }
  return null;
}
