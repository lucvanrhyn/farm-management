// @vitest-environment jsdom
/**
 * Issue #207 — Cycle 4: end-to-end CampCoverReading idempotency invariant.
 *
 * Same shape as `__tests__/animals/animal-idempotency-e2e.test.ts` against
 * the cover-reading replay path. Asserts that a queued cover reading,
 * after a NetworkError + retry cycle, lands exactly ONE row on the server.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createCoverReading } from '@/lib/domain/cover/create-cover-reading';

interface ServerCoverRow {
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

function makeServerDb() {
  const rows: ServerCoverRow[] = [];
  let nextId = 1;

  const prisma = {
    campCoverReading: {
      create: vi.fn(async ({ data }: { data: Omit<ServerCoverRow, 'id'> & { id?: string } }) => {
        if (
          data.clientLocalId &&
          rows.some((r) => r.clientLocalId === data.clientLocalId)
        ) {
          const err = new Error(
            'UNIQUE constraint failed: CampCoverReading.clientLocalId',
          );
          (err as Error & { code?: string }).code = 'P2002';
          throw err;
        }
        const row: ServerCoverRow = {
          id: data.id ?? `srv-${nextId++}`,
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
        create,
      }: {
        where: { clientLocalId: string };
        update: Partial<ServerCoverRow>;
        create: Omit<ServerCoverRow, 'id'> & { id?: string };
      }) => {
        const existing = rows.find((r) => r.clientLocalId === where.clientLocalId);
        if (existing) return existing;
        const row: ServerCoverRow = {
          id: create.id ?? `srv-${nextId++}`,
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

  return { rows, prisma };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CampCoverReading idempotency — end-to-end (#207 Cycle 4)', () => {
  it('survives network failure + retry: exactly one row after multiple replays of the same clientLocalId', async () => {
    const { setActiveFarmSlug, queueCoverReading, getFailedCoverReadings } =
      await import('@/lib/offline-store');
    const farmSlug = `test-${Math.random().toString(36).slice(2)}`;
    setActiveFarmSlug(farmSlug);

    const uuid = 'cc888888-8888-4888-8888-888888888888';

    await queueCoverReading({
      farm_slug: 'farm-x',
      camp_id: 'A',
      cover_category: 'Good',
      created_at: '2026-05-11T10:00:00.000Z',
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    const server = makeServerDb();
    async function fakeApiCoverPost(body: {
      coverCategory: 'Good' | 'Fair' | 'Poor';
      clientLocalId?: string | null;
    }): Promise<Response> {
      const result = await createCoverReading(
        server.prisma as unknown as Parameters<typeof createCoverReading>[0],
        {
          campId: 'A',
          coverCategory: body.coverCategory,
          kgDmPerHa: 2000,
          useFactor: 0.35,
          recordedBy: 'logger@example.com',
          clientLocalId: body.clientLocalId ?? null,
        },
      );
      return new Response(
        JSON.stringify({ reading: result.reading, daysRemaining: 7 }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }

    // 1. First cycle — network fails.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('NetworkError: connection reset');
    });

    const { syncPendingCoverReadings } = await import('@/lib/sync-manager');
    const r1 = await syncPendingCoverReadings();
    expect(r1.synced).toBe(0);
    expect(r1.failed).toBe(1);
    expect(server.rows).toHaveLength(0);

    // Issue #208 — failed rows live in the sticky failed bucket; simulate
    // the #209 retry-from-UI by raw-IDB-toggling status back to `pending`.
    const afterFail = await getFailedCoverReadings();
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0].clientLocalId).toBe(uuid);

    {
      const { openDB } = await import('idb');
      const db = await openDB(`farmtrack-${farmSlug}`);
      const failedLocalId = afterFail[0].local_id!;
      const row = (await db.get('pending_cover_readings', failedLocalId)) as {
        sync_status: 'pending' | 'synced' | 'failed';
      };
      await db.put('pending_cover_readings', { ...row, sync_status: 'pending' });
      db.close();
    }

    // 2. Second cycle — network succeeds.
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/cover') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return fakeApiCoverPost(body);
        }
        return new Response('not found', { status: 404 });
      },
    );

    const r2 = await syncPendingCoverReadings();
    expect(r2.synced).toBe(1);
    expect(server.rows).toHaveLength(1);
    expect(server.rows[0].clientLocalId).toBe(uuid);

    // 3. Replay same payload — must not duplicate.
    await queueCoverReading({
      farm_slug: 'farm-x',
      camp_id: 'A',
      cover_category: 'Good',
      created_at: '2026-05-11T10:00:00.000Z',
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    const r3 = await syncPendingCoverReadings();
    expect(r3.synced).toBe(1);
    expect(r3.failed).toBe(0);

    expect(
      server.rows,
      `expected exactly one row after retry; saw ${server.rows.length}`,
    ).toHaveLength(1);
    expect(server.rows[0].clientLocalId).toBe(uuid);
    expect(server.prisma.campCoverReading.upsert).toHaveBeenCalled();
    expect(server.prisma.campCoverReading.create).not.toHaveBeenCalled();
  });
});
