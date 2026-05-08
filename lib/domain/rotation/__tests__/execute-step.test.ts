/**
 * @vitest-environment node
 *
 * Wave G2 (#166) — `executeRotationPlanStep` tests.
 *
 * `performMobMove` is mocked at the module boundary so the test exercises
 * the route-business logic (step validation, mob fallback, executed-step
 * detection, error mapping) without touching Prisma transactions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const { performMobMoveMock } = vi.hoisted(() => ({
  performMobMoveMock: vi.fn(),
}));

vi.mock("@/lib/domain/mobs/move-mob", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/domain/mobs/move-mob")
  >("@/lib/domain/mobs/move-mob");
  return {
    ...actual,
    performMobMove: performMobMoveMock,
  };
});

import { executeRotationPlanStep } from "@/lib/domain/rotation/execute-step";
import {
  MissingMobIdError,
  MobAlreadyInCampError,
  StepNotFoundError,
} from "@/lib/domain/rotation/errors";
import { MobNotFoundError } from "@/lib/domain/mobs/move-mob";

function mockPrisma(opts: {
  step?: { id: string; planId: string; status: string; mobId: string | null; campId: string } | null;
  updatedStep?: unknown;
} = {}) {
  return {
    rotationPlanStep: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.step === undefined
            ? { id: "s1", planId: "p1", status: "pending", mobId: "m1", campId: "c1" }
            : opts.step,
        ),
      update: vi
        .fn()
        .mockResolvedValue(
          opts.updatedStep ?? {
            id: "s1",
            status: "executed",
            actualStart: new Date(),
            executedObservationId: "obs2",
          },
        ),
    },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  performMobMoveMock.mockReset();
});

describe("executeRotationPlanStep", () => {
  it("throws StepNotFoundError when step is missing", async () => {
    const prisma = mockPrisma({ step: null });
    await expect(
      executeRotationPlanStep(prisma, "p1", "s1", {}),
    ).rejects.toBeInstanceOf(StepNotFoundError);
  });

  it("throws StepNotFoundError when step belongs to a different plan", async () => {
    const prisma = mockPrisma({
      step: {
        id: "s1",
        planId: "OTHER",
        status: "pending",
        mobId: "m1",
        campId: "c1",
      },
    });
    await expect(
      executeRotationPlanStep(prisma, "p1", "s1", {}),
    ).rejects.toBeInstanceOf(StepNotFoundError);
  });

  it("throws StepAlreadyExecutedError when status !== 'pending'", async () => {
    const prisma = mockPrisma({
      step: {
        id: "s1",
        planId: "p1",
        status: "executed",
        mobId: "m1",
        campId: "c1",
      },
    });
    await expect(
      executeRotationPlanStep(prisma, "p1", "s1", {}),
    ).rejects.toMatchObject({
      name: "StepAlreadyExecutedError",
      currentStatus: "executed",
    });
  });

  it("throws MissingMobIdError when no mobId is supplied + step.mobId is null", async () => {
    const prisma = mockPrisma({
      step: {
        id: "s1",
        planId: "p1",
        status: "pending",
        mobId: null,
        campId: "c1",
      },
    });
    await expect(
      executeRotationPlanStep(prisma, "p1", "s1", {}),
    ).rejects.toBeInstanceOf(MissingMobIdError);
  });

  it("re-throws MobNotFoundError unchanged", async () => {
    performMobMoveMock.mockRejectedValueOnce(new MobNotFoundError("m1"));
    const prisma = mockPrisma();
    await expect(
      executeRotationPlanStep(prisma, "p1", "s1", { mobId: "m1" }),
    ).rejects.toBeInstanceOf(MobNotFoundError);
  });

  it("wraps 'already in camp' error as MobAlreadyInCampError", async () => {
    performMobMoveMock.mockRejectedValueOnce(
      new Error("Mob Brahmans is already in camp NORTH-01"),
    );
    const prisma = mockPrisma();
    await expect(
      executeRotationPlanStep(prisma, "p1", "s1", {}),
    ).rejects.toBeInstanceOf(MobAlreadyInCampError);
  });

  it("rethrows unknown errors unchanged", async () => {
    const boom = new Error("boom");
    performMobMoveMock.mockRejectedValueOnce(boom);
    const prisma = mockPrisma();
    await expect(
      executeRotationPlanStep(prisma, "p1", "s1", {}),
    ).rejects.toBe(boom);
  });

  it("returns step + move payload on success", async () => {
    const observedAt = new Date("2026-05-08T10:00:00.000Z");
    performMobMoveMock.mockResolvedValueOnce({
      mobId: "m1",
      mobName: "Brahmans",
      sourceCamp: "NORTH-00",
      destCamp: "NORTH-01",
      animalIds: ["a1", "a2", "a3"],
      observedAt,
      observationIds: ["obs1", "obs2"] as const,
    });
    const updateMock = vi.fn().mockResolvedValue({
      id: "s1",
      status: "executed",
      actualStart: observedAt,
      executedObservationId: "obs2",
    });
    const prisma = {
      rotationPlanStep: {
        findUnique: vi.fn().mockResolvedValue({
          id: "s1",
          planId: "p1",
          status: "pending",
          mobId: "m1",
          campId: "NORTH-01",
        }),
        update: updateMock,
      },
    } as unknown as PrismaClient;

    const result = await executeRotationPlanStep(prisma, "p1", "s1", {
      loggedBy: "luc@example.com",
    });

    expect(performMobMoveMock).toHaveBeenCalledWith(prisma, {
      mobId: "m1",
      toCampId: "NORTH-01",
      loggedBy: "luc@example.com",
    });
    expect(result.move).toEqual({
      mobId: "m1",
      mobName: "Brahmans",
      sourceCamp: "NORTH-00",
      destCamp: "NORTH-01",
      animalCount: 3,
      observedAt,
    });
    expect(result.step.status).toBe("executed");
    expect(updateMock.mock.calls[0][0].data.executedObservationId).toBe("obs2");
  });

  it("prefers body.mobId over step.mobId when both present", async () => {
    performMobMoveMock.mockResolvedValueOnce({
      mobId: "m-OVERRIDE",
      mobName: "Override",
      sourceCamp: "X",
      destCamp: "c1",
      animalIds: [],
      observedAt: new Date(),
      observationIds: ["a", "b"] as const,
    });
    const prisma = mockPrisma();
    await executeRotationPlanStep(prisma, "p1", "s1", { mobId: "m-OVERRIDE" });
    expect(performMobMoveMock).toHaveBeenCalledWith(prisma, {
      mobId: "m-OVERRIDE",
      toCampId: "c1",
      loggedBy: null,
    });
  });
});
