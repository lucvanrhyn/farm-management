/**
 * Wave B (#151) — domain op `detachAnimalsFromMob`.
 *
 * Removes animals from a mob (sets `mobId = null`). Defensively filters
 * by species so a legacy wrong-species pin can't be silently un-pinned
 * via the wrong endpoint — combined with the actual-count response, the
 * caller can detect mismatches.
 */
import type { PrismaClient } from "@prisma/client";

import { MobNotFoundError } from "./move-mob";
import { RouteValidationError } from "@/lib/server/route";
import { scoped } from "@/lib/server/species-scoped-prisma";
import type { SpeciesId } from "@/lib/species/types";

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

  // Defensive species filter — routed through scoped(prisma, mob.species)
  // so the cross-species guard is injected structurally instead of inline.
  const { count } = await scoped(
    prisma,
    mob.species as SpeciesId,
  ).animal.updateMany({
    where: {
      animalId: { in: input.animalIds },
      mobId: input.mobId,
    },
    data: { mobId: null },
  });

  return buildResponseBody(count, input.animalIds.length);
}
