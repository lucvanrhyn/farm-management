/**
 * @vitest-environment node
 *
 * Wave B (#151) — domain op: `detachAnimalsFromMob`.
 *
 * Removes animals from a mob (sets `mobId = null`). Defensively filters
 * by species so a legacy wrong-species pin can't be silently un-pinned
 * via the wrong endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { detachAnimalsFromMob } from "../detach-animals";
import { MobNotFoundError } from "@/lib/server/mob-move";
import { RouteValidationError } from "@/lib/server/route";

describe("detachAnimalsFromMob(prisma, input)", () => {
  const mobFindUnique = vi.fn();
  const animalUpdateMany = vi.fn();
  const prisma = {
    mob: { findUnique: mobFindUnique },
    animal: { updateMany: animalUpdateMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    mobFindUnique.mockReset();
    animalUpdateMany.mockReset();
  });

  it("throws MobNotFoundError when the mob does not exist", async () => {
    mobFindUnique.mockResolvedValue(null);

    await expect(
      detachAnimalsFromMob(prisma, { mobId: "missing", animalIds: ["a1"] }),
    ).rejects.toBeInstanceOf(MobNotFoundError);
    expect(animalUpdateMany).not.toHaveBeenCalled();
  });

  it("throws RouteValidationError when animalIds is empty", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      species: "cattle",
      currentCamp: "NORTH-01",
    });

    await expect(
      detachAnimalsFromMob(prisma, { mobId: "m1", animalIds: [] }),
    ).rejects.toBeInstanceOf(RouteValidationError);
    expect(animalUpdateMany).not.toHaveBeenCalled();
  });

  it("detaches every animal when species + mobId match — returns flat shape", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      species: "cattle",
      currentCamp: "NORTH-01",
    });
    animalUpdateMany.mockResolvedValue({ count: 2 });

    const result = await detachAnimalsFromMob(prisma, {
      mobId: "m1",
      animalIds: ["a1", "a2"],
    });

    expect(result).toEqual({ success: true, count: 2 });
    expect(animalUpdateMany).toHaveBeenCalledWith({
      where: {
        animalId: { in: ["a1", "a2"] },
        mobId: "m1",
        species: "cattle",
      },
      data: { mobId: null },
    });
  });

  it("surfaces requested + mismatched when actual < requested (legacy wrong-species reject)", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      species: "cattle",
      currentCamp: "NORTH-01",
    });
    animalUpdateMany.mockResolvedValue({ count: 1 });

    const result = await detachAnimalsFromMob(prisma, {
      mobId: "m1",
      animalIds: ["a1", "a2", "a3"],
    });

    expect(result).toEqual({
      success: true,
      count: 1,
      requested: 3,
      mismatched: 2,
    });
  });
});
