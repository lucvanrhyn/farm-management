/**
 * @vitest-environment node
 *
 * Wave B (#151) — domain op: `deleteMob`.
 *
 * Hard-blocks deletion of mobs that still have active animals attached.
 * Throws `MobNotFoundError` when the mob doesn't exist; throws
 * `MobHasAnimalsError` (409) when the assignment guard fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { deleteMob } from "../delete-mob";
import { MobHasAnimalsError } from "../errors";
import { MobNotFoundError } from "@/lib/domain/mobs/move-mob";

describe("deleteMob(prisma, mobId)", () => {
  const mobFindUnique = vi.fn();
  const mobDelete = vi.fn();
  const animalCount = vi.fn();
  const prisma = {
    mob: { findUnique: mobFindUnique, delete: mobDelete },
    animal: { count: animalCount },
  } as unknown as PrismaClient;

  beforeEach(() => {
    mobFindUnique.mockReset();
    mobDelete.mockReset();
    animalCount.mockReset();
  });

  it("throws MobNotFoundError when the mob does not exist", async () => {
    mobFindUnique.mockResolvedValue(null);

    await expect(deleteMob(prisma, "missing")).rejects.toBeInstanceOf(MobNotFoundError);
    expect(mobDelete).not.toHaveBeenCalled();
  });

  it("throws MobHasAnimalsError when there are active animals attached", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "cattle",
    });
    animalCount.mockResolvedValue(3);

    await expect(deleteMob(prisma, "m1")).rejects.toBeInstanceOf(MobHasAnimalsError);
    expect(mobDelete).not.toHaveBeenCalled();
  });

  it("deletes the mob and returns success when no active animals are attached", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "cattle",
    });
    animalCount.mockResolvedValue(0);
    mobDelete.mockResolvedValue({ id: "m1" });

    const result = await deleteMob(prisma, "m1");

    expect(result).toEqual({ success: true });
    expect(mobDelete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(animalCount).toHaveBeenCalledWith({
      where: { mobId: "m1", status: "Active" },
    });
  });
});
