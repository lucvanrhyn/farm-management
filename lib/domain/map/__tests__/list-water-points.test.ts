/**
 * @vitest-environment node
 *
 * Wave G3 (#167) — `listWaterPoints` test.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listWaterPoints } from "@/lib/domain/map/list-water-points";

describe("listWaterPoints", () => {
  it("returns a GeoJSON FeatureCollection with one Feature per row that has coordinates", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "wp1",
        name: "North trough",
        type: "trough",
        status: "ok",
        gpsLat: -25.5,
        gpsLon: 28.5,
      },
      {
        id: "wp2",
        name: "Borehole 2",
        type: "borehole",
        status: "needs_repair",
        gpsLat: -25.6,
        gpsLon: 28.6,
      },
    ]);
    const prisma = {
      gameWaterPoint: { findMany },
    } as unknown as PrismaClient;

    const result = await listWaterPoints(prisma);

    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        gpsLat: true,
        gpsLon: true,
      },
    });
    expect(result).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [28.5, -25.5] },
          properties: {
            id: "wp1",
            name: "North trough",
            waterPointType: "trough",
            condition: "ok",
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [28.6, -25.6] },
          properties: {
            id: "wp2",
            name: "Borehole 2",
            waterPointType: "borehole",
            condition: "needs_repair",
          },
        },
      ],
    });
  });

  it("filters out rows missing gpsLat or gpsLon", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "wp1",
        name: "Has coords",
        type: "trough",
        status: "ok",
        gpsLat: -25.5,
        gpsLon: 28.5,
      },
      {
        id: "wp2",
        name: "No lat",
        type: "trough",
        status: "ok",
        gpsLat: null,
        gpsLon: 28.5,
      },
      {
        id: "wp3",
        name: "No lon",
        type: "trough",
        status: "ok",
        gpsLat: -25.5,
        gpsLon: null,
      },
    ]);
    const prisma = {
      gameWaterPoint: { findMany },
    } as unknown as PrismaClient;

    const result = await listWaterPoints(prisma);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.id).toBe("wp1");
  });

  it("returns an empty FeatureCollection when no rows exist", async () => {
    const prisma = {
      gameWaterPoint: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    expect(await listWaterPoints(prisma)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});
