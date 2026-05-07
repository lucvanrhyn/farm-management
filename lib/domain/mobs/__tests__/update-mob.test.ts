/**
 * @vitest-environment node
 *
 * Wave B (#151) — domain op: `updateMob`.
 *
 * Updates a mob — name change, currentCamp change (which delegates to
 * `performMobMove` for the cross-species hard-block + observation rows),
 * or both. Throws `MobNotFoundError` when the mob doesn't exist; bubbles
 * `CrossSpeciesBlockedError` from `performMobMove` so the adapter
 * envelope maps it onto 422.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const { performMobMoveMock } = vi.hoisted(() => ({
  performMobMoveMock: vi.fn(),
}));

vi.mock("@/lib/server/mob-move", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/mob-move")>(
    "@/lib/server/mob-move",
  );
  return {
    ...actual,
    performMobMove: (...args: unknown[]) => performMobMoveMock(...args),
  };
});

import { updateMob } from "../update-mob";
import {
  CrossSpeciesBlockedError,
  MobNotFoundError,
} from "@/lib/server/mob-move";

describe("updateMob(prisma, input)", () => {
  const mobFindUnique = vi.fn();
  const mobUpdate = vi.fn();
  const mobFindUniqueOrThrow = vi.fn();
  const prisma = {
    mob: {
      findUnique: mobFindUnique,
      update: mobUpdate,
      findUniqueOrThrow: mobFindUniqueOrThrow,
    },
  } as unknown as PrismaClient;

  beforeEach(() => {
    mobFindUnique.mockReset();
    mobUpdate.mockReset();
    mobFindUniqueOrThrow.mockReset();
    performMobMoveMock.mockReset();
  });

  it("throws MobNotFoundError when the mob does not exist", async () => {
    mobFindUnique.mockResolvedValue(null);

    await expect(
      updateMob(prisma, { mobId: "missing", name: "X", loggedBy: null }),
    ).rejects.toBeInstanceOf(MobNotFoundError);
    expect(mobUpdate).not.toHaveBeenCalled();
  });

  it("updates the name only when currentCamp is unchanged", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      name: "Old Name",
      currentCamp: "NORTH-01",
      species: "cattle",
    });
    mobUpdate.mockResolvedValue({
      id: "m1",
      name: "New Name",
      currentCamp: "NORTH-01",
    });

    const result = await updateMob(prisma, {
      mobId: "m1",
      name: "New Name",
      loggedBy: "u@x.co.za",
    });

    expect(result).toEqual({
      id: "m1",
      name: "New Name",
      current_camp: "NORTH-01",
    });
    expect(performMobMoveMock).not.toHaveBeenCalled();
    expect(mobUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { name: "New Name" },
    });
  });

  it("delegates to performMobMove when currentCamp differs from current value", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "cattle",
    });
    performMobMoveMock.mockResolvedValue({
      mobId: "m1",
      mobName: "Mob A",
      sourceCamp: "NORTH-01",
      destCamp: "SOUTH-02",
      animalIds: [],
      observedAt: new Date(),
      observationIds: ["obs-1", "obs-2"],
    });
    mobFindUniqueOrThrow.mockResolvedValue({
      id: "m1",
      name: "Mob A",
      currentCamp: "SOUTH-02",
    });

    const result = await updateMob(prisma, {
      mobId: "m1",
      currentCamp: "SOUTH-02",
      loggedBy: "u@x.co.za",
    });

    expect(performMobMoveMock).toHaveBeenCalledWith(prisma, {
      mobId: "m1",
      toCampId: "SOUTH-02",
      loggedBy: "u@x.co.za",
    });
    expect(result.current_camp).toBe("SOUTH-02");
  });

  it("does NOT call performMobMove when currentCamp matches the current value (no-op)", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "cattle",
    });
    mobFindUniqueOrThrow.mockResolvedValue({
      id: "m1",
      name: "Mob A",
      currentCamp: "NORTH-01",
    });

    await updateMob(prisma, {
      mobId: "m1",
      currentCamp: "NORTH-01",
      loggedBy: null,
    });

    expect(performMobMoveMock).not.toHaveBeenCalled();
  });

  it("bubbles CrossSpeciesBlockedError from performMobMove unchanged", async () => {
    mobFindUnique.mockResolvedValue({
      id: "m1",
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "sheep",
    });
    performMobMoveMock.mockRejectedValue(
      new CrossSpeciesBlockedError("sheep", "cattle"),
    );

    await expect(
      updateMob(prisma, {
        mobId: "m1",
        currentCamp: "CATTLE-01",
        loggedBy: null,
      }),
    ).rejects.toBeInstanceOf(CrossSpeciesBlockedError);
    expect(mobUpdate).not.toHaveBeenCalled();
  });
});
