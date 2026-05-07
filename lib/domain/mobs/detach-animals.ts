/**
 * Wave B (#151) — domain op `detachAnimalsFromMob`.
 *
 * Removes animals from a mob (sets `mobId = null`). Defensively filters
 * by species so a legacy wrong-species pin can't be silently un-pinned
 * via the wrong endpoint — combined with the actual-count response, the
 * caller can detect mismatches.
 */
import type { PrismaClient } from "@prisma/client";

import { MobNotFoundError } from "@/lib/server/mob-move";
import { RouteValidationError } from "@/lib/server/route";

export interface DetachAnimalsInput {
  mobId: string;
  animalIds: string[];
}

export type DetachAnimalsResult =
  | { success: true; count: number }
  | { success: true; count: number; requested: number; mismatched: number };

function buildResponseBody(
  actualCount: number,
  requestedCount: number,
): DetachAnimalsResult {
  if (actualCount === requestedCount) {
    return { success: true, count: actualCount };
  }
  return {
    success: true,
    count: actualCount,
    requested: requestedCount,
    mismatched: requestedCount - actualCount,
  };
}

export async function detachAnimalsFromMob(
  prisma: PrismaClient,
  input: DetachAnimalsInput,
): Promise<DetachAnimalsResult> {
  const mob = await prisma.mob.findUnique({ where: { id: input.mobId } });
  if (!mob) throw new MobNotFoundError(input.mobId);

  if (!Array.isArray(input.animalIds) || input.animalIds.length === 0) {
    throw new RouteValidationError("animalIds array is required", {
      fieldErrors: { animalIds: "animalIds array is required" },
    });
  }

  const { count } = await prisma.animal.updateMany({
    where: {
      animalId: { in: input.animalIds },
      mobId: input.mobId,
      species: mob.species,
    },
    data: { mobId: null },
  });

  return buildResponseBody(count, input.animalIds.length);
}
