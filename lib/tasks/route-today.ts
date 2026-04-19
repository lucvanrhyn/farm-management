/**
 * lib/tasks/route-today.ts
 *
 * Pure helpers for Wave 3E's "Route Today" page:
 *   1. `dayWindowJohannesburg(date)` — returns the UTC [gte, lt) interval
 *      covering the Africa/Johannesburg calendar day that contains `date`.
 *      SAST is UTC+2 year-round (no DST), so midnight SAST is 22:00 UTC on
 *      the previous civil day.
 *
 *   2. `buildRouteToday({ prisma, date, farmCentre })` — loads all pending
 *      TaskOccurrences in that day window, resolves each to a `{lng,lat}` pin
 *      (prefer explicit task.lat/task.lng, else the camp's GeoJSON centroid,
 *      else skip), and computes a nearest-neighbour tour through the pins
 *      starting at `farmCentre` (or the first pin if centre is null).
 *
 * The function is deliberately pure over the Prisma shape — it only depends
 * on `prisma.taskOccurrence.findMany`, which makes unit-testing trivial
 * without spinning up a real DB.
 */

import { centroid as turfCentroid } from "@turf/centroid";
import type { Feature, FeatureCollection, LineString, Point, Polygon, Geometry } from "geojson";

// ── Day window ───────────────────────────────────────────────────────────────

/**
 * SAST is UTC+2 with no DST — so the SA calendar day that contains `date`
 * starts at 22:00 UTC of the previous civil day and ends at 22:00 UTC of the
 * same civil day as the SAST midnight-to-midnight window.
 */
