/**
 * @vitest-environment node
 *
 * Issue #207 — Cycle 1: domain-op idempotency for Animal creates.
 *
 * Bug class: an offline-sync retry (network blip, timeout, browser close
 * mid-flight) currently re-posts the same Animal create as a fresh row
 * because the route handler had no idempotency key — two POSTs with the same
 * `animalId` raced on the `@unique` constraint, producing either P2002 errors
 * or duplicate work depending on transaction ordering.
 *
 * Pattern (mirror of #206 / PR #214):
 *   1. Client generates a UUID at form mount.
 *   2. UUID is submitted as `clientLocalId`.
 *   3. Schema declares `clientLocalId String? @unique` on Animal.
 *      Per-tenant DB architecture: each farm has its own libSQL DB, so
 *      `@unique` on the column is equivalent to `@@unique([farmId, clientLocalId])`
 *      from the multi-tenant SaaS spec — there is no cross-tenant `Animal`
 *      table.
 *   4. The domain op upserts on `clientLocalId`, returning the existing
 *      row's id on second call, so retries are safe (200, not 409, not
 *      duplicate).
 *
 * What this file pins (5 cases):
 *   - Calling `createAnimal` twice with the SAME `clientLocalId` returns
 *     the SAME row both times (idempotency).
 *   - Exactly ONE persisted row after two retries.
 *   - The underlying Prisma client sees `upsert` (not `create`) on the
 *     idempotent path — the SELECT-then-INSERT race lives in `create`.
 *   - DIFFERENT `clientLocalId`s produce two distinct rows.
 *   - Omitting `clientLocalId` (legacy callers, e.g. server-side seed)
 *     falls back to the original create path — back-compat.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { createAnimal } from '@/lib/domain/animals/create-animal';

interface AnimalRow {
  id: string;
  animalId: string;
  name: string | null;
  sex: string;
  dateOfBirth: string | null;
  breed: string;
  category: string;
  currentCamp: string;
  status: string;
  motherId: string | null;
  fatherId: string | null;
  species: string;
  dateAdded: string;
  tagNumber: string | null;
  brandSequence: string | null;
  clientLocalId: string | null;
}

/**
 * Minimal in-memory Prisma double — same shape as the observation cycle 1
 * test. Emulates `@unique` on `clientLocalId`. Only the methods `createAnimal`
 * actually calls are exposed.
 */
