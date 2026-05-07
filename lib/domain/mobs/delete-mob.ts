/**
 * Wave B (#151) — domain op `deleteMob`.
 *
 * Hard-blocks deletion of a mob that still has active animals attached
 * (legacy contract: 409 with the count-bearing message). Throws
 * `MobNotFoundError` when the mob doesn't exist.
 */
import type { PrismaClient } from "@prisma/client";

import { MobNotFoundError } from "@/lib/server/mob-move";

import { MobHasAnimalsError } from "./errors";

export interface DeleteMobResult {
  success: true;
}

export async function deleteMob(
  prisma: PrismaClient,
  mobId: string,
): Promise<DeleteMobResult> {
  const mob = await prisma.mob.findUnique({ where: { id: mobId } });
  if (!mob) throw new MobNotFoundError(mobId);

  // cross-species by design: mobId is already the per-species scope key.
  const assignedCount = await prisma.animal.count({
    where: { mobId, status: "Active" },
  });
  if (assignedCount > 0) {
    throw new MobHasAnimalsError(assignedCount);
  }

  await prisma.mob.delete({ where: { id: mobId } });

  return { success: true };
}
