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
 *
 * Wave 4 A4 (Codex 2026-05-02 HIGH): destination-camp lookup uses the
 * composite-unique key `Camp_species_campId_key: { species, campId }` so the
 * resolution is deterministic when two camps share the same `campId` across
 * different species (e.g. cattle "NORTH-01" + sheep "NORTH-01").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories hoist above top-level const declarations, so any state the
// factories need must come from vi.hoisted (per memory/feedback-vi-hoisted-shared-mocks.md).
const {
  mobFindUniqueMock,
  campFindUniqueMock,
  mobUpdateMock,
  animalFindManyMock,
  animalUpdateManyMock,
  observationCreateMock,
  prismaMock,
} = vi.hoisted(() => {
  const mobFindUnique = vi.fn();
  const campFindUnique = vi.fn();
  const mobUpdate = vi.fn();
  const animalFindMany = vi.fn();
  const animalUpdateMany = vi.fn();
  const observationCreate = vi.fn();

  // The transaction callback receives a tx client. We pass the same prisma mock
  // so spies fire regardless of whether code uses tx.* or prisma.*.
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    mob: { findUnique: mobFindUnique, update: mobUpdate },
    camp: { findUnique: campFindUnique },
    animal: { findMany: animalFindMany, updateMany: animalUpdateMany },
    observation: { create: observationCreate },
  };

  return {
    mobFindUniqueMock: mobFindUnique,
    campFindUniqueMock: campFindUnique,
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
} from "@/lib/domain/mobs/move-mob";
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
    campFindUniqueMock.mockReset();
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
    // No cattle camp exists at this campId (only a sheep one) — composite
    // lookup returns null → cross-species block.
    campFindUniqueMock.mockResolvedValue(null);

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
    // No sheep camp at this campId (only a game one).
    campFindUniqueMock.mockResolvedValue(null);

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
    campFindUniqueMock.mockResolvedValue(camp({ campId: "camp-dest", species: "cattle" }));

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

  it("looks up destination camp via the composite (species, campId) unique key — Wave 4 A4 regression", async () => {
    // Codex 2026-05-02 HIGH: pre-fix used findFirst({ where: { campId } }),
    // which is nondeterministic when the same `campId` exists for two
    // different species (e.g. cattle "NORTH-01" + sheep "NORTH-01").
    //
    // Composite-unique findUnique guarantees the lookup resolves to the
    // matching-species row and never the cross-species duplicate.
    mobFindUniqueMock.mockResolvedValue(mob({ species: "sheep", currentCamp: "camp-source" }));
    campFindUniqueMock.mockResolvedValue(camp({ campId: "NORTH-01", species: "sheep" }));

    await expect(
      performMobMove(prismaMock as unknown as PrismaClient, {
        mobId: "mob-1",
        toCampId: "NORTH-01",
        loggedBy: null,
      }),
    ).resolves.toMatchObject({
      mobId: "mob-1",
      destCamp: "NORTH-01",
    });

    // Pin the actual where-clause shape: must be the composite key, never
    // a bare `{ campId }` (which would silently regress to findFirst-style
    // ambiguity if some future refactor swaps `findUnique` back).
    expect(campFindUniqueMock).toHaveBeenCalledTimes(1);
    expect(campFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          Camp_species_campId_key: { species: "sheep", campId: "NORTH-01" },
        },
      }),
    );
  });

  it("treats a missing destination row as cross-species blocked (#28 Phase B hard-block)", async () => {
    // Pre-fix: findFirst returning null was treated as "legacy/unknown,
    // allow." Post-fix: findUnique with the composite key returning null
    // means "no camp exists for THIS species at this campId," which under
    // the multi-species spec is equivalent to a cross-species attempt
    // (e.g. moving sheep into a cattle-only campId). Block it.
    mobFindUniqueMock.mockResolvedValue(mob({ species: "cattle", currentCamp: "camp-source" }));
    campFindUniqueMock.mockResolvedValue(null);

    await expect(
      performMobMove(prismaMock as unknown as PrismaClient, {
        mobId: "mob-1",
        toCampId: "camp-dest",
        loggedBy: null,
      }),
    ).rejects.toThrow(CrossSpeciesBlockedError);

    expect(mobUpdateMock).not.toHaveBeenCalled();
    expect(observationCreateMock).not.toHaveBeenCalled();
  });
});
