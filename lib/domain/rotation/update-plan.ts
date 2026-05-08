/**
 * Wave G2 (#166) — domain op `updateRotationPlan`.
 *
 * Validates input + applies a partial update. Wire shape preserved
 * verbatim from the pre-G2 PATCH handler — only the fields present in
 * the body are written.
 *
 * Throws:
 *  - `PlanNotFoundError`                          — plan does not exist
 *  - `InvalidStatusError`                         — status not in allow-list
 *  - `BlankNameError`                              — name provided but trimmed empty
 *  - `InvalidDateError({ field: "startDate" })`   — startDate unparseable
 */
import type { PrismaClient } from "@prisma/client";

import {
  BlankNameError,
  InvalidDateError,
  InvalidStatusError,
  ROTATION_PLAN_STATUSES,
  type RotationPlanStatus,
} from "./errors";
import { getRotationPlanOrThrow } from "./get-plan";

export interface UpdateRotationPlanInput {
  name?: unknown;
  startDate?: unknown;
  status?: unknown;
  notes?: unknown;
}

function isRotationStatus(value: unknown): value is RotationPlanStatus {
  return (
    typeof value === "string" &&
    (ROTATION_PLAN_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

export async function updateRotationPlan(
  prisma: PrismaClient,
  planId: string,
  input: UpdateRotationPlanInput,
): Promise<Awaited<ReturnType<PrismaClient["rotationPlan"]["update"]>>> {
  // Throws PlanNotFoundError when missing — adapter envelope mints 404.
  await getRotationPlanOrThrow(prisma, planId);

  // Validate status BEFORE mutating anything (mirror pre-G2 order).
  if (input.status !== undefined && !isRotationStatus(input.status)) {
    throw new InvalidStatusError();
  }

  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      throw new BlankNameError();
    }
    const trimmed = input.name.trim();
    if (trimmed.length === 0) {
      throw new BlankNameError();
    }
    updateData.name = trimmed;
  }

  if (input.startDate !== undefined) {
    if (typeof input.startDate !== "string") {
      throw new InvalidDateError("startDate");
    }
    const d = new Date(input.startDate);
    if (Number.isNaN(d.getTime())) {
      throw new InvalidDateError("startDate");
    }
    updateData.startDate = d;
  }

  if (input.status !== undefined) {
    updateData.status = input.status as RotationPlanStatus;
  }

  if (input.notes !== undefined) {
    updateData.notes = input.notes;
  }

  return prisma.rotationPlan.update({
    where: { id: planId },
    data: updateData,
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
}