function makeFakePrisma() {
  const rows: AnimalRow[] = [];
  let nextId = 1;

  return {
    rows,
    animal: {
      create: vi.fn(async ({ data }: { data: Omit<AnimalRow, 'id'> & { id?: string } }) => {
        if (data.clientLocalId) {
          const existing = rows.find((r) => r.clientLocalId === data.clientLocalId);
          if (existing) {
            const err = new Error(
              'UNIQUE constraint failed: Animal.clientLocalId',
            );
            (err as Error & { code?: string }).code = 'P2002';
            throw err;
          }
        }
        const row: AnimalRow = {
          id: `animal-${nextId++}`,
          animalId: data.animalId,
          name: data.name ?? null,
          sex: data.sex,
          dateOfBirth: data.dateOfBirth ?? null,
          breed: data.breed ?? 'Brangus',
          category: data.category,
          currentCamp: data.currentCamp,
          status: data.status ?? 'Active',
          motherId: data.motherId ?? null,
          fatherId: data.fatherId ?? null,
          species: data.species ?? 'cattle',
          dateAdded: data.dateAdded,
          tagNumber: data.tagNumber ?? null,
          brandSequence: data.brandSequence ?? null,
          clientLocalId: data.clientLocalId ?? null,
        };
        rows.push(row);
        return row;
      }),
      upsert: vi.fn(async ({
        where,
        update: _update,
        create,
      }: {
        where: { clientLocalId: string };
        update: Partial<AnimalRow>;
        create: Omit<AnimalRow, 'id'> & { id?: string };
      }) => {
        void _update;
        const existing = rows.find((r) => r.clientLocalId === where.clientLocalId);
        if (existing) return existing;
        const row: AnimalRow = {
          id: `animal-${nextId++}`,
          animalId: create.animalId,
          name: create.name ?? null,
          sex: create.sex,
          dateOfBirth: create.dateOfBirth ?? null,
          breed: create.breed ?? 'Brangus',
          category: create.category,
          currentCamp: create.currentCamp,
          status: create.status ?? 'Active',
          motherId: create.motherId ?? null,
          fatherId: create.fatherId ?? null,
          species: create.species ?? 'cattle',
          dateAdded: create.dateAdded,
          tagNumber: create.tagNumber ?? null,
          brandSequence: create.brandSequence ?? null,
          clientLocalId: create.clientLocalId ?? null,
        };
        rows.push(row);
        return row;
      }),
    },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function asPrisma(fake: FakePrisma): Parameters<typeof createAnimal>[0] {
  return fake as unknown as Parameters<typeof createAnimal>[0];
}

const BASE_INPUT = {
  animalId: 'A-001',
  sex: 'Female',
  category: 'Cow',
  currentCamp: 'A',
  status: 'Active' as const,
  species: 'cattle' as const,
};

describe('createAnimal — idempotency via clientLocalId (#207)', () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = makeFakePrisma();
  });

  it('returns the SAME animal record when called twice with the same clientLocalId', async () => {
    const clientLocalId = '11111111-1111-4111-8111-111111111111';

    const first = await createAnimal(asPrisma(fake), {
      ...BASE_INPUT,
      clientLocalId,
    });

    const second = await createAnimal(asPrisma(fake), {
      ...BASE_INPUT,
      animalId: 'A-002', // ignored on retry — first-write content is canonical
      clientLocalId,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.animal.id).toBe(first.animal.id);
  });

  it('persists exactly one row for two retries of the same clientLocalId', async () => {
    const clientLocalId = '22222222-2222-4222-8222-222222222222';
    await createAnimal(asPrisma(fake), { ...BASE_INPUT, clientLocalId });
    await createAnimal(asPrisma(fake), { ...BASE_INPUT, clientLocalId });

    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].clientLocalId).toBe(clientLocalId);
  });

  it('uses upsert (not create) when a clientLocalId is supplied — concurrent retries cannot race', async () => {
    const clientLocalId = '33333333-3333-4333-8333-333333333333';
    await createAnimal(asPrisma(fake), { ...BASE_INPUT, clientLocalId });

    expect(fake.animal.upsert).toHaveBeenCalledOnce();
    expect(fake.animal.create).not.toHaveBeenCalled();
  });

  it('creates two distinct rows when given two different clientLocalIds', async () => {
    const first = await createAnimal(asPrisma(fake), {
      ...BASE_INPUT,
      animalId: 'A-001',
      clientLocalId: '44444444-4444-4444-8444-444444444444',
    });
    const second = await createAnimal(asPrisma(fake), {
      ...BASE_INPUT,
      animalId: 'A-002',
      clientLocalId: '55555555-5555-4555-8555-555555555555',
    });

    expect(fake.rows).toHaveLength(2);
    expect(second.animal.id).not.toBe(first.animal.id);
  });

  it('back-compat: when clientLocalId is omitted, uses create (no idempotency promise)', async () => {
    // Legacy callers (server-side seed, scripts, pre-#207 client code) keep
    // working with the old create() path.
    await createAnimal(asPrisma(fake), { ...BASE_INPUT, animalId: 'A-100' });
    await createAnimal(asPrisma(fake), { ...BASE_INPUT, animalId: 'A-101' });

    expect(fake.rows).toHaveLength(2);
    expect(fake.animal.create).toHaveBeenCalledTimes(2);
    expect(fake.animal.upsert).not.toHaveBeenCalled();
  });
});
