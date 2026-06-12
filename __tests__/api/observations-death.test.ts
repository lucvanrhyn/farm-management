/**
 * __tests__/api/observations-death.test.ts
 *
 * Issue #538 — POST /api/observations marks the animal `Deceased` when (and
 * only when) `type === "death"` carries the fields needed to apply the status.
 *
 * The route routes a `death` write through `performAnimalDeath` inside a
 * `$transaction`: the animal's `status` advances to `"Deceased"` (+ `deceasedAt`
 * anchored to the observation timestamp) AND the death observation is recorded
 * atomically. Every OTHER observation type keeps the unchanged
 * bare-`createObservation` path (no status write) — proving the new branch is
 * surgical and sits ALONGSIDE the #100 `animal_movement` branch.
 *
 * This is the route half of the #538 no-lost-death fix: the replayed `death`
 * observation is now the SOLE carrier of the status change (the fire-and-forget
 * PATCH is gone), so this route MUST apply it.
 *
 * LENIENT fall-through: a `death` lacking a resolvable `animal_id` (e.g. the
 * admin CreateObservationModal, which logs the type without selecting a tagged
 * animal) cannot express the status mutation, so it falls through to a plain
 * `createObservation` — no 500, no status write — preserving pre-existing
 * behaviour. The logger + offline-replay ALWAYS send the animal tag, so the
 * no-lost-death guarantee is unaffected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Door internals the real `createObservation` exercises inside the tx:
//  - crossSpecies(tx).camp.findFirst — camp existence + species
//  - tx.animal.findUnique — species-stamping waterfall off animal_id
//  - tx.observation.upsert/create — the write
// Plus the #538 sibling mutation: tx.animal.update — the Deceased status.
const mockObsCreate = vi.fn().mockResolvedValue({ id: 'obs-id' });
const mockObsUpsert = vi.fn().mockResolvedValue({ id: 'obs-id' });
const mockCampFindFirst = vi.fn().mockResolvedValue({ campId: 'camp-source', species: 'cattle' });
const mockAnimalFindUnique = vi.fn().mockResolvedValue({ species: 'cattle' });
const mockAnimalUpdate = vi.fn().mockResolvedValue({});

const mockPrisma: Record<string, unknown> = {
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  observation: { create: mockObsCreate, upsert: mockObsUpsert, findMany: vi.fn().mockResolvedValue([]) },
  camp: { findFirst: mockCampFindFirst },
  animal: { findUnique: mockAnimalFindUnique, update: mockAnimalUpdate },
  farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
};

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/server/farm-context', () => ({
  getFarmContext: vi.fn().mockResolvedValue({
    session: {
      user: {
        id: 'user-1',
        email: 'user-1@example.com',
        role: 'field_logger',
        farms: [{ slug: 'test-farm-slug', role: 'field_logger' }],
      },
    },
    prisma: mockPrisma,
    slug: 'test-farm-slug',
    role: 'field_logger',
  }),
}));

vi.mock('@/lib/farm-prisma', () => ({
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 100 }),
}));

function deathBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'death',
    camp_id: 'camp-source',
    animal_id: 'BB-C014',
    details: JSON.stringify({
      cause: 'Disease',
      carcassDisposal: 'BURIED',
    }),
    created_at: '2026-05-30T10:00:00.000Z',
    clientLocalId: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/observations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Build a P2025 ("record to update not found") Prisma exception the way
 * `lib/server/api-errors.ts` detects it — by `.name`, NOT `instanceof` — so the
 * route's error path runs end-to-end without a runtime `@prisma/client`
 * dependency. Mirrors `api-errors-prisma-sanitize.test.ts`'s `makePrismaError`.
 */
function makeP2025(): Error {
  const err = new Error(
    'An operation failed because it depends on one or more records that were required but not found. Record to update not found.',
  );
  err.name = 'PrismaClientKnownRequestError';
  (err as Error & { code?: string }).code = 'P2025';
  return err;
}

