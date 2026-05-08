/**
 * Wave G2 (#166) — domain op `deleteRotationPlan`.
 *
 * Deletes the plan + every step that belongs to it. We delete steps
 * explicitly first because libSQL does not enforce FK CASCADE by default
 * (preserved verbatim from pre-G2 DELETE handler).
 *
 * Throws `PlanNotFoundError` when the plan is missing — adapter envelope
 * mints 404 PLAN_NOT_FOUND.
 */
import type { PrismaClient } from "@prisma/client";

import { getRotationPlanOrThrow } from "./get-plan";

export async function deleteRotationPlan(
  prisma: PrismaClient,
  planId: string,
): Promise<{ success: true }> {
  await getRotationPlanOrThrow(prisma, planId);

  await prisma.rotationPlanStep.deleteMany({ where: { planId } });
  await prisma.rotationPlan.delete({ where: { id: planId } });

  return { success: true };
}
