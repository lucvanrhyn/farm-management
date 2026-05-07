/**
 * @vitest-environment node
 *
 * Wave B (#151) — domain op: `attachAnimalsToMob`.
 *
 * Attaches a set of animals to a mob, hard-blocking cross-species
 * assignment (`species: mob.species` filter) and surfacing requested vs.
 * actual count when some animals were rejected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { attachAnimalsToMob } from "../attach-animals";
import { MobNotFoundError } from "@/lib/domain/mobs/move-mob";
import { RouteValidationError } from "@/lib/server/route";

describe("attachAnimalsToMob(prisma, input)", () => {
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
      attachAnimalsToMob(prisma, { mobId: "missing", animalIds: ["a1"] }),
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
      attachAnimalsToMob(prisma, { mobId: "m1", animalIds: [] }),
    ).rejects.toBeInstanceOf(RouteValidationError);
    expect(animalUpdateMany).not.toHaveBeenCalled();
  });

  it("attaches every animal when species + status match — returns flat shape", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      species: "cattle",
      currentCamp: "NORTH-01",
    });
    animalUpdateMany.mockResolvedValue({ count: 3 });

    const result = await attachAnimalsToMob(prisma, {
      mobId: "m1",
      animalIds: ["a1", "a2", "a3"],
    });

    expect(result).toEqual({ success: true, count: 3 });
    expect(animalUpdateMany).toHaveBeenCalledWith({
      where: {
        animalId: { in: ["a1", "a2", "a3"] },
        status: "Active",
        species: "cattle",
      },
      data: { mobId: "m1", currentCamp: "NORTH-01" },
    });
  });

  it("surfaces requested + mismatched when actual < requested (cross-species reject)", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      species: "cattle",
      currentCamp: "NORTH-01",
    });
    animalUpdateMany.mockResolvedValue({ count: 2 });

    const result = await attachAnimalsToMob(prisma, {
      mobId: "m1",
      animalIds: ["a1", "a2", "a3"], // 3 requested, 2 attached → 1 rejected
    });

    expect(result).toEqual({
      success: true,
      count: 2,
      requested: 3,
      mismatched: 1,
    });
  });
});