describe('POST /api/observations — death marks the animal Deceased (#538)', () => {
  beforeEach(() => {
    mockObsCreate.mockClear();
    mockObsUpsert.mockClear();
    mockAnimalUpdate.mockClear();
    (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockClear();
  });

  it('sets status=Deceased (+ deceasedAt = observation timestamp) on a death POST', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(post(deathBody()), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    // The #538 sibling mutation fired — keyed on the TAG column (animalId),
    // deceasedAt anchored to the observation's created_at (idempotent on
    // replay), NOT a fresh server clock.
    expect(mockAnimalUpdate).toHaveBeenCalledTimes(1);
    expect(mockAnimalUpdate).toHaveBeenCalledWith({
      where: { animalId: 'BB-C014' },
      data: { status: 'Deceased', deceasedAt: '2026-05-30T10:00:00.000Z' },
    });

    // It ran inside the route-owned transaction.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // The observation was still written (door reached, idempotent path).
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('does NOT touch status for a NON-death type (unchanged path)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post({
        type: 'camp_check',
        camp_id: 'camp-source',
        details: JSON.stringify({ status: 'normal' }),
        clientLocalId: '33333333-3333-4333-8333-333333333333',
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);

    // No status write, and NO transaction was opened for this path — the
    // non-death branch is the bare `createObservation(ctx.prisma, …)`.
    expect(mockAnimalUpdate).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('falls through to a plain observation (no status write) when a death lacks a resolvable animal_id', async () => {
    // A `death` with no animal tag — e.g. the admin CreateObservationModal,
    // which offers the type but does not always select a tagged animal. The
    // status mutation cannot be expressed, so the route preserves the plain
    // create path (no 500, no $transaction, no status write). The logger +
    // replay ALWAYS send the animal tag, so the no-lost-death guarantee is
    // untouched.
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post(deathBody({ animal_id: null })),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(mockAnimalUpdate).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('orphan tag (death for an animal that does not exist) is a TYPED 404 ANIMAL_NOT_FOUND — parity with the #100 movement sibling (S5/OBS-2)', async () => {
    // INTENTIONAL CONTRACT SHIFT — supersedes the #543 documenting test that
    // pinned the sanitized 500.
    //
    // A `death` carrying a resolvable `animal_id` that matches NO existing
    // animal: `performAnimalDeath`'s `tx.animal.update({ where: { animalId } })`
    // raises Prisma P2025 ("record to update not found"). Pre-S5 the raw P2025
    // escaped the op and `mapApiDomainError`'s #483 Prisma sanitizer collapsed
    // it to an opaque 500 DB_QUERY_FAILED → the offline queue classified the
    // row TRANSIENT and looped it (OBS-2). The op now translates P2025 into
    // the observations-domain `AnimalNotFoundError` — the SAME typed error the
    // door throws for the identical FK miss — and `mapApiDomainError` maps it
    // to 404 `{ error: "ANIMAL_NOT_FOUND" }`, which `classifySyncFailure`
    // treats as terminal-for-this-row (dead-letter, no loop).
    //
    // The movement sibling ships the IDENTICAL translation in the same slice
    // (see observations-animal-movement.test.ts), so the two twins' error
    // contracts stay byte-identical — the #543 shared-concern follow-up.
    //
    // Deploy-order note (S4/OS-1 partner): the drain now syncs pending animals
    // to completion BEFORE observations, so a not-yet-synced offline calf can
    // no longer reach this 404 — a typed ANIMAL_NOT_FOUND means the animal is
    // GENUINELY missing server-side. An UNTYPED 404 still classifies as
    // retryable on the client, so older servers cannot poison a healthy row.
    const { POST } = await import('@/app/api/observations/route');

    // The animal does not exist → the tag-keyed update raises P2025.
    mockAnimalUpdate.mockRejectedValueOnce(makeP2025());

    const res = await POST(post(deathBody()), { params: Promise.resolve({}) });

    // Typed terminal 404 — NOT the sanitized 500.
    expect(res.status).toBe(404);
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'ANIMAL_NOT_FOUND' });
    // No raw Prisma schema text leaks into the client envelope (#483 holds).
    expect(JSON.stringify(body)).not.toContain('Record to update not found');

    // The update was attempted inside the route-owned transaction; because it
    // threw, the door's observation write never committed — no partial write
    // (no Deceased status without a death observation, nor vice-versa).
    expect(mockAnimalUpdate).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockObsUpsert).not.toHaveBeenCalled();
    expect(mockObsCreate).not.toHaveBeenCalled();
  });
});
