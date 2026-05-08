/**
 * Wave G2 (#166) — domain op `addRotationPlanStep`.
 *
 * Appends a new step at `max(sequence)+1` for the plan. Validates input
 * before any DB write.
 *
 * Throws:
 *  - `PlanNotFoundError`                              — plan does not exist
 *  - `MissingFieldError({ field: "campId" })`         — campId missing
 *  - `MissingFieldError({ field: "plannedStart" })`   — plannedStart missing
 *  - `InvalidDateError({ field: "plannedStart" })`    — plannedStart unparseable
 *  - `InvalidPlannedDaysError`                        — plannedDays not positive int
 */
import type { PrismaClient } from "@prisma/client";

import {
  InvalidDateError,
  InvalidPlannedDaysError,
  MissingFieldError,
} from "./errors";
import { getRotationPlanOrThrow } from "./get-plan";

export interface AddRotationPlanStepInput {
  campId?: unknown;
  mobId?: unknown;
  plannedStart?: unknown;
  plannedDays?: unknown;
  notes?: unknown;
}

export async function addRotationPlanStep(
  prisma: PrismaClient,
  planId: string,
  input: AddRotationPlanStepInput,
): Promise<Awaited<ReturnType<PrismaClient["rotationPlanStep"]["create"]>>> {
  await getRotationPlanOrThrow(prisma, planId);

  if (typeof input.campId !== "string" || input.campId.length === 0) {
    throw new MissingFieldError("campId");
  }
  if (typeof input.plannedStart !== "string" || input.plannedStart.length === 0) {
    throw new MissingFieldError("plannedStart");
  }
  const plannedStart = new Date(input.plannedStart);
  if (Number.isNaN(plannedStart.getTime())) {
    throw new InvalidDateError("plannedStart");
  }
  if (
    typeof input.plannedDays !== "number" ||
    !Number.isFinite(input.plannedDays) ||
    input.plannedDays < 1
  ) {
    throw new InvalidPlannedDaysError();
  }

  const lastStep = await prisma.rotationPlanStep.findFirst({
    where: { planId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const nextSequence = (lastStep?.sequence ?? 0) + 1;

  const mobId = typeof input.mobId === "string" ? input.mobId : null;
  const notes = typeof input.notes === "string" ? input.notes : null;

  return prisma.rotationPlanStep.create({
    data: {
      planId,
      sequence: nextSequence,
      campId: input.campId,
      mobId,
      plannedStart,
      plannedDays: input.plannedDays,
      notes,
    },
  });
}
