/**
 * @vitest-environment node
 *
 * Wave 316a (ADR-0001 Wave B, #309) — domain op: `createCamp`.
 *
 * Receives the already-parsed `CreateCampBody` (the route keeps its
 * `createCampSchema` parse adapter + the `SPECIES_OMITTED` sentinel). The
 * op converts the omitted-species sentinel into `MissingSpeciesError`
 * (mapped 422 `{ error: "MISSING_SPECIES" }`), enforces the species-scoped
 * duplicate guard via `findFirst` (`DuplicateCampError`, mapped 409 with a
 * byte-identical legacy message), auto-assigns a palette colour via
 * `count` modulo when none is supplied, then creates the camp and returns
 * the snake_case shape with `animal_count: 0`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { createCamp, SPECIES_OMITTED } from "../create-camp";
import { MissingSpeciesError, DuplicateCampError } from "../errors";
import { CAMP_COLOR_PALETTE } from "@/lib/camp-colors";

describe("createCamp(prisma, input)", () => {
  const campFindFirst = vi.fn();
  const campCount = vi.fn();
  const campCreate = vi.fn();
  const prisma = {
    camp: {
      findFirst: campFindFirst,
      count: campCount,
      create: campCreate,
    },
  } as unknown as PrismaClient;

  beforeEach(() => {
    campFindFirst.mockReset();
    campCount.mockReset();
    campCreate.mockReset();
  });

  it("throws MissingSpeciesError when species is the omitted sentinel", async () => {
    await expect(
      createCamp(prisma, {
        campId: "NORTH-01",
        campName: "North",
        species: SPECIES_OMITTED,
      }),
    ).rejects.toBeInstanceOf(MissingSpeciesError);
    expect(campFindFirst).not.toHaveBeenCalled();
    expect(campCreate).not.toHaveBeenCalled();
  });

  it("checks for duplicates species-scoped via findFirst", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });

    await expect(
      createCamp(prisma, {
        campId: "NORTH-01",
        campName: "North",
        species: "cattle",
      }),
    ).rejects.toBeInstanceOf(DuplicateCampError);
    expect(campFindFirst).toHaveBeenCalledWith({
      where: { campId: "NORTH-01", species: "cattle" },
    });
    expect(campCreate).not.toHaveBeenCalled();
  });

  it("DuplicateCampError message is byte-identical to the legacy string", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });

    await expect(
      createCamp(prisma, {
        campId: "NORTH-01",
        campName: "North",
        species: "cattle",
      }),
    ).rejects.toThrow("A camp with this ID already exists");
  });

  it("auto-assigns a palette colour via count modulo when none supplied", async () => {
    campFindFirst.mockResolvedValue(null);
    campCount.mockResolvedValue(CAMP_COLOR_PALETTE.length + 2); // wraps to index 2
    campCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      campId: data.campId,
      campName: data.campName,
      sizeHectares: data.sizeHectares,
      waterSource: data.waterSource,
      geojson: data.geojson,
      color: data.color,
    }));

    const result = await createCamp(prisma, {
      campId: "NORTH-01",
      campName: "North",
      species: "cattle",
    });

    expect(campCount).toHaveBeenCalled();
    expect(result.color).toBe(CAMP_COLOR_PALETTE[2]);
  });

  it("passes an explicit colour through without calling count", async () => {
    campFindFirst.mockResolvedValue(null);
    campCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      campId: data.campId,
      campName: data.campName,
      sizeHectares: data.sizeHectares,
      waterSource: data.waterSource,
      geojson: data.geojson,
      color: data.color,
    }));

    const result = await createCamp(prisma, {
      campId: "NORTH-01",
      campName: "North",
      species: "cattle",
      color: "#123456",
    });

    expect(campCount).not.toHaveBeenCalled();
    expect(result.color).toBe("#123456");
  });

  it("returns the exact snake_case shape with animal_count: 0", async () => {
    campFindFirst.mockResolvedValue(null);
    campCreate.mockResolvedValue({
      campId: "NORTH-01",
      campName: "North Camp",
      sizeHectares: 12.5,
      waterSource: "Borehole",
      geojson: '{"type":"Polygon"}',
      color: "#2563EB",
    });

    const result = await createCamp(prisma, {
      campId: "NORTH-01",
      campName: "North Camp",
      species: "cattle",
      sizeHectares: "12.5",
      waterSource: "Borehole",
      geojson: '{"type":"Polygon"}',
      color: "#2563EB",
    });

    expect(result).toEqual({
      camp_id: "NORTH-01",
      camp_name: "North Camp",
      size_hectares: 12.5,
      water_source: "Borehole",
      geojson: '{"type":"Polygon"}',
      color: "#2563EB",
      animal_count: 0,
    });
  });

  it("coerces sizeHectares and nullifies empty optional fields like the legacy route", async () => {
    campFindFirst.mockResolvedValue(null);
    campCount.mockResolvedValue(0);
    campCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      campId: data.campId,
      campName: data.campName,
      sizeHectares: data.sizeHectares,
      waterSource: data.waterSource,
      geojson: data.geojson,
      color: data.color,
    }));

    const result = await createCamp(prisma, {
      campId: "S-1",
      campName: "South",
      species: "sheep",
      sizeHectares: "",
      waterSource: "",
      geojson: "",
    });

    expect(campCreate).toHaveBeenCalledWith({
      data: {
        campId: "S-1",
        campName: "South",
        species: "sheep",
        sizeHectares: null,
        waterSource: null,
        geojson: null,
        color: CAMP_COLOR_PALETTE[0],
      },
    });
    expect(result).toEqual({
      camp_id: "S-1",
      camp_name: "South",
      size_hectares: null,
      water_source: null,
      geojson: null,
      color: CAMP_COLOR_PALETTE[0],
      animal_count: 0,
    });
  });
});
