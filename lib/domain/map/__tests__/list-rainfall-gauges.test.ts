/**
 * @vitest-environment node
 *
 * Wave G3 (#167) — `listRainfallGauges` test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listRainfallGauges } from "@/lib/domain/map/list-rainfall-gauges";

describe("listRainfallGauges", () => {
  beforeEach(() => {
    // Pin the clock to a known UTC midnight so the date-windows are
    // deterministic across CI/local.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries the last 7 days and groups rows by rounded lat/lng", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        date: "2026-05-08",
        rainfallMm: 5,
        stationName: "Gauge A",
        campId: "C1",
        lat: -25.5,
        lng: 28.5,
      },
      {
        date: "2026-05-07",
        rainfallMm: 3,
        stationName: "Gauge A",
        campId: "C1",
        lat: -25.5,
        lng: 28.5,
      },
      {
        date: "2026-05-06",
        rainfallMm: 2,
        stationName: "Gauge B",
        campId: "C2",
        lat: -25.6,
        lng: 28.6,
      },
    ]);
    const prisma = {
      rainfallRecord: { findMany },
    } as unknown as PrismaClient;

    const result = await listRainfallGauges(prisma);

    // Verify the where clause covers the last 7 days (today + 6 days back).
    expect(findMany).toHaveBeenCalledWith({
      where: { date: { gte: "2026-05-02" } },
      select: {
        date: true,
        rainfallMm: true,
        stationName: true,
        campId: true,
        lat: true,
        lng: true,
      },
      orderBy: { date: "desc" },
    });

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(2);

    // Gauge A: 5 (today) + 3 (yesterday) = 8 mm last7d, 5 mm last24h.
    const a = result.features.find((f) => f.properties.stationName === "Gauge A");
    expect(a).toBeDefined();
    expect(a?.geometry).toEqual({ type: "Point", coordinates: [28.5, -25.5] });
    expect(a?.properties).toMatchObject({
      stationName: "Gauge A",
      campId: "C1",
      mm24h: 5,
      mm7d: 8,
      lastReadingAt: "2026-05-08",
    });

    // Gauge B: 2 mm last7d, 0 mm last24h (yesterday-ish).
    const b = result.features.find((f) => f.properties.stationName === "Gauge B");
    expect(b?.properties).toMatchObject({
      stationName: "Gauge B",
      campId: "C2",
      mm24h: 0,
      mm7d: 2,
      lastReadingAt: "2026-05-06",
    });
  });

  it("filters out rows with null lat or null lng", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        date: "2026-05-08",
        rainfallMm: 5,
        stationName: "Has coords",
        campId: null,
        lat: -25.5,
        lng: 28.5,
      },
      {
        date: "2026-05-08",
        rainfallMm: 4,
        stationName: "No lat",
        campId: null,
        lat: null,
        lng: 28.5,
      },
      {
        date: "2026-05-08",
        rainfallMm: 3,
        stationName: "No lng",
        campId: null,
        lat: -25.5,
        lng: null,
      },
    ]);
    const prisma = {
      rainfallRecord: { findMany },
    } as unknown as PrismaClient;

    const result = await listRainfallGauges(prisma);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.stationName).toBe("Has coords");
  });

  it("rounds totals to 1 decimal place", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        date: "2026-05-08",
        rainfallMm: 1.234,
        stationName: "Rounded",
        campId: null,
        lat: -25.5,
        lng: 28.5,
      },
      {
        date: "2026-05-07",
        rainfallMm: 2.345,
        stationName: "Rounded",
        campId: null,
        lat: -25.5,
        lng: 28.5,
      },
    ]);
    const prisma = {
      rainfallRecord: { findMany },
    } as unknown as PrismaClient;

    const result = await listRainfallGauges(prisma);
    expect(result.features[0].properties.mm24h).toBe(1.2);
    expect(result.features[0].properties.mm7d).toBe(3.6);
  });

  it("returns empty FeatureCollection when no rows exist", async () => {
    const prisma = {
      rainfallRecord: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    expect(await listRainfallGauges(prisma)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});
