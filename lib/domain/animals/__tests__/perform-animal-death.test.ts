/**
 * lib/domain/animals/__tests__/perform-animal-death.test.ts
 *
 * Issue #538 — offline `death` status is silently lost (no replay). The
 * higher-stakes twin of #100 (offline camp-move).
 *
 * `performAnimalDeath` is the death-recording mirror of `performAnimalMove`
 * (#100), which is itself the animal-level mirror of
 * `lib/domain/mobs/move-mob.ts` `performMobMove`: the CALLER owns the animal
 * mutation (the observation door stays a pure writer). The op runs inside a
 * single `$transaction`:
 *
 *   1. `tx.animal.update` setting `status = "Deceased"` AND `deceasedAt` to
 *      the death observation's timestamp (the SAME value on every replay, so
 *      idempotent — unlike the dropped PATCH's `new Date()` which drifted),
 *   2. `createObservation(tx, <the death observation>)` — atomic with the
 *      update above.
 *
 * The status + deceasedAt mutation is now triggered BY the replayed death
 * observation (the only thing queued offline), so an offline death survives a
 * reconnect drain instead of being lost with the fire-and-forget
 * `PATCH /api/animals/[id]` (which never fired offline and had no replay
 * queue — the #538 bug, the same class as #100).
 *
 * Unlike #100's camp-move there is no same-camp no-op guard: a death is a
 * single terminal transition, so the animal.update ALWAYS fires. Re-applying
 * `status = "Deceased"` + the same `deceasedAt` is idempotent.
 *
 * The animal is keyed on `animalId` (the tag column), NOT the cuid `id`: the
 * offline observation's `animal_id` carries the tag, and `createObservation`
 * resolves the same animal via `where: { animalId }`.
 *
 * vi.mock factories hoist above top-level const declarations, so any state the
 * factories need must come from vi.hoisted. We mock the `createObservation`
 * door so this unit test pins the TRANSACTION SHAPE (caller-derives the
 * mutation; door is invoked with the tx client) without re-exercising the
 * door's internals — exactly the seam `perform-animal-move.test.ts` uses.
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

import { performAnimalDeath } from "@/lib/domain/animals/perform-animal-death";
import { AnimalNotFoundError } from "@/lib/domain/observations/errors";
import type { PrismaClient } from "@prisma/client";

/**
 * S5 / OBS-2 — Prisma P2025 ("record to update not found") built the way the
 * op detects it: by `.name` + `.code`, NOT `instanceof`, so the test carries
 * no runtime `@prisma/client` exception dependency (the same lightweight
 * convention as `lib/server/api-errors.ts` / `lib/server/alerts/dedup.ts`).
 */
function makeP2025(): Error {
  const err = new Error(
    "An operation failed because it depends on one or more records that were required but not found. Record to update not found.",
  );
  err.name = "PrismaClientKnownRequestError";
  (err as Error & { code?: string }).code = "P2025";
  return err;
}

const DEATH_DETAILS = JSON.stringify({
  cause: "Disease",
  carcassDisposal: "BURIED",
});

const baseArgs = (
  overrides: Partial<{
    animalId: string;
    campId: string;
    details: string;
    createdAt: string | null;
    clientLocalId: string | null;
    notes: string | null;
    loggedBy: string | null;
  }> = {},
) => ({
  animalId: "BB-C014",
  campId: "camp-source",
  details: DEATH_DETAILS,
  createdAt: "2026-05-30T10:00:00.000Z",
  clientLocalId: "11111111-1111-4111-8111-111111111111",
  loggedBy: "logger@farm.co.za",
  ...overrides,
});

