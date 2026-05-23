/**
 * @vitest-environment node
 *
 * Wave 309a (ADR-0001 Wave B, #309) — domain op: `deleteCamp`.
 *
 * Resolves the camp by `campId` via `findFirst` (#28 Phase A — campId is
 * no longer globally unique), hard-blocks deletion when any active animal
 * still references the camp (cross-species by design — the guard counts on
 * `currentCamp` for every species), then deletes via the resolved CUID id.
 *
 * Throws `CampNotFoundError` when the camp does not exist; throws
 * `CampHasActiveAnimalsError` (mapped to 409 with a byte-identical legacy
 * message) when the active-animal guard fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { deleteCamp } from "../delete-camp";
import { CampHasActiveAnimalsError } from "../errors";
import { CampNotFoundError } from "@/lib/domain/observations/errors";

describe("deleteCamp(prisma, campId)", () => {
  const campFindFirst = vi.fn();
  const campDelete = vi.fn();
  const animalCount = vi.fn();
  const prisma = {
    camp: { findFirst: campFindFirst, delete: campDelete },
    animal: { count: animalCount },
  } as unknown as PrismaClient;

  beforeEach(() => {
    campFindFirst.mockReset();
    campDelete.mockReset();
    animalCount.mockReset();
  });

  it("throws CampNotFoundError when the camp does not exist", async () => {
    campFindFirst.mockResolvedValue(null);

    await expect(deleteCamp(prisma, "MISSING")).rejects.toBeInstanceOf(
      CampNotFoundError,
    );
    expect(animalCount).not.toHaveBeenCalled();
    expect(campDelete).not.toHaveBeenCalled();
  });

  it("resolves by campId via findFirst (Phase A #28 semantics)", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    animalCount.mockResolvedValue(0);
    campDelete.mockResolvedValue({ id: "cuid-1" });

    await deleteCamp(prisma, "NORTH-01");

    expect(campFindFirst).toHaveBeenCalledWith({
      where: { campId: "NORTH-01" },
    });
  });

  it("counts active animals across all species by campId (cross-species guard)", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    animalCount.mockResolvedValue(0);
    campDelete.mockResolvedValue({ id: "cuid-1" });

    await deleteCamp(prisma, "NORTH-01");

    expect(animalCount).toHaveBeenCalledWith({
      where: { currentCamp: "NORTH-01", status: "Active" },
    });
  });

  it("throws CampHasActiveAnimalsError when active animals exist", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    animalCount.mockResolvedValue(4);

    await expect(deleteCamp(prisma, "NORTH-01")).rejects.toBeInstanceOf(
      CampHasActiveAnimalsError,
    );
    expect(campDelete).not.toHaveBeenCalled();
  });

  it("CampHasActiveAnimalsError message is byte-identical to the legacy string", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    animalCount.mockResolvedValue(7);

    await expect(deleteCamp(prisma, "NORTH-01")).rejects.toThrow(
      "Cannot delete camp with 7 active animal(s). Move or remove them first.",
    );
  });

  it("deletes via the resolved CUID id and returns { success: true }", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    animalCount.mockResolvedValue(0);
    campDelete.mockResolvedValue({ id: "cuid-1" });

    const result = await deleteCamp(prisma, "NORTH-01");

    expect(result).toEqual({ success: true });
    expect(campDelete).toHaveBeenCalledWith({ where: { id: "cuid-1" } });
  });
});
