/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — `listRotationPlans` test.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { listRotationPlans } from "@/lib/domain/rotation/list-plans";

describe("listRotationPlans", () => {
  it("returns plans with steps eagerly loaded, ordered updatedAt desc", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "p1", steps: [{ id: "s1", sequence: 1 }] },
    ]);
    const prisma = {
      rotationPlan: { findMany },
    } as unknown as PrismaClient;

    const result = await listRotationPlans(prisma);

    expect(result).toEqual([{ id: "p1", steps: [{ id: "s1", sequence: 1 }] }]);
    expect(findMany).toHaveBeenCalledWith({
      include: { steps: { orderBy: { sequence: "asc" } } },
      orderBy: { updatedAt: "desc" },
    });
  });
});
