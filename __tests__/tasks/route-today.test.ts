/**
 * Tests for lib/tasks/route-today.ts
 * TDD — written before implementation (RED phase).
 *
 * Covers:
 *  - Nearest-neighbour tour of 3 explicit pins.
 *  - Empty pins case.
 *  - Pin fallback to camp centroid via @turf/centroid.
 *  - Africa/Johannesburg day-window (UTC+2, no DST).
 *  - Status filter: only "pending".
 */
import { describe, it, expect } from "vitest";
import { buildRouteToday, dayWindowJohannesburg } from "@/lib/tasks/route-today";

// Minimal Prisma stub — only the methods buildRouteToday uses.
interface Occurrence {
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

function makePrisma(rows: Occurrence[], capturedWhere: { value?: unknown } = {}) {
  return {
    taskOccurrence: {
      findMany: async (args: {
        where: { status: string; occurrenceAt: { gte: Date; lt: Date } };
        include: { task: true };
        orderBy?: unknown;
      }) => {
        capturedWhere.value = args.where;
        return rows;
      },
    },
  };
}

// Square polygon centred at (28.5, -25.5), roughly 0.01° wide → centroid (28.5, -25.5)
const SQUARE_POLYGON_28_5 = JSON.stringify({
  type: "Polygon",
  coordinates: [[
    [28.495, -25.505],
    [28.505, -25.505],
    [28.505, -25.495],
    [28.495, -25.495],
    [28.495, -25.505],
  ]],
});

describe("dayWindowJohannesburg", () => {
  it("maps 2026-04-19T08:00:00Z (10:00 SAST) to [2026-04-18T22:00Z, 2026-04-19T22:00Z)", () => {
    const date = new Date("2026-04-19T08:00:00Z");
    const { dayStart, dayEnd } = dayWindowJohannesburg(date);
    expect(dayStart.toISOString()).toBe("2026-04-18T22:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-04-19T22:00:00.000Z");
  });

  it("is stable across a whole SAST day", () => {
    // 23:59 SAST on 2026-04-19 = 21:59 UTC — still same SA day
    const lateSast = new Date("2026-04-19T21:59:00Z");
    const { dayStart, dayEnd } = dayWindowJohannesburg(lateSast);
    expect(dayStart.toISOString()).toBe("2026-04-18T22:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-04-19T22:00:00.000Z");
  });
});

describe("buildRouteToday — NN tour ordering", () => {
  it("orders 3 explicit-lat/lng pins by nearest-neighbour from farm centre", async () => {
    const rows: Occurrence[] = [
      {
        id: "occ1", occurrenceAt: new Date("2026-04-19T06:00:00Z"), status: "pending", taskId: "t1",
        task: { id: "t1", title: "Far pin", lat: -25.6, lng: 28.6, campId: null, priority: "high" },
      },
      {
        id: "occ2", occurrenceAt: new Date("2026-04-19T06:00:00Z"), status: "pending", taskId: "t2",
        task: { id: "t2", title: "Near pin", lat: -25.51, lng: 28.51, campId: null, priority: "high" },
      },
      {
        id: "occ3", occurrenceAt: new Date("2026-04-19T06:00:00Z"), status: "pending", taskId: "t3",
        task: { id: "t3", title: "Mid pin", lat: -25.55, lng: 28.55, campId: null, priority: "high" },
      },
    ];
    const prisma = makePrisma(rows);
    const { pins, tour } = await buildRouteToday({
      prisma: prisma as never,
      date: new Date("2026-04-19T08:00:00Z"),
      farmCentre: { lng: 28.5, lat: -25.5 },
    });

    expect(pins).toHaveLength(3);
    // Nearest to (28.5,-25.5) → t2, then t3, then t1
    expect(pins[0].properties?.taskId).toBe("t2");
    expect(pins[0].properties?.seq).toBe(1);
    expect(pins[1].properties?.taskId).toBe("t3");
    expect(pins[2].properties?.taskId).toBe("t1");

    expect(tour.geometry.type).toBe("LineString");
    // LineString should have 3 vertices (start-at-first-pin, visit-all variant)
    // OR 4 if we include farm centre. We include farm centre as the starting point.
    expect(tour.geometry.coordinates.length).toBeGreaterThanOrEqual(3);
  });
});

describe("buildRouteToday — empty", () => {
  it("returns empty tour + empty pins when there are no pending occurrences", async () => {
    const prisma = makePrisma([]);
    const { pins, tour } = await buildRouteToday({
      prisma: prisma as never,
      date: new Date("2026-04-19T08:00:00Z"),
      farmCentre: null,
    });
    expect(pins).toHaveLength(0);
    expect(tour.geometry.coordinates).toHaveLength(0);
  });
});

describe("buildRouteToday — camp-centroid fallback", () => {
  it("falls back to camp geojson centroid when task has no lat/lng", async () => {
    const rows: Occurrence[] = [
      {
        id: "occ1", occurrenceAt: new Date("2026-04-19T06:00:00Z"), status: "pending", taskId: "t1",
        task: {
          id: "t1", title: "Camp-anchored", lat: null, lng: null, campId: "C1", priority: "normal",
        },
      },
    ];
    const prisma = makePrisma(rows);
    const { pins } = await buildRouteToday({
      prisma: prisma as never,
      date: new Date("2026-04-19T08:00:00Z"),
      farmCentre: null,
      campsById: {
        C1: { campId: "C1", campName: "Kraal 1", geojson: SQUARE_POLYGON_28_5 },
      },
    });
    expect(pins).toHaveLength(1);
    const [lng, lat] = pins[0].geometry.coordinates;
    expect(lng).toBeCloseTo(28.5, 3);
    expect(lat).toBeCloseTo(-25.5, 3);
    expect(pins[0].properties.campName).toBe("Kraal 1");
  });

  it("skips occurrences with neither explicit coords nor camp geojson", async () => {
    const rows: Occurrence[] = [
      {
        id: "occ1", occurrenceAt: new Date("2026-04-19T06:00:00Z"), status: "pending", taskId: "t1",
        task: {
          id: "t1", title: "No geom", lat: null, lng: null, campId: "C1", priority: "normal",
        },
      },
    ];
    const prisma = makePrisma(rows);
    const { pins } = await buildRouteToday({
      prisma: prisma as never,
      date: new Date("2026-04-19T08:00:00Z"),
      farmCentre: null,
      campsById: {
        C1: { campId: "C1", campName: "Kraal 1", geojson: null },
      },
    });
    expect(pins).toHaveLength(0);
  });

  it("skips occurrences when campsById lookup is omitted and task has no lat/lng", async () => {
    const rows: Occurrence[] = [
      {
        id: "occ1", occurrenceAt: new Date("2026-04-19T06:00:00Z"), status: "pending", taskId: "t1",
        task: {
          id: "t1", title: "Camp-anchored", lat: null, lng: null, campId: "C1", priority: "normal",
        },
      },
    ];
    const prisma = makePrisma(rows);
    const { pins } = await buildRouteToday({
      prisma: prisma as never,
      date: new Date("2026-04-19T08:00:00Z"),
      farmCentre: null,
    });
    expect(pins).toHaveLength(0);
  });
});

describe("buildRouteToday — Prisma where clause", () => {
  it("queries only pending occurrences inside the SAST day window", async () => {
    const captured: { value?: { status?: unknown; occurrenceAt?: { gte: Date; lt: Date } } } = {};
    const prisma = makePrisma([], captured);
    await buildRouteToday({
      prisma: prisma as never,
      date: new Date("2026-04-19T08:00:00Z"),
      farmCentre: null,
    });
    expect(captured.value?.status).toBe("pending");
    expect(captured.value?.occurrenceAt?.gte.toISOString()).toBe("2026-04-18T22:00:00.000Z");
    expect(captured.value?.occurrenceAt?.lt.toISOString()).toBe("2026-04-19T22:00:00.000Z");
  });
});
