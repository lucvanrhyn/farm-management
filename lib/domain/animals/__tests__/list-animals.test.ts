/**
 * @vitest-environment node
 *
 * Wave 316b (ADR-0001 Wave B, #309) — domain op: `listAnimals`.
 *
 * The GET body of `app/api/animals` lifted verbatim:
 *   baseWhere construction (camp/category/status/species/search/unassigned)
 *   → unbounded `findMany` (mode:"all") OR cursor `findMany` (mode:"page")
 *   → hasMore / nextCursor computation.
 *
 * The op returns a JSON-serialisable discriminated union; the route maps it
 * back to the byte-identical legacy wire (bare array vs
 * `{ items, nextCursor, hasMore }`). `limit` validation stays in the route
 * adapter — the op receives an already-clamped numeric `limit`.
 *
 * Also pins the `createAnimal` role gate moved into the domain op: a
 * non-ADMIN/non-LOGGER `role` throws `AnimalRoleForbiddenError`; ADMIN /
 * LOGGER / omitted `role` all succeed (back-compat for non-route callers).
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listAnimals } from "../list-animals";
import { createAnimal } from "../create-animal";
import { AnimalRoleForbiddenError } from "../errors";

function makeAnimals(ids: string[]) {
  return ids.map((id) => ({ animalId: id, name: `Animal ${id}` }));
}

function prismaWith(findManyImpl: ReturnType<typeof vi.fn>) {
  return { animal: { findMany: findManyImpl } } as unknown as PrismaClient;
}

describe("listAnimals — unbounded mode", () => {
  it("returns { mode:'all', animals } with the legacy [category, animalId] order", async () => {
    const findMany = vi.fn().mockResolvedValueOnce(makeAnimals(["001", "002"]));
    const result = await listAnimals(prismaWith(findMany), {
      status: "Active",
      paginated: false,
    });

    expect(result).toEqual({
      mode: "all",
      animals: makeAnimals(["001", "002"]),
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { status: "Active" },
      orderBy: [{ category: "asc" }, { animalId: "asc" }],
    });
  });

  it("builds the full baseWhere from every filter param", async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]);
    await listAnimals(prismaWith(findMany), {
      camp: "A",
      category: "Cow",
      species: "cattle",
      status: "all",
      unassigned: true,
      search: "C001",
      paginated: false,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        currentCamp: "A",
        category: "Cow",
        species: "cattle",
        mobId: null,
        OR: [
          { animalId: { contains: "C001" } },
          { name: { contains: "C001" } },
        ],
      },
      orderBy: [{ category: "asc" }, { animalId: "asc" }],
    });
  });
});

describe("listAnimals — cursor mode", () => {
  it("returns { mode:'page', ... } with take = limit+1, no extra batch", async () => {
    const findMany = vi.fn().mockResolvedValueOnce(makeAnimals(["001", "002"]));
    const result = await listAnimals(prismaWith(findMany), {
      status: "Active",
      paginated: true,
      limit: 500,
    });

    expect(result).toEqual({
      mode: "page",
      items: makeAnimals(["001", "002"]),
      nextCursor: null,
      hasMore: false,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { status: "Active" },
      orderBy: { animalId: "asc" },
      take: 501,
    });
  });

  it("slices to limit and surfaces nextCursor when an extra row exists", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(makeAnimals(["A", "B", "C"]));
    const result = await listAnimals(prismaWith(findMany), {
      status: "Active",
      paginated: true,
      limit: 2,
    });

    expect(result).toEqual({
      mode: "page",
      items: makeAnimals(["A", "B"]),
      nextCursor: "B",
      hasMore: true,
    });
  });

  it("applies the cursor as a strict-gt animalId filter", async () => {
    const findMany = vi.fn().mockResolvedValueOnce(makeAnimals(["D", "E"]));
    await listAnimals(prismaWith(findMany), {
      status: "Active",
      paginated: true,
      limit: 10,
      cursor: "C",
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { status: "Active", animalId: { gt: "C" } },
      orderBy: { animalId: "asc" },
      take: 11,
    });
  });
});

describe("createAnimal — role gate (moved from POST route)", () => {
  function prismaCreate() {
    const created = { animalId: "X1" };
    return {
      animal: {
        create: vi.fn().mockResolvedValue(created),
        upsert: vi.fn().mockResolvedValue(created),
      },
    } as unknown as PrismaClient;
  }

  const validInput = {
    animalId: "X1",
    sex: "Female",
    category: "Cow",
    currentCamp: "A",
  };

  it("throws AnimalRoleForbiddenError when role is a non-ADMIN/non-LOGGER value", async () => {
    await expect(
      createAnimal(prismaCreate(), { ...validInput, role: "VIEWER" }),
    ).rejects.toBeInstanceOf(AnimalRoleForbiddenError);
  });

  it("succeeds when role is ADMIN", async () => {
    const result = await createAnimal(prismaCreate(), {
      ...validInput,
      role: "ADMIN",
    });
    expect(result.success).toBe(true);
  });

  it("succeeds when role is LOGGER", async () => {
    const result = await createAnimal(prismaCreate(), {
      ...validInput,
      role: "LOGGER",
    });
    expect(result.success).toBe(true);
  });

  it("succeeds when role is omitted (back-compat for non-route callers)", async () => {
    const result = await createAnimal(prismaCreate(), validInput);
    expect(result.success).toBe(true);
  });
});
