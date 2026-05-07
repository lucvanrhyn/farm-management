/**
 * @vitest-environment node
 *
 * Wave B (#151) — domain op: `createMob`.
 *
 * Creates a mob after validating the destination camp's species via
 * `requireSpeciesScopedCamp`. Throws typed errors `WrongSpeciesError` and
 * `NotFoundError` so the adapter envelope can map them onto the existing
 * 422 wire shape (`{ error: "WRONG_SPECIES" | "NOT_FOUND" }`).
 *
 * The vi.hoisted shared-mock pattern is required because vi.mock factories
 * hoist above top-level const declarations (per
 * memory/feedback-vi-hoisted-shared-mocks.md).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const { requireSpeciesScopedCampMock } = vi.hoisted(() => ({
  requireSpeciesScopedCampMock: vi.fn(),
}));

vi.mock("@/lib/server/species/require-species-scoped-camp", () => ({
  requireSpeciesScopedCamp: requireSpeciesScopedCampMock,
}));

import { createMob } from "../create-mob";
import {
  WrongSpeciesError,
  NotFoundError,
} from "../errors";
import { RouteValidationError } from "@/lib/server/route";

describe("createMob(prisma, input)", () => {
  const mobCreate = vi.fn();
  const prisma = {
    mob: { create: mobCreate },
  } as unknown as PrismaClient;

  beforeEach(() => {
    mobCreate.mockReset();
    requireSpeciesScopedCampMock.mockReset();
  });

  it("happy path: validates camp via requireSpeciesScopedCamp and creates the mob", async () => {
    requireSpeciesScopedCampMock.mockResolvedValue({
      ok: true,
      camp: { id: "camp-uuid-1", species: "cattle" },
    });
    mobCreate.mockResolvedValue({
      id: "mob-1",
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "cattle",
    });

    const result = await createMob(prisma, {
      name: "Mob A",
      currentCamp: "NORTH-01",
      species: "cattle",
      farmSlug: "test-farm",
    });

    expect(result).toEqual({
      id: "mob-1",
      name: "Mob A",
      current_camp: "NORTH-01",
      animal_count: 0,
    });
    expect(requireSpeciesScopedCampMock).toHaveBeenCalledWith(prisma, {
      species: "cattle",
      campId: "NORTH-01",
      farmSlug: "test-farm",
    });
    expect(mobCreate).toHaveBeenCalledWith({
      data: { name: "Mob A", currentCamp: "NORTH-01", species: "cattle" },
    });
  });

  it("throws RouteValidationError when name is missing", async () => {
    await expect(
      createMob(prisma, {
        name: "",
        currentCamp: "NORTH-01",
        species: "cattle",
        farmSlug: "test-farm",
      }),
    ).rejects.toBeInstanceOf(RouteValidationError);
    expect(mobCreate).not.toHaveBeenCalled();
  });

  it("throws RouteValidationError when currentCamp is missing", async () => {
    await expect(
      createMob(prisma, {
        name: "Mob A",
        currentCamp: "",
        species: "cattle",
        farmSlug: "test-farm",
      }),
    ).rejects.toBeInstanceOf(RouteValidationError);
    expect(mobCreate).not.toHaveBeenCalled();
  });

  it("throws RouteValidationError when species is missing or invalid", async () => {
    await expect(
      createMob(prisma, {
        name: "Mob A",
        currentCamp: "NORTH-01",
        species: "ostrich" as unknown as "cattle",
        farmSlug: "test-farm",
      }),
    ).rejects.toBeInstanceOf(RouteValidationError);
    expect(mobCreate).not.toHaveBeenCalled();
  });

  it("throws WrongSpeciesError when destination camp belongs to a different species", async () => {
    requireSpeciesScopedCampMock.mockResolvedValue({ ok: false, reason: "WRONG_SPECIES" });

    await expect(
      createMob(prisma, {
        name: "Mob A",
        currentCamp: "SHARED-01",
        species: "cattle",
        farmSlug: "test-farm",
      }),
    ).rejects.toBeInstanceOf(WrongSpeciesError);
    expect(mobCreate).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when destination camp does not exist (orphan)", async () => {
    requireSpeciesScopedCampMock.mockResolvedValue({ ok: false, reason: "NOT_FOUND" });

    await expect(
      createMob(prisma, {
        name: "Mob A",
        currentCamp: "GHOST-99",
        species: "cattle",
        farmSlug: "test-farm",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mobCreate).not.toHaveBeenCalled();
  });
});
