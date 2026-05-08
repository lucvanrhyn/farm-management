/**
 * Wave G2 (#166) — domain op `listRotationPlans`.
 *
 * Lists every rotation plan for the tenant with steps eagerly loaded
 * (steps ordered by `sequence` asc; plans ordered by `updatedAt` desc).
 * Wire-shape preserved verbatim from the pre-G2 GET handler.
 */
import type { PrismaClient } from "@prisma/client";

export async function listRotationPlans(
  prisma: PrismaClient,
): Promise<Awaited<ReturnType<PrismaClient["rotationPlan"]["findMany"]>>> {
  return prisma.rotationPlan.findMany({
    include: { steps: { orderBy: { sequence: "asc" } } },
    orderBy: { updatedAt: "desc" },
  });
}
