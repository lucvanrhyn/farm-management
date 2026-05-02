import type { PrismaClient } from "@prisma/client";

export class MobNotFoundError extends Error {
  constructor(mobId: string) {
    super(`Mob not found: ${mobId}`);
    this.name = "MobNotFoundError";
  }
}

/**
 * Typed error code for #28 Phase B cross-species hard-block. The API layer
 * maps this onto an HTTP 422 with `{ error: "CROSS_SPECIES_BLOCKED" }`.
 *
 * Spec: each species (cattle/sheep/game) is a fully-isolated workspace inside
 * one tenant. A cattle mob may never sit in a sheep camp; an animal's parent
 * must always be the same species as the child.
 */
export const CROSS_SPECIES_BLOCKED = "CROSS_SPECIES_BLOCKED";

export class CrossSpeciesBlockedError extends Error {
  readonly code = CROSS_SPECIES_BLOCKED;
  readonly mobSpecies: string | null;
  readonly campSpecies: string | null;

  constructor(mobSpecies: string | null, campSpecies: string | null) {
    super(CROSS_SPECIES_BLOCKED);
    this.name = "CrossSpeciesBlockedError";
    this.mobSpecies = mobSpecies;
    this.campSpecies = campSpecies;
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

    // #28 Phase B — cross-species hard-block. Look up the destination camp
    // by `campId`. If the camp exists and its species differs from the mob's,
    // throw CROSS_SPECIES_BLOCKED. If no camp row is found at all
    // (legacy/unknown), allow the move so legacy data doesn't break in prod —
    // Phase A backfilled species to 'cattle', so this null branch is
    // defensive.
    // TODO(#28): once all tenants are confirmed migrated, tighten to throw on null.
    const destCamp = await tx.camp.findFirst({
      where: { campId: toCampId },
      select: { species: true },
    });
    if (destCamp && destCamp.species !== mob.species) {
      throw new CrossSpeciesBlockedError(mob.species, destCamp.species);
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
