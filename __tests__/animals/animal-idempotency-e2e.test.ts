// @vitest-environment jsdom
/**
 * Issue #207 — Cycle 4: end-to-end Animal idempotency invariant.
 *
 * Mirrors `__tests__/observations/observation-idempotency-e2e.test.ts` (#206)
 * one-for-one. Composes all three previous cycles for Animal:
 *
 *   form mount (Cycle 2) → clientLocalId UUID generated
 *      ↓
 *   queueAnimalCreate (Cycle 3) → IDB persists row with clientLocalId
 *      ↓
 *   syncPendingAnimals (Cycle 3) → POST body carries clientLocalId
 *      ↓
 *   createAnimal (Cycle 1) → upsert on clientLocalId, 1 row max
 *
 * Failure scenario:
 *   - First sync cycle: network throws — queue row stays `failed`,
 *     clientLocalId preserved.
 *   - Second sync cycle: network succeeds, /api/animals is reached, row lands.
 *   - Third sync cycle: replay of the SAME queued row (simulating the
 *     "looks-like-it-failed-but-server-actually-got-it" case — the canonical
 *     duplicate-row class of bug).
 *   - Final assertion: exactly ONE row in the simulated server DB.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createAnimal } from '@/lib/domain/animals/create-animal';

interface ServerAnimalRow {
  id: string;
  animalId: string;
  name: string | null;
  sex: string;
  category: string;
  currentCamp: string;
  status: string;
  motherId: string | null;
  fatherId: string | null;
  species: string;
  dateAdded: string;
  dateOfBirth: string | null;
  breed: string;
  tagNumber: string | null;
  brandSequence: string | null;
  clientLocalId: string | null;
}

function makeServerDb() {
  const rows: ServerAnimalRow[] = [];
  let nextId = 1;

  const prisma = {
    animal: {
      create: vi.fn(async ({ data }: { data: Omit<ServerAnimalRow, 'id'> }) => {
        if (
          data.clientLocalId &&
          rows.some((r) => r.clientLocalId === data.clientLocalId)
        ) {
          const err = new Error(
            'UNIQUE constraint failed: Animal.clientLocalId',
          );
          (err as Error & { code?: string }).code = 'P2002';
          throw err;
        }
        const row: ServerAnimalRow = {
          id: `srv-${nextId++}`,
          animalId: data.animalId,
          name: data.name ?? null,
          sex: data.sex,
          category: data.category,
          currentCamp: data.currentCamp,
          status: data.status ?? 'Active',
          motherId: data.motherId ?? null,
          fatherId: data.fatherId ?? null,
          species: data.species ?? 'cattle',
          dateAdded: data.dateAdded,
          dateOfBirth: data.dateOfBirth ?? null,
          breed: data.breed ?? 'Brangus',
          tagNumber: data.tagNumber ?? null,
          brandSequence: data.brandSequence ?? null,
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
        update: Partial<ServerAnimalRow>;
        create: Omit<ServerAnimalRow, 'id'>;
      }) => {
        const existing = rows.find(
          (r) => r.clientLocalId === where.clientLocalId,
        );
        if (existing) return existing;
        const row: ServerAnimalRow = {
          id: `srv-${nextId++}`,
          animalId: create.animalId,
          name: create.name ?? null,
          sex: create.sex,
          category: create.category,
          currentCamp: create.currentCamp,
          status: create.status ?? 'Active',
          motherId: create.motherId ?? null,
          fatherId: create.fatherId ?? null,
          species: create.species ?? 'cattle',
          dateAdded: create.dateAdded,
          dateOfBirth: create.dateOfBirth ?? null,
          breed: create.breed ?? 'Brangus',
          tagNumber: create.tagNumber ?? null,
          brandSequence: create.brandSequence ?? null,
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

describe('Animal idempotency — end-to-end (#207 Cycle 4)', () => {
  it('survives network failure + retry: exactly one row after multiple replays of the same clientLocalId', async () => {
    const { setActiveFarmSlug, queueAnimalCreate, getFailedAnimals } =
      await import('@/lib/offline-store');
    const farmSlug = `test-${Math.random().toString(36).slice(2)}`;
    setActiveFarmSlug(farmSlug);

    const uuid = 'aa888888-8888-4888-8888-888888888888';

    // 1. Form-time queue: row lands in IDB with the mount-stable UUID.
    await queueAnimalCreate({
      animal_id: 'CALF-001',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-11',
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    // 2. Stand up an in-memory "server DB" + a fake /api/animals endpoint
    //    that invokes the REAL domain op against that DB. Most faithful
    //    end-to-end approximation runnable inside vitest without Next.js.
    const server = makeServerDb();
    async function fakeApiAnimalsPost(body: {
      animalId: string;
      sex: string;
      category: string;
      currentCamp: string;
      dateAdded?: string;
      clientLocalId?: string | null;
    }): Promise<Response> {
      const result = await createAnimal(
        server.prisma as unknown as Parameters<typeof createAnimal>[0],
        {
          animalId: body.animalId,
          sex: body.sex,
          category: body.category,
          currentCamp: body.currentCamp,
          dateAdded: body.dateAdded,
          clientLocalId: body.clientLocalId ?? null,
        },
      );
      return new Response(JSON.stringify(result), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 3. First sync cycle: network throws.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('NetworkError: connection reset');
    });

    const { syncPendingAnimals } = await import('@/lib/sync-manager');
    const r1 = await syncPendingAnimals();
    expect(r1.synced).toBe(0);
    expect(r1.failed).toBe(1);
    expect(server.rows).toHaveLength(0);

    // Issue #208 — failed rows live in their own (sticky) bucket; the row is
    // still in IDB and reachable via `getFailedAnimals()`. Simulate the
    // #209 retry-from-UI by raw-IDB-toggling status back to `pending` before
    // the second sync cycle.
    const afterFail = await getFailedAnimals();
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0].clientLocalId).toBe(uuid);

    // 4. Second sync cycle: network succeeds, row lands.
    {
      const { openDB } = await import('idb');
      const db = await openDB(`farmtrack-${farmSlug}`);
      const failedLocalId = afterFail[0].local_id!;
      const row = (await db.get('pending_animal_creates', failedLocalId)) as {
        sync_status: 'pending' | 'synced' | 'failed';
      };
      await db.put('pending_animal_creates', { ...row, sync_status: 'pending' });
      db.close();
    }

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/animals') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return fakeApiAnimalsPost(body);
        }
        return new Response('not found', { status: 404 });
      },
    );

    const r2 = await syncPendingAnimals();
    expect(r2.synced).toBe(1);
    expect(server.rows).toHaveLength(1);
    expect(server.rows[0].clientLocalId).toBe(uuid);

    // 5. Killer scenario — re-queue the same payload (different device
    //    replaying its offline buffer, or a "server got it, client thought
    //    it failed" cycle) and sync again.
    await queueAnimalCreate({
      animal_id: 'CALF-001',
      sex: 'Female',
      category: 'Calf',
      current_camp: 'A',
      date_added: '2026-05-11',
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    const r3 = await syncPendingAnimals();
    expect(r3.synced).toBe(1);
    expect(r3.failed).toBe(0);

    // Final invariant — exactly ONE row in the server DB regardless of how
    // many times the client retried.
    expect(
      server.rows,
      `expected exactly one row after retry; saw ${server.rows.length}`,
    ).toHaveLength(1);
    expect(server.rows[0].clientLocalId).toBe(uuid);

    // And the domain op used the idempotent upsert path on every retry.
    expect(server.prisma.animal.upsert).toHaveBeenCalled();
    expect(server.prisma.animal.create).not.toHaveBeenCalled();
  });
});
