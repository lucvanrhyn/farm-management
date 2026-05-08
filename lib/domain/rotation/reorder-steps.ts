/**
 * Wave G2 (#166) — domain op `reorderRotationPlanSteps`.
 *
 * Reorders the pending steps of a plan to match a caller-supplied array
 * of step IDs. Validates that the supplied array is exactly a permutation
 * of the plan's pending steps before mutating any sequence numbers.
 *
 * Throws:
 *  - `PlanNotFoundError`         — plan does not exist
 *  - `InvalidOrderError`         — order array is empty / not a permutation
 *
 * Returns every step (pending + executed/skipped) in `sequence asc` order
 * — same shape as the pre-G2 PUT handler.
 */
import type { PrismaClient } from "@prisma/client";

import { InvalidOrderError } from "./errors";
import { getRotationPlanOrThrow } from "./get-plan";

export interface ReorderRotationPlanStepsInput {
  order?: unknown;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return null;
  if (value.some((v) => typeof v !== "string")) return null;
  return value as string[];
}

export async function reorderRotationPlanSteps(
  prisma: PrismaClient,
  planId: string,
  input: ReorderRotationPlanStepsInput,
): Promise<Awaited<ReturnType<PrismaClient["rotationPlanStep"]["findMany"]>>> {
  await getRotationPlanOrThrow(prisma, planId);

  const order = asStringArray(input.order);
  if (!order) {
    throw new InvalidOrderError(0, 0);
  }

  // Validate `order` is a permutation of the current pending steps.
  const currentSteps = await prisma.rotationPlanStep.findMany({
    where: { planId, status: "pending" },
    select: { id: true },
  });
  const currentIds = new Set(currentSteps.map((s) => s.id));
  const orderSet = new Set(order);
  const isPermutation =
    order.length === currentSteps.length &&
    order.every((id) => currentIds.has(id)) &&
    currentSteps.every((s) => orderSet.has(s.id));
  if (!isPermutation) {
    throw new InvalidOrderError(currentSteps.length, order.length);
  }

  await Promise.all(
    order.map((stepId, idx) =>
      prisma.rotationPlanStep.update({
        where: { id: stepId },
        data: { sequence: idx + 1 },
      }),
    ),
  );

  return prisma.rotationPlanStep.findMany({
    where: { planId },
    orderBy: { sequence: "asc" },
  });
}
