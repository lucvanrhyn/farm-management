/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — `reorderRotationPlanSteps` tests.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { reorderRotationPlanSteps } from "@/lib/domain/rotation/reorder-steps";
import {
  InvalidOrderError,
  PlanNotFoundError,
} from "@/lib/domain/rotation/errors";

function mockPrisma(opts: {
  planExists?: boolean;
  pendingIds?: string[];
  finalSteps?: unknown[];
} = {}) {
  const planExists = opts.planExists ?? true;
  const pending = opts.pendingIds ?? ["s1", "s2", "s3"];
  return {
    rotationPlan: {
      findUnique: vi
        .fn()
        .mockResolvedValue(planExists ? { id: "p1" } : null),
    },
    rotationPlanStep: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(pending.map((id) => ({ id })))
        .mockResolvedValueOnce(opts.finalSteps ?? []),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("reorderRotationPlanSteps", () => {
  it("throws PlanNotFoundError when plan missing", async () => {
    await expect(
      reorderRotationPlanSteps(mockPrisma({ planExists: false }), "p1", {
        order: ["s1", "s2"],
      }),
    ).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it("throws InvalidOrderError when order is not an array", async () => {
    await expect(
      reorderRotationPlanSteps(mockPrisma(), "p1", { order: "nope" }),
    ).rejects.toBeInstanceOf(InvalidOrderError);
  });

  it("throws InvalidOrderError when order is empty", async () => {
    await expect(
      reorderRotationPlanSteps(mockPrisma(), "p1", { order: [] }),
    ).rejects.toBeInstanceOf(InvalidOrderError);
  });

  it("throws InvalidOrderError when order length differs", async () => {
    await expect(
      reorderRotationPlanSteps(mockPrisma({ pendingIds: ["s1", "s2", "s3"] }), "p1", {
        order: ["s1", "s2"],
      }),
    ).rejects.toBeInstanceOf(InvalidOrderError);
  });

  it("throws InvalidOrderError when order contains an unknown id", async () => {
    await expect(
      reorderRotationPlanSteps(mockPrisma({ pendingIds: ["s1", "s2"] }), "p1", {
        order: ["s1", "stray"],
      }),
    ).rejects.toBeInstanceOf(InvalidOrderError);
  });

  it("renumbers each step sequence to its index+1 when permutation valid", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      rotationPlan: {
        findUnique: vi.fn().mockResolvedValue({ id: "p1" }),
      },
      rotationPlanStep: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }, { id: "s3" }])
          .mockResolvedValueOnce([
            { id: "s2", sequence: 1 },
            { id: "s3", sequence: 2 },
            { id: "s1", sequence: 3 },
          ]),
        update,
      },
    } as unknown as PrismaClient;

    const result = await reorderRotationPlanSteps(prisma, "p1", {
      order: ["s2", "s3", "s1"],
    });

    expect(update).toHaveBeenCalledTimes(3);
    expect(update.mock.calls[0][0]).toEqual({
      where: { id: "s2" },
      data: { sequence: 1 },
    });
    expect(update.mock.calls[1][0]).toEqual({
      where: { id: "s3" },
      data: { sequence: 2 },
    });
    expect(update.mock.calls[2][0]).toEqual({
      where: { id: "s1" },
      data: { sequence: 3 },
    });
    expect(result).toHaveLength(3);
  });
});
