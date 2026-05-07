/**
 * @vitest-environment node
 *
 * Wave B (#151) — domain op: `listMobs`.
 *
 * Pure function: given a tenant-scoped Prisma client, returns the per-tenant
 * mob list with derived `animal_count` per mob. Mirrors the GET /api/mobs
 * wire shape (snake_case current_camp + animal_count fields).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listMobs } from "../list-mobs";

describe("listMobs(prisma)", () => {
  const mobFindMany = vi.fn();
  const animalGroupBy = vi.fn();
  const prisma = {
    mob: { findMany: mobFindMany },
    animal: { groupBy: animalGroupBy },
  } as unknown as PrismaClient;

  beforeEach(() => {
    mobFindMany.mockReset();
    animalGroupBy.mockReset();
  });

  it("returns mobs with derived animal_count, snake_case wire shape", async () => {
    mobFindMany.mockResolvedValue([
      { id: "m1", name: "Mob A", currentCamp: "NORTH-01" },
      { id: "m2", name: "Mob B", currentCamp: "SOUTH-02" },
    ]);
    animalGroupBy.mockResolvedValue([
      { mobId: "m1", _count: { _all: 12 } },
      { mobId: "m2", _count: { _all: 0 } },
    ]);

    const result = await listMobs(prisma);

    expect(result).toEqual([
      { id: "m1", name: "Mob A", current_camp: "NORTH-01", animal_count: 12 },
      { id: "m2", name: "Mob B", current_camp: "SOUTH-02", animal_count: 0 },
    ]);
    expect(mobFindMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });
    expect(animalGroupBy).toHaveBeenCalledWith({
      by: ["mobId"],
      where: { status: "Active", mobId: { not: null } },
      _count: { _all: true },
    });
  });

  it("returns animal_count = 0 for mobs with no active animals (no group row)", async () => {
    mobFindMany.mockResolvedValue([
      { id: "empty", name: "Empty Mob", currentCamp: "NORTH-01" },
    ]);
    animalGroupBy.mockResolvedValue([]);

    const result = await listMobs(prisma);

    expect(result).toEqual([
      { id: "empty", name: "Empty Mob", current_camp: "NORTH-01", animal_count: 0 },
    ]);
  });

  it("ignores groupBy rows with null mobId (defensive)", async () => {
    mobFindMany.mockResolvedValue([
      { id: "m1", name: "Mob A", currentCamp: "NORTH-01" },
    ]);
    animalGroupBy.mockResolvedValue([
      { mobId: null, _count: { _all: 99 } }, // unassigned bucket — must be ignored
      { mobId: "m1", _count: { _all: 5 } },
    ]);

    const result = await listMobs(prisma);

    expect(result).toEqual([
      { id: "m1", name: "Mob A", current_camp: "NORTH-01", animal_count: 5 },
    ]);
  });

  it("returns an empty array when there are no mobs", async () => {
    mobFindMany.mockResolvedValue([]);
    animalGroupBy.mockResolvedValue([]);

    const result = await listMobs(prisma);

    expect(result).toEqual([]);
  });
});
