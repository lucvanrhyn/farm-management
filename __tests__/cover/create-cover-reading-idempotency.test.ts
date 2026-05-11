/**
 * @vitest-environment node
 *
 * Issue #207 — Cycle 1: domain-op idempotency for CampCoverReading creates.
 *
 * Mirrors `__tests__/animals/create-animal-idempotency.test.ts` exactly —
 * same five contract assertions applied to the cover-reading domain op.
 *
 * Per-tenant DB architecture: `@unique` on `clientLocalId` is equivalent to
 * `@@unique([farmId, clientLocalId])` in the multi-tenant SaaS PRD —
 * each farm has its own libSQL DB, so there is no cross-tenant
 * `CampCoverReading` table.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { createCoverReading } from '@/lib/domain/cover/create-cover-reading';

interface CoverRow {
  id: string;
  campId: string;
  coverCategory: string;
  kgDmPerHa: number;
  useFactor: number;
  recordedAt: string;
  recordedBy: string;
  attachmentUrl: string | null;
  clientLocalId: string | null;
}

function makeFakePrisma() {
  const rows: CoverRow[] = [];
  let nextId = 1;

  return {
    rows,
    campCoverReading: {
      create: vi.fn(async ({ data }: { data: Omit<CoverRow, 'id'> & { id?: string } }) => {
        if (data.clientLocalId) {
          const existing = rows.find((r) => r.clientLocalId === data.clientLocalId);
          if (existing) {
            const err = new Error(
              'UNIQUE constraint failed: CampCoverReading.clientLocalId',
            );
            (err as Error & { code?: string }).code = 'P2002';
            throw err;
          }
        }
        const row: CoverRow = {
          id: data.id ?? `cover-${nextId++}`,
          campId: data.campId,
          coverCategory: data.coverCategory,
          kgDmPerHa: data.kgDmPerHa,
          useFactor: data.useFactor ?? 0.35,
          recordedAt: data.recordedAt,
          recordedBy: data.recordedBy,
          attachmentUrl: data.attachmentUrl ?? null,
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
        update: Partial<CoverRow>;
        create: Omit<CoverRow, 'id'> & { id?: string };
      }) => {
        void _update;
        const existing = rows.find((r) => r.clientLocalId === where.clientLocalId);
        if (existing) return existing;
        const row: CoverRow = {
          id: create.id ?? `cover-${nextId++}`,
          campId: create.campId,
          coverCategory: create.coverCategory,
          kgDmPerHa: create.kgDmPerHa,
          useFactor: create.useFactor ?? 0.35,
          recordedAt: create.recordedAt,
          recordedBy: create.recordedBy,
          attachmentUrl: create.attachmentUrl ?? null,
          clientLocalId: create.clientLocalId ?? null,
        };
        rows.push(row);
        return row;
      }),
    },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

function asPrisma(fake: FakePrisma): Parameters<typeof createCoverReading>[0] {
  return fake as unknown as Parameters<typeof createCoverReading>[0];
}

const BASE = {
  campId: 'A',
  coverCategory: 'Good' as const,
  kgDmPerHa: 2000,
  useFactor: 0.35,
  recordedBy: 'logger@example.com',
};

describe('createCoverReading — idempotency via clientLocalId (#207)', () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = makeFakePrisma();
  });

  it('returns the SAME reading when called twice with the same clientLocalId', async () => {
    const clientLocalId = '11111111-1111-4111-8111-111111111111';

    const first = await createCoverReading(asPrisma(fake), {
      ...BASE,
      clientLocalId,
    });
    const second = await createCoverReading(asPrisma(fake), {
      ...BASE,
      // Even with different cover category on retry, first-write content is
      // canonical — the persisted row keeps the original payload.
      coverCategory: 'Poor',
      kgDmPerHa: 450,
      clientLocalId,
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.reading.id).toBe(first.reading.id);
  });

  it('persists exactly one row for two retries of the same clientLocalId', async () => {
    const clientLocalId = '22222222-2222-4222-8222-222222222222';
    await createCoverReading(asPrisma(fake), { ...BASE, clientLocalId });
    await createCoverReading(asPrisma(fake), { ...BASE, clientLocalId });

    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].clientLocalId).toBe(clientLocalId);
  });

  it('uses upsert (not create) when a clientLocalId is supplied', async () => {
    await createCoverReading(asPrisma(fake), {
      ...BASE,
      clientLocalId: '33333333-3333-4333-8333-333333333333',
    });

    expect(fake.campCoverReading.upsert).toHaveBeenCalledOnce();
    expect(fake.campCoverReading.create).not.toHaveBeenCalled();
  });

  it('creates two distinct rows when given two different clientLocalIds', async () => {
    const first = await createCoverReading(asPrisma(fake), {
      ...BASE,
      clientLocalId: '44444444-4444-4444-8444-444444444444',
    });
    const second = await createCoverReading(asPrisma(fake), {
      ...BASE,
      clientLocalId: '55555555-5555-4555-8555-555555555555',
    });

    expect(fake.rows).toHaveLength(2);
    expect(second.reading.id).not.toBe(first.reading.id);
  });

  it('back-compat: when clientLocalId is omitted, uses create (no idempotency promise)', async () => {
    await createCoverReading(asPrisma(fake), BASE);
    await createCoverReading(asPrisma(fake), BASE);

    expect(fake.rows).toHaveLength(2);
    expect(fake.campCoverReading.create).toHaveBeenCalledTimes(2);
    expect(fake.campCoverReading.upsert).not.toHaveBeenCalled();
  });
});
