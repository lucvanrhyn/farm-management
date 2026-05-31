/**
 * Issue #538 — apply the `Deceased` status (+ `deceasedAt`) via the replayed
 * `death` observation, NOT a fire-and-forget PATCH. The higher-stakes twin of
 * #100 (offline camp-move).
 *
 * `performAnimalDeath` is the death-recording mirror of `performAnimalMove`
 * (#100), which is itself the animal-level mirror of
 * `lib/domain/mobs/move-mob.ts` `performMobMove`: the CALLER owns the animal
 * mutation; the observation door (`createObservation`) stays a PURE writer. We
 * deliberately do NOT teach the door to read `details` and self-mutate — the
 * door's only job is the atomic observation create (ADR-0006), and `move-mob`
 * already established the convention that a sibling animal/mob mutation lives
 * in the caller, inside the same `$transaction`, so the two writes commit or
 * roll back together.
 *
 * Why this op exists (the #538 root cause):
 *   The logger's offline-safe path queues ONLY the `death` observation; the
 *   animal's `status = "Deceased"` (+ `deceasedAt`) change used to ride on a
 *   separate `navigator.onLine` fire-and-forget `PATCH /api/animals/[id]` that
 *   was dropped entirely when offline (no replay queue). Wiring the status
 *   mutation onto the REPLAYED observation (this op, invoked from the
 *   `POST /api/observations` route for `type === "death"`) makes the death
 *   survive a reconnect drain: the observation queue already replays
 *   idempotently via `clientLocalId` (#206), and setting `status = "Deceased"`
 *   with the SAME `deceasedAt` is naturally idempotent on replay.
 *
 * `deceasedAt` source — the death observation's `created_at` (the queued row's
 * timestamp = the moment of recording). This is deliberately NOT `new Date()`
 * (which the dropped PATCH used): on a #206 replay `new Date()` would drift to
 * a different value each drain, whereas the observation timestamp is fixed, so
 * the animal.update is idempotent. It is also the time-anchor `deceasedAt` is
 * read for downstream (IT3/inventory exits in `lib/server/inventory-replay.ts`
 * time-anchor an animal's exit off `deceasedAt`), so the recording time — not
 * the server's replay time — is the correct value.
 *
 * No same-camp-style guard: unlike #100's camp-move, a death is a single
 * terminal transition, so the animal.update ALWAYS fires. Re-applying
 * `status = "Deceased"` + the identical `deceasedAt` is harmless on replay.
 *
 * Keying note — the animal is updated by `animalId` (the TAG column), not the
 * cuid `id`: the offline observation's `animal_id` carries the tag, and
 * `createObservation` resolves the same animal via `where: { animalId }`.
 * Keeping both on the tag means one consistent identity across the update +
 * the door's species-stamping waterfall.
 */
import type { PrismaClient } from "@prisma/client";

import { createObservation } from "@/lib/domain/observations/create-observation";

export interface PerformAnimalDeathArgs {
  /** The animal TAG (the `animalId` column), as carried by the observation. */
  readonly animalId: string;
  /**
   * The `camp_id` written onto the observation row (the camp the death was
   * logged from). Forwarded verbatim so the observation's provenance is
   * unchanged.
   */
  readonly campId: string;
  /** The observation `details` JSON string (`{cause, carcassDisposal}`). */
  readonly details?: string | null;
  /**
   * ISO timestamp from the queued row (`obs.created_at`). Drives BOTH the
   * observation's `observedAt` and the animal's `deceasedAt`, so the death
   * time is the recording time and a replay re-applies the same value. Falls
   * back to `now` when absent (a bare server-side write).
   */
  readonly createdAt?: string | null;
  /** #206 idempotency key, replayed verbatim by the offline sync queue. */
  readonly clientLocalId?: string | null;
  /** #492 optional free-text note carried alongside the death. */
  readonly notes?: string | null;
  /** Email of the actor — captured on the observation audit trail. */
  readonly loggedBy: string | null;
}

/**
 * Performs an animal death-recording server-side inside a single Prisma
 * transaction, mirroring `performAnimalMove`:
 *
 *   1. `tx.animal.update` setting `status = "Deceased"` AND `deceasedAt` to the
 *      death observation's timestamp (always — a death is terminal).
 *   2. `createObservation(tx, <death observation>)` — atomic with step 1.
 *
 * Returns the door's create result (`{ success, id }`). A throw from either
 * half propagates out of the `$transaction` callback so Prisma aborts the
 * transaction — neither write commits (transactionality): never a Deceased
 * animal with no death observation, nor an orphan death observation on a
 * still-Active animal.
 *
 * Owns its own `$transaction` (exactly like `performAnimalMove` /
 * `performMobMove`), so the `POST /api/observations` route calls it bare —
 * `performAnimalDeath(ctx.prisma, …)` — for `type === "death"`.
 */
export async function performAnimalDeath(
  prisma: PrismaClient,
  {
    animalId,
    campId,
    details,
    createdAt,
    clientLocalId,
    notes,
    loggedBy,
  }: PerformAnimalDeathArgs,
): Promise<{ success: true; id: string }> {
  // `deceasedAt` is the death observation's recording time (idempotent across
  // replays), falling back to `now` only for a bare server-side write that
  // carries no timestamp.
  const deceasedAt = createdAt ?? new Date().toISOString();

  return prisma.$transaction(async (tx) => {
    // Caller owns the mutation — keyed on the TAG column (animalId), matching
    // the door's animal lookup. Mirrors `performAnimalMove`'s currentCamp
    // write, with two fields (the terminal status + its anchor date).
    await tx.animal.update({
      where: { animalId },
      data: { status: "Deceased", deceasedAt },
    });

    // The door stays pure — it receives the tx client so the observation
    // create is atomic with the status update above. The door runs its own
    // camp-existence + species-stamping waterfall off `animal_id`, and the
    // ADR-0007 death `details` validation (single-cause + carcassDisposal).
    return createObservation(tx, {
      type: "death",
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
