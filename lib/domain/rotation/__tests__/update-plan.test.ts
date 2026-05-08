/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — `updateRotationPlan` tests.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { updateRotationPlan } from "@/lib/domain/rotation/update-plan";
import {
  BlankNameError,
  InvalidDateError,
  InvalidStatusError,
  PlanNotFoundError,
} from "@/lib/domain/rotation/errors";

function mockPrisma(opts: {
  findUnique?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    rotationPlan: {
      findUnique:
        opts.findUnique ??
        vi.fn().mockResolvedValue({ id: "p1", status: "draft" }),
      update:
        opts.update ?? vi.fn().mockResolvedValue({ id: "p1", steps: [] }),
    },
  } as unknown as PrismaClient;
}

describe("updateRotationPlan", () => {
  it("throws PlanNotFoundError when the plan is missing", async () => {
    const prisma = mockPrisma({
      findUnique: vi.fn().mockResolvedValue(null),
    });
    await expect(
      updateRotationPlan(prisma, "missing", { name: "x" }),
    ).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it("throws InvalidStatusError when status is not in allow-list", async () => {
    await expect(
      updateRotationPlan(mockPrisma(), "p1", { status: "frozen" }),
    ).rejects.toBeInstanceOf(InvalidStatusError);
  });

  it("throws BlankNameError when name trims to empty", async () => {
    await expect(
      updateRotationPlan(mockPrisma(), "p1", { name: "   " }),
    ).rejects.toBeInstanceOf(BlankNameError);
  });

  it("throws InvalidDateError when startDate is unparseable", async () => {
    await expect(
      updateRotationPlan(mockPrisma(), "p1", { startDate: "bogus" }),
    ).rejects.toBeInstanceOf(InvalidDateError);
  });

  it("updates only the supplied fields", async () => {
    const update = vi.fn().mockResolvedValue({ id: "p1", steps: [] });
    const prisma = mockPrisma({ update });
    await updateRotationPlan(prisma, "p1", {
      name: " Renamed ",
      status: "active",
      notes: "go go",
    });
    const data = update.mock.calls[0][0].data;
    expect(data.name).toBe("Renamed");
    expect(data.status).toBe("active");
    expect(data.notes).toBe("go go");
    expect(data.startDate).toBeUndefined();
  });
});
