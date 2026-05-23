/**
 * @vitest-environment node
 *
 * Wave 309a (ADR-0001 Wave B, #309) — domain op: `updateCamp`.
 *
 * Resolves the camp by its (no-longer-globally-unique) `campId` via
 * `findFirst`, then mutates by the resolved CUID `id` (#28 Phase A).
 * Spreads only the provided fields. Throws `CampNotFoundError` when the
 * camp does not exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { updateCamp } from "../update-camp";
import { CampNotFoundError } from "@/lib/domain/observations/errors";

describe("updateCamp(prisma, { campId, patch })", () => {
  const campFindFirst = vi.fn();
  const campUpdate = vi.fn();
  const prisma = {
    camp: { findFirst: campFindFirst, update: campUpdate },
  } as unknown as PrismaClient;

  beforeEach(() => {
    campFindFirst.mockReset();
    campUpdate.mockReset();
  });

  it("throws CampNotFoundError when the camp does not exist", async () => {
    campFindFirst.mockResolvedValue(null);

    await expect(
      updateCamp(prisma, { campId: "MISSING", patch: { campName: "x" } }),
    ).rejects.toBeInstanceOf(CampNotFoundError);
    expect(campUpdate).not.toHaveBeenCalled();
  });

  it("resolves by campId via findFirst (Phase A #28 semantics)", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    campUpdate.mockResolvedValue({ id: "cuid-1" });

    await updateCamp(prisma, { campId: "NORTH-01", patch: { campName: "New" } });

    expect(campFindFirst).toHaveBeenCalledWith({
      where: { campId: "NORTH-01" },
    });
  });

  it("mutates via the resolved CUID id, not campId", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    campUpdate.mockResolvedValue({ id: "cuid-1" });

    await updateCamp(prisma, { campId: "NORTH-01", patch: { campName: "New" } });

    expect(campUpdate).toHaveBeenCalledWith({
      where: { id: "cuid-1" },
      data: { campName: "New" },
    });
  });

  it("spreads only the fields that are explicitly provided", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    campUpdate.mockResolvedValue({ id: "cuid-1" });

    await updateCamp(prisma, {
      campId: "NORTH-01",
      patch: {
        sizeHectares: 12,
        waterSource: null,
        restDaysOverride: 30,
      },
    });

    expect(campUpdate).toHaveBeenCalledWith({
      where: { id: "cuid-1" },
      data: {
        sizeHectares: 12,
        waterSource: null,
        restDaysOverride: 30,
      },
    });
  });

  it("includes explicitly-null values (clearing a field) but omits undefined", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    campUpdate.mockResolvedValue({ id: "cuid-1" });

    await updateCamp(prisma, {
      campId: "NORTH-01",
      patch: {
        campName: "Renamed",
        geojson: null,
        color: null,
        veldType: null,
        maxGrazingDaysOverride: null,
        rotationNotes: null,
      },
    });

    expect(campUpdate).toHaveBeenCalledWith({
      where: { id: "cuid-1" },
      data: {
        campName: "Renamed",
        geojson: null,
        color: null,
        veldType: null,
        maxGrazingDaysOverride: null,
        rotationNotes: null,
      },
    });
  });

  it("returns { success: true } on a successful update", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    campUpdate.mockResolvedValue({ id: "cuid-1" });

    const result = await updateCamp(prisma, {
      campId: "NORTH-01",
      patch: { campName: "New" },
    });

    expect(result).toEqual({ success: true });
  });

  it("issues an empty data update when no fields are provided", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    campUpdate.mockResolvedValue({ id: "cuid-1" });

    await updateCamp(prisma, { campId: "NORTH-01", patch: {} });

    expect(campUpdate).toHaveBeenCalledWith({
      where: { id: "cuid-1" },
      data: {},
    });
  });
});
