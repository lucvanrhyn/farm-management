/**
 * lib/domain/animals/__tests__/perform-animal-move.test.ts
 *
 * Issue #100 — offline camp-move is silently lost (no replay).
 *
 * `performAnimalMove` is the animal-level mirror of
 * `lib/domain/mobs/move-mob.ts` `performMobMove`: the CALLER owns the
 * `currentCamp` mutation (the observation door stays a pure writer). The
 * op runs inside a single `$transaction`:
 *
 *   1. (cross-camp only) `tx.animal.update` advancing `currentCamp` to the
 *      destination camp,
 *   2. `createObservation(tx, <the animal_movement observation>)` — atomic
 *      with the update above.
 *
 * The currentCamp mutation is now triggered BY the replayed observation
 * (the only thing queued offline), so an offline camp-move survives a
 * reconnect drain instead of being lost with the fire-and-forget PATCH.
 *
 * The animal is keyed on `animalId` (the tag column), NOT the cuid `id`:
 * the offline observation's `details.animalId` carries the tag, and
 * `createObservation` resolves the same animal via `where: { animalId }`.
 *
 * vi.mock factories hoist above top-level const declarations, so any state
 * the factories need must come from vi.hoisted
 * (per memory/feedback-vi-hoisted-shared-mocks.md). We mock the
 * `createObservation` door so this unit test pins the TRANSACTION SHAPE
 * (caller-derives the mutation; door is invoked with the tx client) without
 * re-exercising the door's internals — exactly the seam
 * `mob-move-cross-species.test.ts` uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { animalUpdateMock, createObservationMock, prismaMock } = vi.hoisted(
  () => {
    const animalUpdate = vi.fn();
    const createObservation = vi.fn();

    // The transaction callback receives a tx client. We pass the same prisma
    // mock so spies fire regardless of whether the code uses tx.* or prisma.*.
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
      animal: { update: animalUpdate },
    };

    return {
      animalUpdateMock: animalUpdate,
      createObservationMock: createObservation,
      prismaMock: prisma,
    };
  },
);

vi.mock("@/lib/domain/observations/create-observation", () => ({
  createObservation: createObservationMock,
}));

import { performAnimalMove } from "@/lib/domain/animals/perform-animal-move";
import type { PrismaClient } from "@prisma/client";

const baseArgs = (
  overrides: Partial<{
    animalId: string;
    sourceCampId: string;
    destCampId: string;
    campId: string;
    details: string;
    createdAt: string | null;
    clientLocalId: string | null;
    loggedBy: string | null;
  }> = {},
) => ({
  animalId: "BB-C014",
  sourceCampId: "camp-source",
  destCampId: "camp-dest",
  campId: "camp-source",
  details: JSON.stringify({
    animalId: "BB-C014",
    sourceCampId: "camp-source",
    destCampId: "camp-dest",
  }),
  createdAt: "2026-05-30T10:00:00.000Z",
  clientLocalId: "11111111-1111-4111-8111-111111111111",
  loggedBy: "logger@farm.co.za",
  ...overrides,
});

describe("performAnimalMove (#100)", () => {
  beforeEach(() => {
    animalUpdateMock.mockReset();
    createObservationMock.mockReset();
    prismaMock.$transaction.mockClear();

    animalUpdateMock.mockResolvedValue({});
    createObservationMock.mockResolvedValue({ success: true, id: "obs-1" });
  });

  it("advances currentCamp to destCampId AND writes the animal_movement observation atomically", async () => {
    const args = baseArgs();
    const result = await performAnimalMove(
      prismaMock as unknown as PrismaClient,
      args,
    );

    // Caller owns the mutation — keyed on the TAG column (animalId), matching
    // the door's animal lookup, NOT the cuid `id`.
    expect(animalUpdateMock).toHaveBeenCalledTimes(1);
    expect(animalUpdateMock).toHaveBeenCalledWith({
      where: { animalId: "BB-C014" },
      data: { currentCamp: "camp-dest" },
    });

    // Door stays pure — invoked with the tx client (same prismaMock) so the
    // observation create is atomic with the update above.
    expect(createObservationMock).toHaveBeenCalledTimes(1);
    const [writer, obsInput] = createObservationMock.mock.calls[0];
    expect(writer).toBe(prismaMock);
    expect(obsInput).toMatchObject({
      type: "animal_movement",
      camp_id: "camp-source",
      animal_id: "BB-C014",
      details: args.details,
      created_at: "2026-05-30T10:00:00.000Z",
      clientLocalId: "11111111-1111-4111-8111-111111111111",
      loggedBy: "logger@farm.co.za",
    });

    // Both writes ran inside the single transaction.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    expect(result).toMatchObject({ success: true, id: "obs-1" });
  });

  it("does NOT touch currentCamp on a same-camp move (no-op) but still writes the observation", async () => {
    const args = baseArgs({
      sourceCampId: "camp-A",
      destCampId: "camp-A",
      campId: "camp-A",
      details: JSON.stringify({
        animalId: "BB-C014",
        sourceCampId: "camp-A",
        destCampId: "camp-A",
      }),
    });

    await performAnimalMove(prismaMock as unknown as PrismaClient, args);

    // Same-camp guard: no phantom currentCamp write.
    expect(animalUpdateMock).not.toHaveBeenCalled();
    // The observation is still recorded (audit trail of the no-op move).
    expect(createObservationMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back the currentCamp update when the observation create fails (transactionality)", async () => {
    // The door throws (e.g. AnimalNotFoundError / a validation error). Because
    // both halves share the one $transaction the real Prisma client would roll
    // back the animal.update too — we assert the throw propagates so the
    // transaction is aborted (never a half-applied move).
    createObservationMock.mockRejectedValue(new Error("door blew up"));

    await expect(
      performAnimalMove(prismaMock as unknown as PrismaClient, baseArgs()),
    ).rejects.toThrow("door blew up");

    // The update was attempted (it precedes the door call) but the rejection
    // propagates out of the $transaction callback → Prisma aborts the tx, so
    // neither write commits. We pin the propagation; rollback itself is the
    // DB's contract once the callback rejects.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("forwards the optional note onto the observation when supplied", async () => {
    const args = { ...baseArgs(), notes: "moved off the mountain camp" };
    await performAnimalMove(prismaMock as unknown as PrismaClient, args);
    const [, obsInput] = createObservationMock.mock.calls[0];
    expect(obsInput.notes).toBe("moved off the mountain camp");
  });
});
