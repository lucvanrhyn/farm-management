/**
 * __tests__/api/observations-species-camp.test.ts
 *
 * S24 / obs-M4 — POST /api/observations enforces animal↔camp species
 * consistency through `requireSpeciesScopedCamp`.
 *
 * The route has ADVERTISED `422 { error: "WRONG_SPECIES" }` in its wire-shape
 * docstring since Wave C, but nothing on the observation path ever performed
 * the animal↔camp species check — `requireSpeciesScopedCamp` was wired into
 * the mob ops (#97) and the animal PATCH (#98) only. A cattle observation
 * could be logged against a sheep camp (and an `animal_movement` could move
 * a cattle animal INTO a sheep camp's `currentCamp`) with zero server-side
 * resistance; the multi-species spec's "hard-block cross-species writes
 * uniformly" held everywhere except the highest-volume write route.
 *
 * Contract under test:
 *   - animal + camp species match            → write proceeds (200)
 *   - camp exists under a DIFFERENT species  → 422 { error: "WRONG_SPECIES" }
 *     (`SpeciesScopedCampError`, the same wire the #98 animal PATCH emits)
 *   - camp exists under NO species           → 404 { error: "CAMP_NOT_FOUND" }
 *     (the route's pre-existing missing-camp wire — NOT a new 422 NOT_FOUND)
 *   - animal tag resolves to no row          → 404 { error: "ANIMAL_NOT_FOUND" }
 *     (the S5/OBS-2 typed terminal wire, thrown before any camp work)
 *   - no animal in scope (e.g. camp_check)   → guard skipped entirely
 *   - animal_movement                        → the DESTINATION camp is checked
 *     (the `currentCamp` mutation target); blocking on the source camp would
 *     trap an animal already sitting in a legacy wrong-species camp
 *
 * `requireSpeciesScopedCamp`'s two-step lookup shape (mirrored by the mocks):
 *   step 1: `camp.findUnique({ where: { Camp_species_campId_key } })` — the
 *           composite (species, campId) hit ⇒ ok
 *   step 2: on miss, `crossSpecies(prisma).camp.findFirst({ where: { campId } })`
 *           ⇒ row under another species → WRONG_SPECIES; no row → NOT_FOUND
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockObsCreate = vi.fn().mockResolvedValue({ id: 'obs-id' });
const mockObsUpsert = vi.fn().mockResolvedValue({ id: 'obs-id' });
// Step-2 fallback of requireSpeciesScopedCamp AND the door's camp-existence
// check both route through crossSpecies(...).camp.findFirst.
const mockCampFindFirst = vi.fn().mockResolvedValue({ campId: 'camp-1', species: 'cattle' });
// Step-1 composite-unique lookup of requireSpeciesScopedCamp.
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

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/observations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/observations — animal↔camp species guard (S24 / obs-M4)', () => {
  beforeEach(() => {
    mockObsCreate.mockClear();
    mockObsUpsert.mockClear();
    mockAnimalUpdate.mockClear();
    (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockClear();
    mockCampFindUnique.mockReset();
    mockCampFindUnique.mockResolvedValue({ id: 'camp-row-1', species: 'cattle' });
    mockCampFindFirst.mockReset();
    mockCampFindFirst.mockResolvedValue({ campId: 'camp-1', species: 'cattle' });
    mockAnimalFindUnique.mockReset();
    mockAnimalFindUnique.mockResolvedValue({ species: 'cattle' });
  });

  it('returns 422 WRONG_SPECIES when the camp exists under a different species', async () => {
    const { POST } = await import('@/app/api/observations/route');

    // Composite (cattle, camp-1) miss → fallback finds the camp under sheep.
    mockCampFindUnique.mockResolvedValue(null);
    mockCampFindFirst.mockResolvedValue({ id: 'camp-row-1', species: 'sheep' });

    const res = await POST(
      post({
        type: 'weighing',
        camp_id: 'camp-1',
        animal_id: 'BB-C014',
        details: JSON.stringify({ weight_kg: 450 }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ error: 'WRONG_SPECIES' });
    // The cross-species row must NEVER have been written.
    expect(mockObsCreate).not.toHaveBeenCalled();
    expect(mockObsUpsert).not.toHaveBeenCalled();
  });

  it('proceeds (200) when the animal and camp species match', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post({
        type: 'weighing',
        camp_id: 'camp-1',
        animal_id: 'BB-C014',
        details: JSON.stringify({ weight_kg: 450 }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(mockObsCreate).toHaveBeenCalledTimes(1);
  });

  it('returns the pre-existing 404 CAMP_NOT_FOUND wire when the camp exists under NO species', async () => {
    const { POST } = await import('@/app/api/observations/route');

    // Composite miss AND fallback miss → the campId is simply unknown. The
    // guard must surface the route's ESTABLISHED missing-camp envelope, not
    // a new 422 NOT_FOUND.
    mockCampFindUnique.mockResolvedValue(null);
    mockCampFindFirst.mockResolvedValue(null);

    const res = await POST(
      post({
        type: 'weighing',
        camp_id: 'ghost-camp',
        animal_id: 'BB-C014',
        details: JSON.stringify({ weight_kg: 450 }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'CAMP_NOT_FOUND' });
    expect(mockObsCreate).not.toHaveBeenCalled();
    expect(mockObsUpsert).not.toHaveBeenCalled();
  });

  it('returns the S5 typed 404 ANIMAL_NOT_FOUND when the animal tag resolves to no row', async () => {
    const { POST } = await import('@/app/api/observations/route');

    mockAnimalFindUnique.mockResolvedValue(null);

    const res = await POST(
      post({
        type: 'weighing',
        camp_id: 'camp-1',
        animal_id: 'GHOST-001',
        details: JSON.stringify({ weight_kg: 450 }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'ANIMAL_NOT_FOUND' });
    expect(mockObsCreate).not.toHaveBeenCalled();
    expect(mockObsUpsert).not.toHaveBeenCalled();
  });

  it('blocks an animal_movement whose DESTINATION camp belongs to another species (422, no currentCamp write)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    // Dest camp exists only under sheep → composite (cattle, camp-dest) miss.
    mockCampFindUnique.mockResolvedValue(null);
    mockCampFindFirst.mockResolvedValue({ id: 'camp-row-9', species: 'sheep' });

    const res = await POST(
      post({
        type: 'animal_movement',
        camp_id: 'camp-source',
        animal_id: 'BB-C014',
        details: JSON.stringify({
          animalId: 'BB-C014',
          sourceCampId: 'camp-source',
          destCampId: 'camp-dest',
        }),
        clientLocalId: '22222222-2222-4222-8222-222222222222',
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ error: 'WRONG_SPECIES' });
    // The guard fires BEFORE performAnimalMove: no transaction, no
    // currentCamp mutation, no observation row.
    expect(mockAnimalUpdate).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockObsUpsert).not.toHaveBeenCalled();
  });

  it('skips the guard entirely when no animal is in scope (camp-level observation)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post({
        type: 'camp_check',
        camp_id: 'camp-1',
        details: JSON.stringify({ status: 'normal' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    // No composite species lookup fired — camp-level writes stay untouched
    // (the door's own existence check uses camp.findFirst, not findUnique).
    expect(mockCampFindUnique).not.toHaveBeenCalled();
    expect(mockObsCreate).toHaveBeenCalledTimes(1);
  });

  it('skips the guard for a legacy animal with no species (null) — mirrors the #98 PATCH lenience', async () => {
    const { POST } = await import('@/app/api/observations/route');

    mockAnimalFindUnique.mockResolvedValue({ species: null });

    const res = await POST(
      post({
        type: 'treatment',
        camp_id: 'camp-1',
        animal_id: 'LEGACY-001',
        details: JSON.stringify({ product: 'dip' }),
      }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(200);
    expect(mockCampFindUnique).not.toHaveBeenCalled();
    expect(mockObsCreate).toHaveBeenCalledTimes(1);
  });
});
