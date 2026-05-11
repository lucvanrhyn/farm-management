/**
 * @vitest-environment node
 *
 * Issue #206 — Cycle 1: domain-op idempotency.
 *
 * Bug class: an offline-sync retry (network blip, timeout, browser close
 * mid-flight) currently re-posts the same observation as a fresh row because
 * the domain op has no idempotency key. Two POSTs with identical payload
 * create two rows.
 *
 * Pattern (USER-APPROVED):
 *   1. Client generates a UUID at form mount.
 *   2. UUID is submitted as `clientLocalId`.
 *   3. Schema declares `clientLocalId String?  @unique` on Observation.
 *      (Per-tenant DB architecture: each farm has its own libSQL DB, so
 *      `@unique` on the column is equivalent to `@@unique([farmId, clientLocalId])`
 *      from a multi-tenant SaaS spec — there is no cross-tenant `Observation`
 *      table.)
 *   4. The domain op upserts on `clientLocalId`, returning the existing row's
 *      id on second call, so retries are safe (200, not 409).
 *
 * What this file pins:
 *   - Calling `createObservation` twice with the SAME `clientLocalId` returns
 *     the SAME observation id both times.
 *   - The underlying Prisma client sees `upsert` (not `create`) on the
 *     idempotent path, so the unique-constraint race between two concurrent
 *     retries cannot create two rows.
 *   - Calling with DIFFERENT `clientLocalId`s creates two distinct rows.
 *   - Omitting `clientLocalId` (legacy callers, e.g. before #207 lands the
 *     Animal/Cover slice) falls back to the original create path — back-compat.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { createObservation } from '@/lib/domain/observations/create-observation';

interface ObservationRow {
  id: string;
  type: string;
  campId: string;
  animalId: string | null;
  details: string;
  observedAt: Date;
  loggedBy: string | null;
  species: string | null;
  clientLocalId: string | null;
}

/**
 * Minimal in-memory Prisma double that emulates the `@unique` constraint on
 * `clientLocalId`. The double exposes only the methods `createObservation`
 * actually calls — keeps the test focused on the contract.
 */
function makeFakePrisma() {
  const observationRows: ObservationRow[] = [];
  let nextId = 1;

  return {
    rows: observationRows,
    observation: {
      create: vi.fn(async ({ data }: { data: Omit<ObservationRow, 'id'> & { id?: string } }) => {
        if (data.clientLocalId) {
          const existing = observationRows.find(
            (r) => r.clientLocalId === data.clientLocalId,
          );
          if (existing) {
            // Emulate the libSQL unique-constraint violation surface used by
            // Prisma when an `@unique` collision occurs. We throw the shape
            // the domain op must handle if it chose `create` over `upsert`.
            const err = new Error('UNIQUE constraint failed: Observation.clientLocalId');
            (err as Error & { code?: string }).code = 'P2002';
            throw err;
          }
        }
        const row: ObservationRow = {
          id: `obs-${nextId++}`,
          type: data.type,
          campId: data.campId,
          animalId: data.animalId ?? null,
          details: data.details ?? '',
          observedAt: data.observedAt as Date,
          loggedBy: data.loggedBy ?? null,
          species: data.species ?? null,
          clientLocalId: data.clientLocalId ?? null,
        };
        observationRows.push(row);
        return row;
      }),
      upsert: vi.fn(async ({
        where,
        update: _update,
        create,
      }: {
        where: { clientLocalId: string };
        update: Partial<ObservationRow>;
        create: Omit<ObservationRow, 'id'> & { id?: string };
      }) => {
        void _update;
        const existing = observationRows.find(
          (r) => r.clientLocalId === where.clientLocalId,
        );
        if (existing) {
          // Idempotent — no-op the update (we want the original row preserved)
          return existing;
        }
        const row: ObservationRow = {
          id: `obs-${nextId++}`,
          type: create.type,
          campId: create.campId,
          animalId: create.animalId ?? null,
          details: create.details ?? '',
          observedAt: create.observedAt as Date,
          loggedBy: create.loggedBy ?? null,
          species: create.species ?? null,
          clientLocalId: create.clientLocalId ?? null,
        };
        observationRows.push(row);
        return row;
      }),
    },
    camp: {
      findFirst: vi.fn(async () => ({ campId: 'A' })),
    },
    animal: {
      findUnique: vi.fn(async () => ({ species: 'cattle' })),
    },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

// The domain op is typed against `PrismaClient`, but only touches the four
// methods above. The fake is a structural superset so `as unknown as` is the
// minimum-friction cast for the integration test.
function asPrisma(fake: FakePrisma): Parameters<typeof createObservation>[0] {
  return fake as unknown as Parameters<typeof createObservation>[0];
}

describe('createObservation — idempotency via clientLocalId (#206)', () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = makeFakePrisma();
  });

  it('returns the SAME observation id when called twice with the same clientLocalId', async () => {
    const clientLocalId = '11111111-1111-4111-8111-111111111111';

    const first = await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: 'first',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
      clientLocalId,
    });

    const second = await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: 'retry — same UUID',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
      clientLocalId,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it('persists exactly one row in the DB for two retries of the same clientLocalId', async () => {
    const clientLocalId = '22222222-2222-4222-8222-222222222222';

    await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: '{}',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
      clientLocalId,
    });
    await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: '{}',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
      clientLocalId,
    });

    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].clientLocalId).toBe(clientLocalId);
  });

  it('uses upsert (not create) when a clientLocalId is supplied, so concurrent retries cannot race', async () => {
    const clientLocalId = '33333333-3333-4333-8333-333333333333';

    await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: '{}',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
      clientLocalId,
    });

    // The race window between SELECT-then-INSERT lives in `create`, so the
    // domain op MUST funnel idempotent writes through `upsert`. (`create` is
    // still permitted on the no-clientLocalId fallback path.)
    expect(fake.observation.upsert).toHaveBeenCalledOnce();
    expect(fake.observation.create).not.toHaveBeenCalled();
  });

  it('creates two distinct rows when given two different clientLocalIds', async () => {
    const first = await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: '{}',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
      clientLocalId: '44444444-4444-4444-8444-444444444444',
    });
    const second = await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: '{}',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
      clientLocalId: '55555555-5555-4555-8555-555555555555',
    });

    expect(fake.rows).toHaveLength(2);
    expect(second.id).not.toBe(first.id);
  });

  it('back-compat: when clientLocalId is omitted, uses create (no idempotency promise)', async () => {
    // #207 will wire clientLocalId for Animal+Cover; until then, legacy callers
    // (and the existing route handler under test in __tests__/api/observations.test.ts)
    // must keep working with the old create() path.
    const first = await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: '{}',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
    });
    const second = await createObservation(asPrisma(fake), {
      type: 'camp_condition',
      camp_id: 'A',
      animal_id: null,
      details: '{}',
      created_at: '2026-05-11T10:00:00.000Z',
      loggedBy: 'logger@example.com',
    });

    expect(fake.rows).toHaveLength(2);
    expect(second.id).not.toBe(first.id);
    expect(fake.observation.create).toHaveBeenCalledTimes(2);
    expect(fake.observation.upsert).not.toHaveBeenCalled();
  });
});
