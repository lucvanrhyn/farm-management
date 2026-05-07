/**
 * @vitest-environment node
 *
 * Wave C (#156) — domain op: `listObservations`.
 *
 * Pure function on `(prisma, filters)` that returns observation rows
 * ordered by `observedAt desc`. Filters are optional and translate to
 * the equivalent Prisma `where` clause. Pagination is enforced via
 * `take` (capped at 200) and `skip`. Wire shape is preserved from the
 * pre-Wave-C route handler (raw Prisma objects).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listObservations } from "../list-observations";

describe("listObservations(prisma, filters)", () => {
  const findMany = vi.fn();
  const prisma = {
    observation: { findMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns observations ordered desc with default pagination (limit 50, offset 0)", async () => {
    findMany.mockResolvedValue([{ id: "obs-1" }]);

    const result = await listObservations(prisma, {});

    expect(result).toEqual([{ id: "obs-1" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { observedAt: "desc" },
      take: 50,
      skip: 0,
    });
  });

  it("translates camp/type/animalId filters to a Prisma where clause", async () => {
    findMany.mockResolvedValue([]);

    await listObservations(prisma, {
      camp: "NORTH-01",
      type: "weighing",
      animalId: "BR-001",
      limit: 25,
      offset: 100,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { campId: "NORTH-01", type: "weighing", animalId: "BR-001" },
      orderBy: { observedAt: "desc" },
      take: 25,
      skip: 100,
    });
  });

  it("caps limit at 200 (defensive against bursty offline-sync clients)", async () => {
    findMany.mockResolvedValue([]);

    await listObservations(prisma, { limit: 5000 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it("clamps negative limit/offset to safe defaults", async () => {
    findMany.mockResolvedValue([]);

    await listObservations(prisma, { limit: -1, offset: -42 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 0 }),
    );
  });
});