describe("performAnimalDeath (#538)", () => {
  beforeEach(() => {
    animalUpdateMock.mockReset();
    createObservationMock.mockReset();
    prismaMock.$transaction.mockClear();

    animalUpdateMock.mockResolvedValue({});
    createObservationMock.mockResolvedValue({ success: true, id: "obs-1" });
  });

  it("marks the animal Deceased (status + deceasedAt) AND writes the death observation atomically", async () => {
    const args = baseArgs();
    const result = await performAnimalDeath(
      prismaMock as unknown as PrismaClient,
      args,
    );

    // Caller owns the mutation — keyed on the TAG column (animalId), matching
    // the door's animal lookup, NOT the cuid `id`. deceasedAt is the
    // observation timestamp (createdAt), not `new Date()`, so a replay sets
    // the identical value (idempotency).
    expect(animalUpdateMock).toHaveBeenCalledTimes(1);
    expect(animalUpdateMock).toHaveBeenCalledWith({
      where: { animalId: "BB-C014" },
      data: { status: "Deceased", deceasedAt: "2026-05-30T10:00:00.000Z" },
    });

    // Door stays pure — invoked with the tx client (same prismaMock) so the
    // observation create is atomic with the update above.
    expect(createObservationMock).toHaveBeenCalledTimes(1);
    const [writer, obsInput] = createObservationMock.mock.calls[0];
    expect(writer).toBe(prismaMock);
    expect(obsInput).toMatchObject({
      type: "death",
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

  it("falls back to a server timestamp for deceasedAt when the observation has no createdAt", async () => {
    // A replayed row should always carry created_at, but a bare server-side
    // death write without a timestamp must still set deceasedAt to SOMETHING
    // (the schema column anchors IT3/inventory exits). We assert a non-empty
    // ISO string is written rather than null.
    await performAnimalDeath(prismaMock as unknown as PrismaClient, {
      ...baseArgs(),
      createdAt: null,
    });

    expect(animalUpdateMock).toHaveBeenCalledTimes(1);
    const [{ data }] = animalUpdateMock.mock.calls[0] as [
      { data: { status: string; deceasedAt: string } },
    ];
    expect(data.status).toBe("Deceased");
    expect(typeof data.deceasedAt).toBe("string");
    expect(data.deceasedAt.length).toBeGreaterThan(0);
  });

  it("rolls back the status update when the observation create fails (transactionality)", async () => {
    // The door throws (e.g. AnimalNotFoundError / a validation error). Because
    // both halves share the one $transaction the real Prisma client would roll
    // back the animal.update too — we assert the throw propagates so the
    // transaction is aborted (never a half-applied death: a Deceased animal
    // with no death observation, or vice-versa).
    createObservationMock.mockRejectedValue(new Error("door blew up"));

    await expect(
      performAnimalDeath(prismaMock as unknown as PrismaClient, baseArgs()),
    ).rejects.toThrow("door blew up");

    // The update was attempted (it precedes the door call) but the rejection
    // propagates out of the $transaction callback → Prisma aborts the tx, so
    // neither write commits. We pin the propagation; rollback itself is the
    // DB's contract once the callback rejects.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("forwards the optional note onto the observation when supplied", async () => {
    const args = { ...baseArgs(), notes: "found down at the dam" };
    await performAnimalDeath(prismaMock as unknown as PrismaClient, args);
    const [, obsInput] = createObservationMock.mock.calls[0];
    expect(obsInput.notes).toBe("found down at the dam");
  });

  // ── S5 / OBS-2 — missing animal is a TYPED domain error, not a raw P2025 ──

  it("re-throws Prisma P2025 from the status update as the typed AnimalNotFoundError (OBS-2)", async () => {
    // A death replayed for an animal that genuinely does not exist (deleted
    // server-side). The bare `tx.animal.update` raises P2025, which previously
    // ESCAPED the op raw and was collapsed by `mapApiDomainError`'s #483
    // Prisma sanitizer into an opaque 500 → the offline queue classified it
    // transient and looped. The op now translates it into the SAME typed
    // error the door itself throws for the identical condition
    // (`AnimalNotFoundError`, code ANIMAL_NOT_FOUND) → terminal 404.
    animalUpdateMock.mockRejectedValue(makeP2025());

    const promise = performAnimalDeath(
      prismaMock as unknown as PrismaClient,
      baseArgs(),
    );
    await expect(promise).rejects.toBeInstanceOf(AnimalNotFoundError);

    // The typed error carries the tag + wire code for the 404 envelope.
    const err = await performAnimalDeath(
      prismaMock as unknown as PrismaClient,
      baseArgs(),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "ANIMAL_NOT_FOUND", animalId: "BB-C014" });

    // The door was never reached — the throw aborts the transaction before
    // the observation write (no orphan death row on a missing animal).
    expect(createObservationMock).not.toHaveBeenCalled();
  });

  it("propagates a NON-P2025 update failure unchanged (no over-broad catch)", async () => {
    // Only the record-not-found code is translated; an unrelated Prisma
    // failure (e.g. a connection drop) must keep its identity so the #483
    // sanitizer + server log see the real cause and the client retries.
    const otherErr = new Error("connection reset");
    otherErr.name = "PrismaClientKnownRequestError";
    (otherErr as Error & { code?: string }).code = "P1001";
    animalUpdateMock.mockRejectedValue(otherErr);

    await expect(
      performAnimalDeath(prismaMock as unknown as PrismaClient, baseArgs()),
    ).rejects.toBe(otherErr);
  });
});
