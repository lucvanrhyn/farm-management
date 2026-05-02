/**
 * __tests__/server/mob-move-cross-species.test.ts
 *
 * TDD tests for wave/58 (#28 Phase B — cross-species hard-block runtime guard):
 *   `performMobMove` must reject moves when the destination camp's species
 *   does not match the mob's species. Throws a typed error with code
 *   `CROSS_SPECIES_BLOCKED` so the API layer can surface a 422.
 *
 *   Spec: memory/multi-species-spec-2026-04-27.md
 *     - "Hard-block animal moves across species. API rejects with typed
 *        error if Animal.species ≠ targetCamp.species. No warn-and-allow option."
 *     - "Mob.species — new column, NOT NULL. A mob is cattle XOR sheep XOR game."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories hoist above top-level const declarations, so any state the
// factories need must come from vi.hoisted (per memory/feedback-vi-hoisted-shared-mocks.md).
const {
  mobFindUniqueMock,
  campFindFirstMock,
  mobUpdateMock,
  animalFindManyMock,
  animalUpdateManyMock,
  observationCreateMock,
  prismaMock,
} = vi.hoisted(() => {
  const mobFindUnique = vi.fn();
  const campFindFirst = vi.fn();
  const mobUpdate = vi.fn();
  const animalFindMany = vi.fn();
  const animalUpdateMany = vi.fn();
  const observationCreate = vi.fn();

  // The transaction callback receives a tx client. We pass the same prisma mock
  // so spies fire regardless of whether code uses tx.* or prisma.*.
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    mob: { findUnique: mobFindUnique, update: mobUpdate },
    camp: { findFirst: campFindFirst },
    animal: { findMany: animalFindMany, updateMany: animalUpdateMany },
    observation: { create: observationCreate },
  };

  return {
    mobFindUniqueMock: mobFindUnique,
    campFindFirstMock: campFindFirst,
    mobUpdateMock: mobUpdate,
    animalFindManyMock: animalFindMany,
    animalUpdateManyMock: animalUpdateMany,
    observationCreateMock: observationCreate,
    prismaMock: prisma,
  };
});

import {
  performMobMove,
  CrossSpeciesBlockedError,
  CROSS_SPECIES_BLOCKED,
} from "@/lib/server/mob-move";
import type { PrismaClient } from "@prisma/client";

const mob = (overrides: Partial<{ id: string; name: string; currentCamp: string; species: string }> = {}) => ({
  id: "mob-1",
  name: "Mob A",
  currentCamp: "camp-source",
  species: "cattle",
  ...overrides,
});

const camp = (overrides: Partial<{ id: string; campId: string; species: string }> = {}) => ({
  id: "camp-id",
  campId: "camp-dest",
  species: "cattle",
  ...overrides,
});

describe("performMobMove — cross-species guard (#28 Phase B)", () => {
  beforeEach(() => {
    mobFindUniqueMock.mockReset();
    campFindFirstMock.mockReset();
    mobUpdateMock.mockReset();
    animalFindManyMock.mockReset();
    animalUpdateManyMock.mockReset();
    observationCreateMock.mockReset();

    animalFindManyMock.mockResolvedValue([]);
    mobUpdateMock.mockResolvedValue({});
    animalUpdateManyMock.mockResolvedValue({ count: 0 });
    observationCreateMock.mockImplementation((args: { data: { campId: string } }) => ({
      id: `obs-${args.data.campId}`,
    }));
  });

  it("blocks moving a cattle mob into a sheep camp with CROSS_SPECIES_BLOCKED", async () => {
    mobFindUniqueMock.mockResolvedValue(mob({ species: "cattle", currentCamp: "camp-source" }));
    campFindFirstMock.mockResolvedValue(camp({ campId: "camp-dest", species: "sheep" }));

    await expect(
      performMobMove(prismaMock as unknown as PrismaClient, {
        mobId: "mob-1",
        toCampId: "camp-dest",
        loggedBy: null,
      }),
    ).rejects.toThrow(CrossSpeciesBlockedError);

    // No writes should have happened.
    expect(mobUpdateMock).not.toHaveBeenCalled();
    expect(animalUpdateManyMock).not.toHaveBeenCalled();
    expect(observationCreateMock).not.toHaveBeenCalled();
  });

  it("blocks moving a sheep mob into a game camp with CROSS_SPECIES_BLOCKED", async () => {
    mobFindUniqueMock.mockResolvedValue(mob({ species: "sheep", currentCamp: "camp-source" }));
    campFindFirstMock.mockResolvedValue(camp({ campId: "camp-dest", species: "game" }));

    const err = await performMobMove(prismaMock as unknown as PrismaClient, {
      mobId: "mob-1",
      toCampId: "camp-dest",
      loggedBy: null,
    }).catch((e: Error) => e);

    expect(err).toBeInstanceOf(CrossSpeciesBlockedError);
    expect((err as Error).message).toBe(CROSS_SPECIES_BLOCKED);
  });

  it("allows same-species moves (cattle mob → cattle camp)", async () => {
    mobFindUniqueMock.mockResolvedValue(mob({ species: "cattle", currentCamp: "camp-source" }));
    campFindFirstMock.mockResolvedValue(camp({ campId: "camp-dest", species: "cattle" }));

    await expect(
      performMobMove(prismaMock as unknown as PrismaClient, {
        mobId: "mob-1",
        toCampId: "camp-dest",
        loggedBy: "logger@farm.co.za",
      }),
    ).resolves.toMatchObject({
      mobId: "mob-1",
      sourceCamp: "camp-source",
      destCamp: "camp-dest",
    });

    expect(mobUpdateMock).toHaveBeenCalledTimes(1);
    expect(observationCreateMock).toHaveBeenCalledTimes(2);
  });

  it("allows the move when the destination camp lookup returns null (legacy/unknown — open until backfilled)", async () => {
    // Edge case: destination camp has no species row (legacy data). We log a
    // TODO and allow the move so legacy data doesn't break in prod. Phase A
    // backfilled species='cattle' but a defensive read is still cheap.
    mobFindUniqueMock.mockResolvedValue(mob({ species: "cattle", currentCamp: "camp-source" }));
    campFindFirstMock.mockResolvedValue(null);

    await expect(
      performMobMove(prismaMock as unknown as PrismaClient, {
        mobId: "mob-1",
        toCampId: "camp-dest",
        loggedBy: null,
      }),
    ).resolves.toBeDefined();
  });
});
