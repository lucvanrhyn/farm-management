/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — `getRotationPlan` / `getRotationPlanOrThrow` tests.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  getRotationPlan,
  getRotationPlanOrThrow,
} from "@/lib/domain/rotation/get-plan";
import { PlanNotFoundError } from "@/lib/domain/rotation/errors";

describe("getRotationPlan", () => {
  it("returns the row when present (with steps eager-loaded)", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "p1", steps: [] });
    const prisma = {
      rotationPlan: { findUnique },
    } as unknown as PrismaClient;

    expect(await getRotationPlan(prisma, "p1")).toEqual({ id: "p1", steps: [] });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "p1" },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
  });

  it("returns null when missing", async () => {
    const prisma = {
      rotationPlan: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    expect(await getRotationPlan(prisma, "missing")).toBeNull();
  });
});

describe("getRotationPlanOrThrow", () => {
  it("throws PlanNotFoundError when missing", async () => {
    const prisma = {
      rotationPlan: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    await expect(getRotationPlanOrThrow(prisma, "missing")).rejects.toBeInstanceOf(
      PlanNotFoundError,
    );
  });

  it("returns the row when present", async () => {
    const prisma = {
      rotationPlan: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1", steps: [] }),
      },
    } as unknown as PrismaClient;
    expect(await getRotationPlanOrThrow(prisma, "p1")).toEqual({
      id: "p1",
      steps: [],
    });
  });
});
