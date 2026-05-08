/**
 * @vitest-environment node
 *
 * Wave G3 (#167) — `listInfrastructure` test.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listInfrastructure } from "@/lib/domain/map/list-infrastructure";

describe("listInfrastructure", () => {
  it("returns a GeoJSON FeatureCollection with one Point feature per row that has coordinates", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "i1",
        name: "Fence A",
        type: "fence",
        condition: "good",
        gpsLat: -25.5,
        gpsLon: 28.5,
        lengthKm: 1.2,
        capacityAnimals: null,
      },
      {
        id: "i2",
        name: "Kraal",
        type: "kraal",
        condition: "fair",
        gpsLat: -25.6,
        gpsLon: 28.6,
        lengthKm: null,
        capacityAnimals: 50,
      },
    ]);
    const prisma = {
      gameInfrastructure: { findMany },
    } as unknown as PrismaClient;

    const result = await listInfrastructure(prisma);

    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        type: true,
        condition: true,
        gpsLat: true,
        gpsLon: true,
        lengthKm: true,
        capacityAnimals: true,
      },
    });
    expect(result).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [28.5, -25.5] },
          properties: {
            id: "i1",
            name: "Fence A",
            infrastructureType: "fence",
            condition: "good",
            lengthKm: 1.2,
            capacityAnimals: null,
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [28.6, -25.6] },
          properties: {
            id: "i2",
            name: "Kraal",
            infrastructureType: "kraal",
            condition: "fair",
            lengthKm: null,
            capacityAnimals: 50,
          },
        },
      ],
    });
  });

  it("filters out rows missing gpsLat or gpsLon", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "i1",
        name: "Has coords",
        type: "fence",
        condition: "good",
        gpsLat: -25.5,
        gpsLon: 28.5,
        lengthKm: 1,
        capacityAnimals: null,
      },
      {
        id: "i2",
        name: "Missing lat",
        type: "fence",
        condition: "good",
        gpsLat: null,
        gpsLon: 28.5,
        lengthKm: 1,
        capacityAnimals: null,
      },
      {
        id: "i3",
        name: "Missing lon",
        type: "fence",
        condition: "good",
        gpsLat: -25.5,
        gpsLon: null,
        lengthKm: 1,
        capacityAnimals: null,
      },
    ]);
    const prisma = {
      gameInfrastructure: { findMany },
    } as unknown as PrismaClient;

    const result = await listInfrastructure(prisma);

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.id).toBe("i1");
  });

  it("returns an empty FeatureCollection when no rows exist", async () => {
    const prisma = {
      gameInfrastructure: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    expect(await listInfrastructure(prisma)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});
