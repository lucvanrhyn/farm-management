/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — `createRotationPlan` tests.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { createRotationPlan } from "@/lib/domain/rotation/create-plan";
import {
  InvalidDateError,
  MissingFieldError,
} from "@/lib/domain/rotation/errors";

function mockPrisma(create = vi.fn().mockResolvedValue({ id: "p1", steps: [] })) {
  return {
    rotationPlan: { create },
  } as unknown as PrismaClient;
}

describe("createRotationPlan", () => {
  it("throws MissingFieldError when name is missing", async () => {
    await expect(
      createRotationPlan(mockPrisma(), { startDate: "2026-05-01" } as never),
    ).rejects.toMatchObject({
      name: "MissingFieldError",
      field: "name",
    });
  });

  it("throws MissingFieldError when name trims to empty", async () => {
    await expect(
      createRotationPlan(mockPrisma(), { name: "   ", startDate: "2026-05-01" }),
    ).rejects.toBeInstanceOf(MissingFieldError);
  });

  it("throws MissingFieldError when startDate is missing", async () => {
    await expect(
      createRotationPlan(mockPrisma(), { name: "P1" }),
    ).rejects.toMatchObject({
      name: "MissingFieldError",
      field: "startDate",
    });
  });

  it("throws InvalidDateError when startDate is unparseable", async () => {
    await expect(
      createRotationPlan(mockPrisma(), { name: "P1", startDate: "bogus" }),
    ).rejects.toBeInstanceOf(InvalidDateError);
  });

  it("creates the plan with sequenced steps when valid", async () => {
    const create = vi.fn().mockResolvedValue({ id: "p1", steps: [] });
    const prisma = mockPrisma(create);
    await createRotationPlan(prisma, {
      name: "  Spring 2026  ",
      startDate: "2026-05-01",
      notes: "first cycle",
      steps: [
        { campId: "c1", plannedStart: "2026-05-02", plannedDays: 5 },
        { campId: "c2", plannedStart: "2026-05-08", plannedDays: 7, mobId: "m1" },
      ],
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.name).toBe("Spring 2026");
    expect(data.notes).toBe("first cycle");
    expect(data.startDate).toBeInstanceOf(Date);
    expect(data.steps.create).toHaveLength(2);
    expect(data.steps.create[0].sequence).toBe(1);
    expect(data.steps.create[1].sequence).toBe(2);
    expect(data.steps.create[1].mobId).toBe("m1");
  });

  it("omits steps when input.steps is empty", async () => {
    const create = vi.fn().mockResolvedValue({ id: "p1", steps: [] });
    const prisma = mockPrisma(create);
    await createRotationPlan(prisma, { name: "P1", startDate: "2026-05-01" });
    expect(create.mock.calls[0][0].data.steps).toBeUndefined();
  });
});