export function dayWindowJohannesburg(date: Date): { dayStart: Date; dayEnd: Date } {
  // Shift the instant into SAST, then zero the time-of-day components.
  const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
  const sast = new Date(date.getTime() + SAST_OFFSET_MS);
  const sastMidnightUtcMs = Date.UTC(
    sast.getUTCFullYear(),
    sast.getUTCMonth(),
    sast.getUTCDate(),
  );
  // Convert SAST midnight back to UTC — subtract the offset.
  const dayStart = new Date(sastMidnightUtcMs - SAST_OFFSET_MS);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CampRef {
  campId: string;
  campName: string;
  geojson: string | null;
}

export interface RouteTodayInput {
  /**
   * Minimum Prisma surface area; kept structural to stay test-friendly.
   * We only query TaskOccurrence with `include: { task: true }` — there is
   * no Prisma relation from `Task.campId` to Camp, so the caller passes a
   * `campsById` lookup for centroid fallback.
   */
  /**
   * Structural Prisma surface. We widen to `findMany(args: any)` so the
   * real `PrismaClient` satisfies this type (it has many optional keys like
   * `select`/`distinct`/`take` we don't care about). The call-site passes
   * our exact arg shape, and the test mock checks that the `where` was
   * built correctly.
   */
  /**
   * Structural Prisma surface — kept minimal so mocks are trivial. The real
   * `PrismaClient` is structurally compatible after a single-line cast at
   * the call-site (see `app/[farmSlug]/admin/map/route-today/page.tsx`).
   */
  prisma: {
    taskOccurrence: {
      findMany: (args: {
        where: { status: string; occurrenceAt: { gte: Date; lt: Date } };
        include: { task: true };
        orderBy?: unknown;
      }) => Promise<RawOccurrence[]>;
    };
  };
  date: Date;
  /** If null, the tour starts at the first resolved pin. */
  farmCentre: { lng: number; lat: number } | null;
  /**
   * Optional camp lookup for centroid fallback. Keyed by Camp.campId.
   * When omitted, pins with only a campId (no explicit lat/lng) are skipped.
   */
  campsById?: Record<string, CampRef>;
}

interface RawOccurrence {
  id: string;
  occurrenceAt: Date;
  status: string;
  taskId: string;
  task: {
    id: string;
    title: string;
    lat: number | null;
    lng: number | null;
    campId: string | null;
    priority: string | null;
  };
}

export interface RouteTodayPinProperties {
  seq: number;
  taskId: string;
  occurrenceId: string;
  title: string;
  priority: string;
  campName: string | null;
}

export type RouteTodayPin = Feature<Point, RouteTodayPinProperties>;

export interface RouteTodayResult {
  pins: RouteTodayPin[];
  tour: Feature<LineString, { pinCount: number }>;
}

// ── Core: load + resolve pins + NN order ─────────────────────────────────────

export async function buildRouteToday(input: RouteTodayInput): Promise<RouteTodayResult> {
  const { prisma, date, farmCentre, campsById } = input;
  const { dayStart, dayEnd } = dayWindowJohannesburg(date);

  const rows = await prisma.taskOccurrence.findMany({
    where: {
      status: "pending",
      occurrenceAt: { gte: dayStart, lt: dayEnd },
    },
    include: { task: true },
    orderBy: { occurrenceAt: "asc" },
  });

  // Resolve each occurrence to a coordinate (or skip if unresolvable).
  interface Resolved {
    occurrenceId: string;
    taskId: string;
    title: string;
    priority: string;
    campName: string | null;
    lng: number;
    lat: number;
  }

  const resolved: Resolved[] = [];
  for (const row of rows) {
    const camp =
      row.task.campId && campsById ? campsById[row.task.campId] ?? null : null;
    const pt = resolveTaskCoordinate(row.task, camp);
    if (!pt) continue;
    resolved.push({
      occurrenceId: row.id,
      taskId: row.task.id,
      title: row.task.title,
      priority: row.task.priority ?? "normal",
      campName: camp?.campName ?? null,
      lng: pt.lng,
      lat: pt.lat,
    });
  }

  if (resolved.length === 0) {
    return {
      pins: [],
      tour: {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [] },
        properties: { pinCount: 0 },
      },
    };
  }

  // Nearest-neighbour tour.
  const start: { lng: number; lat: number } =
    farmCentre ?? { lng: resolved[0].lng, lat: resolved[0].lat };

  const pool = [...resolved];
  const ordered: Resolved[] = [];
  let cursor = start;
  while (pool.length > 0) {
    let bestIdx = 0;
    let bestDist = haversineKm(cursor, pool[0]);
    for (let i = 1; i < pool.length; i++) {
      const d = haversineKm(cursor, pool[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [chosen] = pool.splice(bestIdx, 1);
    ordered.push(chosen);
    cursor = { lng: chosen.lng, lat: chosen.lat };
  }

  const pins: RouteTodayPin[] = ordered.map((r, idx) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lng, r.lat] },
    properties: {
      seq: idx + 1,
      taskId: r.taskId,
      occurrenceId: r.occurrenceId,
      title: r.title,
      priority: r.priority,
      campName: r.campName,
    },
  }));

  // Tour starts at farm centre (when provided) so the first leg is visible.
  const coords: [number, number][] = [];
  if (farmCentre) coords.push([farmCentre.lng, farmCentre.lat]);
  for (const r of ordered) coords.push([r.lng, r.lat]);

  return {
    pins,
    tour: {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { pinCount: ordered.length },
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveTaskCoordinate(
  task: RawOccurrence["task"],
  camp: CampRef | null,
): { lng: number; lat: number } | null {
  if (typeof task.lat === "number" && typeof task.lng === "number") {
    return { lng: task.lng, lat: task.lat };
  }
  if (!camp?.geojson) return null;
  try {
    const parsed: Geometry | { geometry?: Geometry } = JSON.parse(camp.geojson);
    const geom: Geometry | undefined =
      "type" in parsed && (parsed as Geometry).type
        ? (parsed as Geometry)
        : (parsed as { geometry?: Geometry }).geometry;
    if (!geom) return null;
    const feature: Feature<Geometry> = { type: "Feature", geometry: geom, properties: {} };
    const c = turfCentroid(feature) as Feature<Point>;
    const [lng, lat] = c.geometry.coordinates;
    return { lng, lat };
  } catch {
    return null;
  }
}

function haversineKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── FeatureCollection helpers (for client convenience) ───────────────────────

export function pinsAsFeatureCollection(pins: RouteTodayPin[]): FeatureCollection<Point, RouteTodayPinProperties> {
  return { type: "FeatureCollection", features: pins };
}

// Re-export Polygon to keep type-only imports quiet in callers that need it.
export type { Polygon };
