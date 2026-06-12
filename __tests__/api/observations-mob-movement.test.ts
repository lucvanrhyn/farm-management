/**
 * __tests__/api/observations-mob-movement.test.ts
 *
 * S8 / OS-2 — POST /api/observations applies the mob's camp change when (and
 * only when) `type === "mob_movement"` carries a usable move payload.
 *
 * Pre-S8 the route had NO `mob_movement` branch: a queued mob move replayed
 * as a plain observation row and the camp change was carried ONLY by the
 * online-only `PATCH /api/mobs/{id}` — which, offline, threw with nothing
 * queued (see `__tests__/lib/logger-actions-mob-move.test.ts`, the client
 * half). The route now routes a usable `mob_movement` through
 * `performMobMove` (mirroring the #100 `animal_movement` branch), so the
 * REPLAYED observation is a sufficient carrier: an offline mob move survives
 * the reconnect drain.
 *
 * Idempotency: `performMobMove` throws its same-camp guard when the mob is
 * already in the destination (the online PATCH applied it first, or this is
 * a #206 duplicate replay). The route treats that as "move already applied"
 * and still records the replayed observation row through the door's
 * `clientLocalId` upsert — a replay never 500s and never loses the audit row.
 *
 * LENIENT fall-through (mirrors #100): a `mob_movement` without a usable
 * `mobId` + `destCamp` in `details` (e.g. an admin write) keeps the
 * unchanged bare-`createObservation` path. The logger ALWAYS queues both
 * fields, so the no-lost-move guarantee is unaffected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Internals exercised inside the route:
//  - performMobMove: mob.findUnique, camp.findUnique (composite key),
//    animal.findMany/updateMany, mob.update, then TWO door creates (its
//    source + dest rows, no clientLocalId → observation.create).
//  - The replayed row itself: one more door call WITH clientLocalId →
//    observation.upsert.
const mockObsCreate = vi.fn().mockResolvedValue({ id: 'obs-id' });
const mockObsUpsert = vi.fn().mockResolvedValue({ id: 'obs-id' });
const mockCampFindFirst = vi.fn().mockResolvedValue({ campId: 'camp-source', species: 'cattle' });
const mockCampFindUnique = vi.fn().mockResolvedValue({ species: 'cattle' });
const mockMobFindUnique = vi.fn();
const mockMobUpdate = vi.fn().mockResolvedValue({});
const mockAnimalFindMany = vi.fn().mockResolvedValue([]);
const mockAnimalUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

const mockPrisma: Record<string, unknown> = {
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  observation: { create: mockObsCreate, upsert: mockObsUpsert, findMany: vi.fn().mockResolvedValue([]) },
  camp: { findFirst: mockCampFindFirst, findUnique: mockCampFindUnique },
  mob: { findUnique: mockMobFindUnique, update: mockMobUpdate },
  animal: {
    findUnique: vi.fn().mockResolvedValue({ species: 'cattle' }),
    findMany: mockAnimalFindMany,
    updateMany: mockAnimalUpdateMany,
  },
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

function mobMovementBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'mob_movement',
    camp_id: 'camp-source',
    details: JSON.stringify({
      mobId: 'mob-1',
      mobName: 'Heifer group',
      sourceCamp: 'camp-source',
      destCamp: 'camp-dest',
      animalCount: 12,
    }),
    created_at: '2026-05-30T10:00:00.000Z',
    clientLocalId: '44444444-4444-4444-8444-444444444444',
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

describe('POST /api/observations — mob_movement applies the camp change (S8/OS-2)', () => {
  beforeEach(() => {
    mockObsCreate.mockClear();
    mockObsUpsert.mockClear();
    mockMobFindUnique.mockReset();
    mockMobUpdate.mockClear();
    mockAnimalFindMany.mockClear();
    mockAnimalUpdateMany.mockClear();
    (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockClear();

    mockMobFindUnique.mockResolvedValue({
      id: 'mob-1',
      name: 'Heifer group',
      currentCamp: 'camp-source',
      species: 'cattle',
    });
  });

  it('moves the mob to destCamp on a replayed mob_movement POST', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(post(mobMovementBody()), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    // performMobMove fired: the mob advanced to the destination camp.
    expect(mockMobUpdate).toHaveBeenCalledTimes(1);
    expect(mockMobUpdate).toHaveBeenCalledWith({
      where: { id: 'mob-1' },
      data: { currentCamp: 'camp-dest' },
    });
    // …inside performMobMove's own transaction.
    expect(mockPrisma.$transaction).toHaveBeenCalled();

    // Row accounting: performMobMove writes its source+dest pair (no
    // clientLocalId → create), and the REPLAYED row itself is recorded
    // through the door's #206 upsert — the idempotency anchor.
    expect(mockObsCreate).toHaveBeenCalledTimes(2);
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('records the replayed row WITHOUT re-moving when the mob is already in destCamp (idempotent replay)', async () => {
    // The online PATCH already applied the move (or this is a duplicate
    // replay): performMobMove's same-camp guard throws. The route must treat
    // that as "already applied" — never a 500, and the queued row still
    // lands via the clientLocalId upsert.
    mockMobFindUnique.mockResolvedValue({
      id: 'mob-1',
      name: 'Heifer group',
      currentCamp: 'camp-dest',
      species: 'cattle',
    });

    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(post(mobMovementBody()), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    expect(mockMobUpdate).not.toHaveBeenCalled();
    // No phantom source/dest pair from performMobMove — only the replayed row.
    expect(mockObsCreate).not.toHaveBeenCalled();
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('falls through to a plain observation when details has no usable destCamp', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post(mobMovementBody({ details: JSON.stringify({ mobId: 'mob-1', mobName: 'Heifer group' }) })),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);

    // No move machinery touched — bare createObservation path.
    expect(mockMobFindUnique).not.toHaveBeenCalled();
    expect(mockMobUpdate).not.toHaveBeenCalled();
    expect(mockObsUpsert).toHaveBeenCalledTimes(1);
  });

  it('falls through to a plain observation when details is unparseable JSON (no 500, no move)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(
      post(mobMovementBody({ details: 'not-json{' })),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(mockMobFindUnique).not.toHaveBeenCalled();
    expect(mockMobUpdate).not.toHaveBeenCalled();
  });

  it('returns the mapped 404 { error: "Mob not found" } when the mob no longer exists', async () => {
    // performMobMove's MobNotFoundError propagates to mapApiDomainError —
    // the established mobs wire. The client retry lane is bounded by the
    // OBS-1 attempt budget.
    mockMobFindUnique.mockResolvedValue(null);

    const { POST } = await import('@/app/api/observations/route');

    const res = await POST(post(mobMovementBody()), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect(JSON.parse(await res.text())).toEqual({ error: 'Mob not found' });

    // Nothing was applied or recorded — the queue still owns the row.
    expect(mockMobUpdate).not.toHaveBeenCalled();
    expect(mockObsCreate).not.toHaveBeenCalled();
    expect(mockObsUpsert).not.toHaveBeenCalled();
  });
});
