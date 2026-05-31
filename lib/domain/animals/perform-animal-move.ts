/**
 * Issue #100 — apply `currentCamp` via the replayed `animal_movement`
 * observation, NOT a fire-and-forget PATCH.
 *
 * `performAnimalMove` is the animal-level mirror of
 * `lib/domain/mobs/move-mob.ts` `performMobMove`: the CALLER owns the
 * `currentCamp` mutation; the observation door (`createObservation`) stays
 * a PURE writer. We deliberately do NOT teach the door to read `details`
 * and self-mutate — the door's only job is the atomic observation create
 * (ADR-0006), and `move-mob` already established the convention that a
 * sibling animal/mob mutation lives in the caller, inside the same
 * `$transaction`, so the two writes commit or roll back together.
 *
 * Why this op exists (the #100 root cause):
 *   The logger's offline-safe path queues ONLY the `animal_movement`
 *   observation; the currentCamp change used to ride on a separate
 *   `navigator.onLine` fire-and-forget `PATCH /api/animals/[id]` that was
 *   dropped entirely when offline (no replay queue). Wiring the currentCamp
 *   mutation onto the REPLAYED observation (this op, invoked from the
 *   `POST /api/observations` route for `type === "animal_movement"`) makes
 *   the move survive a reconnect drain: the observation queue already
 *   replays idempotently via `clientLocalId` (#206), and setting
 *   `currentCamp = destCampId` is naturally idempotent on replay.
 *
 * Keying note — the animal is updated by `animalId` (the TAG column), not
 * the cuid `id`: the offline observation's `details.animalId` carries the
 * tag, and `createObservation` resolves the same animal via
 * `where: { animalId }`. Keeping both on the tag means one consistent
 * identity across the update + the door's species-stamping waterfall.
 *
 * Same-camp guard: when `sourceCampId === destCampId` the move is a no-op
 * for `currentCamp` (no phantom write), mirroring `performMobMove`'s
 * same-camp guard — but UNLIKE the mob path we still record the observation
 * (the move was logged; it is an audit event even if the camp is unchanged,
 * and a replayed row must remain idempotent rather than throw).
 */
import type { PrismaClient } from "@prisma/client";

import { createObservation } from "@/lib/domain/observations/create-observation";

export interface PerformAnimalMoveArgs {
  /** The animal TAG (the `animalId` column), as carried by the observation. */
  readonly animalId: string;
  /** The camp the animal is leaving — drives the same-camp no-op guard. */
  readonly sourceCampId: string;
  /** The destination camp the animal's `currentCamp` advances to. */
  readonly destCampId: string;
  /**
   * The `camp_id` written onto the observation row. For an `animal_movement`
   * the logger posts the SOURCE camp as `camp_id` (the page it was logged
   * from); forwarded verbatim so the observation's provenance is unchanged.
   */
  readonly campId: string;
  /** The observation `details` JSON string (`{animalId, sourceCampId, destCampId}`). */
  readonly details?: string | null;
  /** ISO timestamp from the queued row (`obs.created_at`), or null → now. */
  readonly createdAt?: string | null;
  /** #206 idempotency key, replayed verbatim by the offline sync queue. */
  readonly clientLocalId?: string | null;
  /** #492 optional free-text note carried alongside the movement. */
  readonly notes?: string | null;
  /** Email of the actor — captured on the observation audit trail. */
  readonly loggedBy: string | null;
}

/**
 * Performs an animal camp-move server-side inside a single Prisma
 * transaction, mirroring `performMobMove`:
 *
 *   1. (cross-camp only) `tx.animal.update` advancing `currentCamp` to the
 *      destination camp. Skipped when source === dest (no phantom write).
 *   2. `createObservation(tx, <animal_movement>)` — atomic with step 1.
 *
 * Returns the door's create result (`{ success, id }`). A throw from either
 * half propagates out of the `$transaction` callback so Prisma aborts the
 * transaction — neither write commits (transactionality).
 *
 * Owns its own `$transaction` (exactly like `performMobMove`), so the
 * `POST /api/observations` route calls it bare — `performAnimalMove(ctx.prisma, …)`
 * — for `type === "animal_movement"`.
 */
export async function performAnimalMove(
  prisma: PrismaClient,
  {
    animalId,
    sourceCampId,
    destCampId,
    campId,
    details,
    createdAt,
    clientLocalId,
    notes,
    loggedBy,
  }: PerformAnimalMoveArgs,
): Promise<{ success: true; id: string }> {
  return prisma.$transaction(async (tx) => {
    // Cross-camp only: a same-camp move would write currentCamp = its own
    // value (harmless, but skip it to avoid a no-op UPDATE). Mirrors the
    // `performMobMove` same-camp guard. The observation below is still
    // recorded so the audit trail + #206 idempotency are unaffected.
    if (sourceCampId !== destCampId) {
      await tx.animal.update({
        where: { animalId },
        data: { currentCamp: destCampId },
      });
    }

    // The door stays pure — it receives the tx client so the observation
    // create is atomic with the currentCamp update above. The door runs its
    // own camp-existence + species-stamping waterfall off `animal_id`.
    return createObservation(tx, {
      type: "animal_movement",
      camp_id: campId,
      animal_id: animalId,
      details: details ?? "",
      created_at: createdAt ?? null,
      clientLocalId: clientLocalId ?? null,
      notes: notes ?? null,
      loggedBy,
    });
  });
}
