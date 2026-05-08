/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — `addRotationPlanStep` tests.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { addRotationPlanStep } from "@/lib/domain/rotation/add-step";
import {
  InvalidDateError,
  InvalidPlannedDaysError,
  PlanNotFoundError,
} from "@/lib/domain/rotation/errors";

function mockPrisma(opts: {
  planExists?: boolean;
  lastSeq?: number | null;
  create?: ReturnType<typeof vi.fn>;
} = {}) {
  const planExists = opts.planExists ?? true;
  return {
    rotationPlan: {
      findUnique: vi
        .fn()
        .mockResolvedValue(planExists ? { id: "p1" } : null),
    },
    rotationPlanStep: {
      findFirst: vi
        .fn()
        .mockResolvedValue(opts.lastSeq != null ? { sequence: opts.lastSeq } : null),
      create:
        opts.create ??
        vi.fn().mockResolvedValue({ id: "s1", planId: "p1", sequence: 1 }),
    },
  } as unknown as PrismaClient;
}

describe("addRotationPlanStep", () => {
  it("throws PlanNotFoundError when plan missing", async () => {
    await expect(
      addRotationPlanStep(mockPrisma({ planExists: false }), "p1", {
        campId: "c1",
        plannedStart: "2026-05-02",
        plannedDays: 5,
      }),
    ).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it("throws MissingFieldError campId when missing", async () => {
    await expect(
      addRotationPlanStep(mockPrisma(), "p1", {
        plannedStart: "2026-05-02",
        plannedDays: 5,
      }),
    ).rejects.toMatchObject({ name: "MissingFieldError", field: "campId" });
  });

  it("throws MissingFieldError plannedStart when missing", async () => {
    await expect(
      addRotationPlanStep(mockPrisma(), "p1", {
        campId: "c1",
        plannedDays: 5,
      }),
    ).rejects.toMatchObject({
      name: "MissingFieldError",
      field: "plannedStart",
    });
  });

  it("throws InvalidDateError when plannedStart unparseable", async () => {
    await expect(
      addRotationPlanStep(mockPrisma(), "p1", {
        campId: "c1",
        plannedStart: "bogus",
        plannedDays: 5,
      }),
    ).rejects.toBeInstanceOf(InvalidDateError);
  });

  it("throws InvalidPlannedDaysError when plannedDays < 1", async () => {
    await expect(
      addRotationPlanStep(mockPrisma(), "p1", {
        campId: "c1",
        plannedStart: "2026-05-02",
        plannedDays: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidPlannedDaysError);
  });

  it("throws InvalidPlannedDaysError when plannedDays not a number", async () => {
    await expect(
      addRotationPlanStep(mockPrisma(), "p1", {
        campId: "c1",
        plannedStart: "2026-05-02",
        plannedDays: "5" as unknown as number,
      }),
    ).rejects.toBeInstanceOf(InvalidPlannedDaysError);
  });

  it("appends at sequence = max(sequence)+1", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: "s1", planId: "p1", sequence: 4 });
    const prisma = mockPrisma({ lastSeq: 3, create });
    await addRotationPlanStep(prisma, "p1", {
      campId: "c1",
      plannedStart: "2026-05-02",
      plannedDays: 5,
      mobId: "m1",
      notes: "spring",
    });
    const data = create.mock.calls[0][0].data;
    expect(data.sequence).toBe(4);
    expect(data.campId).toBe("c1");
    expect(data.mobId).toBe("m1");
    expect(data.notes).toBe("spring");
    expect(data.plannedStart).toBeInstanceOf(Date);
  });

  it("starts sequence at 1 when no prior steps", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: "s1", planId: "p1", sequence: 1 });
    const prisma = mockPrisma({ lastSeq: null, create });
    await addRotationPlanStep(prisma, "p1", {
      campId: "c1",
      plannedStart: "2026-05-02",
      plannedDays: 5,
    });
    expect(create.mock.calls[0][0].data.sequence).toBe(1);
  });
});
