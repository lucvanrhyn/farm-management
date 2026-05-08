/**
 * Wave G2 (#166) — domain op `getRotationPlan` / `getRotationPlanOrThrow`.
 *
 * `getRotationPlan` returns null if the plan is missing — used internally
 * by the write ops where caller wants to inspect existence before mutating.
 * `getRotationPlanOrThrow` throws `PlanNotFoundError` so the adapter envelope
 * mints 404 PLAN_NOT_FOUND. Routes hitting the GET endpoint use the
 * throwing variant so the wire shape stays consistent with the rest of the
 * waved domain ops.
 */
import type { PrismaClient } from "@prisma/client";

import { PlanNotFoundError } from "./errors";

export async function getRotationPlan(
  prisma: PrismaClient,
  planId: string,
): Promise<Awaited<ReturnType<PrismaClient["rotationPlan"]["findUnique"]>>> {
  return prisma.rotationPlan.findUnique({
    where: { id: planId },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
}

export async function getRotationPlanOrThrow(
  prisma: PrismaClient,
  planId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getRotationPlan>>>> {
  const plan = await getRotationPlan(prisma, planId);
  if (!plan) {
    throw new PlanNotFoundError(planId);
  }
  return plan;
}
