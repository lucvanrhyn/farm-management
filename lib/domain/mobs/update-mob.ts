/**
 * Wave B (#151) — domain op `updateMob`.
 *
 * Single op that handles both name and currentCamp mutations on a mob:
 *  - When currentCamp changes, delegates to `performMobMove` (kept in
 *    `lib/server/mob-move.ts` per the wave B scope) which runs the
 *    cross-species hard-block + observation-row creation inside a single
 *    Prisma transaction.
 *  - When name changes (with or without a camp change), persists the new
 *    name via a follow-up `mob.update`.
 *
 * Throws `MobNotFoundError` when the mob doesn't exist; bubbles
 * `CrossSpeciesBlockedError` from `performMobMove` unchanged so the
 * adapter envelope can map it onto 422.
 */
import type { PrismaClient } from "@prisma/client";

import {
  performMobMove,
  MobNotFoundError,
} from "./move-mob";

export interface UpdateMobInput {
  mobId: string;
  name?: string;
  currentCamp?: string;
  /** Email of the actor — passed through to mob_movement observation rows. */
  loggedBy: string | null;
}

export interface UpdateMobResult {
  id: string;
  name: string;
  current_camp: string;
}

export async function updateMob(
  prisma: PrismaClient,
  input: UpdateMobInput,
): Promise<UpdateMobResult> {
  const mob = await prisma.mob.findUnique({ where: { id: input.mobId } });
  if (!mob) throw new MobNotFoundError(input.mobId);

  // Camp change → performMobMove (handles cross-species hard-block, animal
  // sweep, observation rows, transaction).
  if (input.currentCamp && input.currentCamp !== mob.currentCamp) {
    await performMobMove(prisma, {
      mobId: input.mobId,
      toCampId: input.currentCamp,
      loggedBy: input.loggedBy,
    });
  }

  // Persist any other field updates (name today; future: extend as fields land).
  const fieldUpdates: Record<string, unknown> = {};
  if (input.name !== undefined) fieldUpdates.name = input.name;

  const updatedMob = Object.keys(fieldUpdates).length > 0
    ? await prisma.mob.update({
        where: { id: input.mobId },
        data: fieldUpdates,
      })
    : await prisma.mob.findUniqueOrThrow({ where: { id: input.mobId } });

  return {
    id: updatedMob.id,
    name: updatedMob.name,
    current_camp: updatedMob.currentCamp,
  };
}
