/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — `deleteRotationPlan` tests.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { deleteRotationPlan } from "@/lib/domain/rotation/delete-plan";
import { PlanNotFoundError } from "@/lib/domain/rotation/errors";

describe("deleteRotationPlan", () => {
  it("throws PlanNotFoundError when missing", async () => {
    const prisma = {
      rotationPlan: {
        findUnique: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
      },
      rotationPlanStep: { deleteMany: vi.fn() },
    } as unknown as PrismaClient;

    await expect(deleteRotationPlan(prisma, "missing")).rejects.toBeInstanceOf(
      PlanNotFoundError,
    );
  });

  it("deletes steps first, then the plan, and returns success:true", async () => {
    const callOrder: string[] = [];
    const deleteMany = vi.fn().mockImplementation(async () => {
      callOrder.push("steps");
      return { count: 1 };
    });
    const planDelete = vi.fn().mockImplementation(async () => {
      callOrder.push("plan");
      return { id: "p1" };
    });
    const prisma = {
      rotationPlan: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1" }),
        delete: planDelete,
      },
      rotationPlanStep: { deleteMany },
    } as unknown as PrismaClient;

    const result = await deleteRotationPlan(prisma, "p1");

    expect(result).toEqual({ success: true });
    expect(callOrder).toEqual(["steps", "plan"]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { planId: "p1" } });
  });
});
