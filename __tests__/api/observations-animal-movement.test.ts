/**
 * __tests__/api/observations-animal-movement.test.ts
 *
 * Issue #100 — POST /api/observations applies the animal's `currentCamp`
 * when (and only when) `type === "animal_movement"`.
 *
 * The route routes an `animal_movement` write through `performAnimalMove`
 * inside a `$transaction`: the animal's `currentCamp` advances to the
 * destination camp AND the observation is recorded atomically. Every OTHER
 * observation type keeps the unchanged bare-`createObservation` path (no
 * `currentCamp` write) — proving the new branch is surgical.
 *
 * This is the route half of the #100 no-lost-move fix: the replayed
 * `animal_movement` observation is now the SOLE carrier of the camp change
 * (the fire-and-forget PATCH is gone), so this route MUST apply it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Door internals the real `createObservation` exercises inside the tx:
//  - crossSpecies(tx).camp.findFirst — camp existence + species
//  - tx.animal.findUnique — species-stamping waterfall off animal_id
//  - tx.observation.upsert/create — the write
// Plus the #100 sibling mutation: tx.animal.update — the currentCamp move.
const mockObsCreate = vi.fn().mockResolvedValue({ id: 'obs-id' });
const mockObsUpsert = vi.fn().mockResolvedValue({ id: 'obs-id' });
const mockCampFindFirst = vi.fn().mockResolvedValue({ campId: 'camp-source', species: 'cattle' });
// S24 / obs-M4 — the route's animal↔camp species guard resolves the DEST camp
// via `requireSpeciesScopedCamp`'s composite-unique `camp.findUnique`; a
// non-null row means the camp exists for the animal's species (guard passes).
const mockCampFindUnique = vi.fn().mockResolvedValue({ id: 'camp-row-1', species: 'cattle' });
const mockAnimalFindUnique = vi.fn().mockResolvedValue({ species: 'cattle' });
const mockAnimalUpdate = vi.fn().mockResolvedValue({});

const mockPrisma: Record<string, unknown> = {
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  observation: { create: mockObsCreate, upsert: mockObsUpsert, findMany: vi.fn().mockResolvedValue([]) },
  camp: { findFirst: mockCampFindFirst, findUnique: mockCampFindUnique },
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

function movementBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'animal_movement',
    camp_id: 'camp-source',
    animal_id: 'BB-C014',
    details: JSON.stringify({
      animalId: 'BB-C014',
      sourceCampId: 'camp-source',
      destCampId: 'camp-dest',
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

describe('POST /api/observations — animal_movement applies currentCamp (#100)', () => {
  beforeEach(() => {
    mockObsCreate.mockClear();
    mockObsUpsert.mockClear();
    mockAnimalUpdate.mockClear();
    (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockClear();
  });

  it('advances the animal currentCamp to destCampId on an animal_movement POST', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(post(movementBody()), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    // The #100 sibling mutation fired — keyed on the TAG column (animalId),
    // advancing currentCamp to the destination from details.destCampId.
    expect(mockAnimalUpdate).toHaveBeenCalledTimes(1);
    expect(mockAnimalUpdate).toHaveBeenCalledWith({
      where: { animalId: 'BB-C014' },
      data: { currentCamp: 'camp-dest' },
    });

    // It ran inside the route-owned transaction.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // The observation was still written (door reached, idempotent path).
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('does NOT advance currentCamp on a same-camp animal_movement (no-op guard)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post(
        movementBody({
          camp_id: 'camp-A',
          details: JSON.stringify({
            animalId: 'BB-C014',
            sourceCampId: 'camp-A',
            destCampId: 'camp-A',
          }),
        }),
      ),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);

    expect(mockAnimalUpdate).not.toHaveBeenCalled();
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('does NOT touch currentCamp for a NON-movement type (unchanged path)', async () => {
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

    // No currentCamp write, and NO transaction was opened for this path —
    // the non-movement branch is the bare `createObservation(ctx.prisma, …)`.
    expect(mockAnimalUpdate).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('falls through to a plain observation (no camp move) when details has no usable destCampId', async () => {
    // An `animal_movement` with no destination — e.g. the admin
    // CreateObservationModal, which offers the type but has no destCampId
    // field. Pre-#100 this created a plain observation row; that behaviour is
    // preserved (no 400, no $transaction, no currentCamp write) because the
    // payload cannot express a move. The logger + replay ALWAYS send a
    // destCampId, so the no-lost-move guarantee is untouched.
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post(movementBody({ details: JSON.stringify({ animalId: 'BB-C014' }) })),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(mockAnimalUpdate).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    // Bare createObservation path (legacy create — no clientLocalId upsert
    // here because this test body omits it via the default movementBody key…
    // actually the default includes one, so the door upserts).
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('falls through to a plain observation when details is unparseable JSON (no 500, no move)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post(movementBody({ details: 'not-json{' })),
      { params: Promise.resolve({}) },
    );
    // Unparseable details cannot yield a destCampId → treated as a plain
    // observation, never a 500 from the handler's transaction path.
    expect(res.status).toBe(200);
    expect(mockAnimalUpdate).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('orphan tag (movement for an animal that does not exist) is a TYPED 404 ANIMAL_NOT_FOUND (S5/OBS-2)', async () => {
    // The byte-identical sibling of the death orphan-tag contract (see
    // observations-death.test.ts): `performAnimalMove`'s bare
    // `tx.animal.update({ where: { animalId } })` raises Prisma P2025 when the
    // tag resolves to no row. Pre-S5 the raw P2025 escaped and the #483
    // sanitizer collapsed it to an opaque 500 → the offline queue looped the
    // row forever (OBS-2). The op now translates P2025 into the
    // observations-domain `AnimalNotFoundError` → 404
    // `{ error: "ANIMAL_NOT_FOUND" }` → terminal-for-this-row on the client.
    const { POST } = await import('@/app/api/observations/route');

    // The animal does not exist → the tag-keyed update raises P2025.
    const p2025 = new Error(
      'An operation failed because it depends on one or more records that were required but not found. Record to update not found.',
    );
    p2025.name = 'PrismaClientKnownRequestError';
    (p2025 as Error & { code?: string }).code = 'P2025';
    mockAnimalUpdate.mockRejectedValueOnce(p2025);

    const res = await POST(post(movementBody()), { params: Promise.resolve({}) });

    expect(res.status).toBe(404);
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'ANIMAL_NOT_FOUND' });
    // No raw Prisma schema text leaks into the client envelope (#483 holds).
    expect(JSON.stringify(body)).not.toContain('Record to update not found');

    // The update threw inside the route-owned transaction → the observation
    // write never committed (no orphan movement row on a missing animal).
    expect(mockAnimalUpdate).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockObsUpsert).not.toHaveBeenCalled();
    expect(mockObsCreate).not.toHaveBeenCalled();
  });
});
