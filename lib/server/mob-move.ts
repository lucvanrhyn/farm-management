import type { PrismaClient } from "@prisma/client";

export class MobNotFoundError extends Error {
  constructor(mobId: string) {
    super(`Mob not found: ${mobId}`);
    this.name = "MobNotFoundError";
  }
}

export interface PerformMobMoveArgs {
  readonly mobId: string;
  readonly toCampId: string;
  readonly loggedBy: string | null;
}

export interface PerformMobMoveResult {
  readonly mobId: string;
  readonly mobName: string;
  readonly sourceCamp: string;
  readonly destCamp: string;
  readonly animalIds: readonly string[];
  readonly observedAt: Date;
  /** IDs of the two mob_movement observation rows: [sourceRow, destRow] */
  readonly observationIds: readonly [string, string];
}

/**
 * Performs a mob move server-side inside a single Prisma transaction:
 *  1. Looks up the mob (throws MobNotFoundError if missing)
 *  2. Guards against moving to the same camp (no-op phantom moves)
 *  3. Updates mob.currentCamp
 *  4. Batch-updates all active animals in the mob to the new camp
 *  5. Creates two mob_movement observation rows (source + destination)
 *  6. Returns both observation IDs and move metadata
 *
 * Called by the mob PATCH route and the plan-step execute route.
 */
export async function performMobMove(
  prisma: PrismaClient,
  { mobId, toCampId, loggedBy }: PerformMobMoveArgs,
): Promise<PerformMobMoveResult> {
  return prisma.$transaction(async (tx) => {
    const mob = await tx.mob.findUnique({ where: { id: mobId } });
    if (!mob) throw new MobNotFoundError(mobId);

    const sourceCamp = mob.currentCamp;

    // Guard: moving to same camp would create phantom observations
    if (sourceCamp === toCampId) {
      throw new Error(`Mob ${mob.name} is already in camp ${toCampId}`);
    }

    const affectedAnimals = await tx.animal.findMany({
      where: { mobId, status: "Active" },
      select: { id: true, animalId: true },
    });

    await tx.mob.update({
      where: { id: mobId },
      data: { currentCamp: toCampId },
    });

    if (affectedAnimals.length > 0) {
      await tx.animal.updateMany({
        where: { mobId, status: "Active" },
        data: { currentCamp: toCampId },
      });
    }

    const observedAt = new Date();
    const sharedDetails = JSON.stringify({
      mobId,
      mobName: mob.name,
      sourceCamp,
      destCamp: toCampId,
      animalCount: affectedAnimals.length,
      animalIds: affectedAnimals.map((a) => a.animalId),
    });

    // Two sequential creates to capture both observation IDs
    const sourceObs = await tx.observation.create({
      data: { type: "mob_movement", campId: sourceCamp, details: sharedDetails, observedAt, loggedBy },
      select: { id: true },
    });
    const destObs = await tx.observation.create({
      data: { type: "mob_movement", campId: toCampId, details: sharedDetails, observedAt, loggedBy },
      select: { id: true },
    });

    return {
      mobId,
      mobName: mob.name,
      sourceCamp,
      destCamp: toCampId,
      animalIds: affectedAnimals.map((a) => a.animalId),
      observedAt,
      observationIds: [sourceObs.id, destObs.id] as [string, string],
    };
  });
}
