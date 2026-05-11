// @vitest-environment jsdom
/**
 * Issue #206 — Cycle 4: end-to-end idempotency invariant.
 *
 * The setup composes all three previous cycles:
 *
 *   form mount (Cycle 2) → clientLocalId UUID generated
 *      ↓
 *   queueObservation (Cycle 3) → IDB persists row with clientLocalId
 *      ↓
 *   syncPendingObservations (Cycle 3) → POST body carries clientLocalId
 *      ↓
 *   createObservation (Cycle 1) → upsert on clientLocalId, 1 row max
 *
 * The failure scenario:
 *   - First sync cycle: network throws (or returns 5xx). Queue row stays
 *     `failed`, clientLocalId preserved.
 *   - Second sync cycle: network succeeds, /api/observations is reached for
 *     real, the row lands.
 *   - Third sync cycle: replay of the SAME queued row (simulating the "looks
 *     like it failed but the server actually got it" case — the canonical
 *     duplicate-row class of bug).
 *   - Final assertion: exactly ONE row in the simulated server DB. The
 *     server's upsert on `clientLocalId` is the safety net.
 *
 * If any of Cycles 1–3 regresses, this test fails.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createObservation } from '@/lib/domain/observations/create-observation';

interface ServerObservationRow {
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
 * Minimal fake Prisma that mirrors the upsert semantics on the @unique
 * constraint. Each call goes through `createObservation` — the same domain
 * op the real route handler uses — so the idempotency contract is exercised
 * end-to-end rather than re-stubbed.
 */
function makeServerDb() {
  const rows: ServerObservationRow[] = [];
  let nextId = 1;

  const prisma = {
    observation: {
      create: vi.fn(async ({ data }: { data: Omit<ServerObservationRow, 'id'> }) => {
        if (
          data.clientLocalId &&
          rows.some((r) => r.clientLocalId === data.clientLocalId)
        ) {
          const err = new Error(
            'UNIQUE constraint failed: Observation.clientLocalId',
          );
          (err as Error & { code?: string }).code = 'P2002';
          throw err;
        }
        const row: ServerObservationRow = {
          id: `srv-${nextId++}`,
          type: data.type,
          campId: data.campId,
          animalId: data.animalId ?? null,
          details: data.details ?? '',
          observedAt: data.observedAt,
          loggedBy: data.loggedBy ?? null,
          species: data.species ?? null,
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
        update: Partial<ServerObservationRow>;
        create: Omit<ServerObservationRow, 'id'>;
      }) => {
        const existing = rows.find(
          (r) => r.clientLocalId === where.clientLocalId,
        );
        if (existing) return existing;
        const row: ServerObservationRow = {
          id: `srv-${nextId++}`,
          type: create.type,
          campId: create.campId,
          animalId: create.animalId ?? null,
          details: create.details ?? '',
          observedAt: create.observedAt,
          loggedBy: create.loggedBy ?? null,
          species: create.species ?? null,
          clientLocalId: create.clientLocalId ?? null,
        };
        rows.push(row);
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

  return { rows, prisma };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Observation idempotency — end-to-end (#206 Cycle 4)', () => {
  it('survives network failure + retry: exactly one row after multiple replays of the same clientLocalId', async () => {
    const { setActiveFarmSlug, queueObservation, getPendingObservations } =
      await import('@/lib/offline-store');
    setActiveFarmSlug(`test-${Math.random().toString(36).slice(2)}`);

    const uuid = '88888888-8888-4888-8888-888888888888';

    // 1. Form-time queue: the row lands in IDB with the mount-stable UUID.
    await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: JSON.stringify({ grazing: 'Good' }),
      created_at: '2026-05-11T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    // 2. Set up the in-memory "server DB" + a fake /api/observations endpoint
    //    that invokes the REAL domain op against that DB. This is the most
    //    faithful end-to-end approximation we can run inside vitest without
    //    spinning up Next.js.
    const server = makeServerDb();
    async function fakeApiObservationsPost(body: {
      type: string;
      camp_id: string;
      animal_id?: string | null;
      details?: string | null;
      created_at?: string | null;
      clientLocalId?: string | null;
    }): Promise<Response> {
      const result = await createObservation(
        server.prisma as unknown as Parameters<typeof createObservation>[0],
        {
          type: body.type,
          camp_id: body.camp_id,
          animal_id: body.animal_id ?? null,
          details: body.details ?? null,
          created_at: body.created_at ?? null,
          loggedBy: 'logger@example.com',
          clientLocalId: body.clientLocalId ?? null,
        },
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 3. First sync cycle: network throws — classic offline-then-flaky
    //    transition where the server may or may not have received the POST.
    //    For this leg we model "didn't reach the server at all."
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('NetworkError: connection reset');
    });

    const { syncPendingObservations } = await import('@/lib/sync-manager');
    const r1 = await syncPendingObservations();
    expect(r1.synced).toBe(0);
    expect(r1.failed).toBe(1);
    expect(server.rows).toHaveLength(0);

    // The queued row is still present, still carries the original UUID.
    const afterFailure = await getPendingObservations();
    expect(afterFailure).toHaveLength(1);
    expect(afterFailure[0].clientLocalId).toBe(uuid);

    // 4. Second sync cycle: network succeeds. The row lands.
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/observations') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return fakeApiObservationsPost(body);
        }
        return new Response('not found', { status: 404 });
      },
    );

    const r2 = await syncPendingObservations();
    expect(r2.synced).toBe(1);
    expect(r2.failed).toBe(0);
    expect(server.rows).toHaveLength(1);
    expect(server.rows[0].clientLocalId).toBe(uuid);

    // 5. The killer scenario — "server got it, client thought it failed."
    //    Re-queue the same payload (e.g. a backgrounded tab waking up,
    //    a different device replaying its offline buffer, or a user clicking
    //    Submit twice across a tab close) and run sync again.
    await queueObservation({
      type: 'camp_condition',
      camp_id: 'A',
      details: JSON.stringify({ grazing: 'Good' }),
      created_at: '2026-05-11T10:00:00.000Z',
      synced_at: null,
      sync_status: 'pending',
      clientLocalId: uuid,
    });

    const r3 = await syncPendingObservations();
    expect(r3.synced).toBe(1);
    expect(r3.failed).toBe(0);

    // Final invariant — the server-side DB has EXACTLY ONE row for this UUID,
    // no matter how many times the client retried.
    expect(
      server.rows,
      `expected exactly one row after retry; saw ${server.rows.length}`,
    ).toHaveLength(1);
    expect(server.rows[0].clientLocalId).toBe(uuid);

    // And the route used the idempotent upsert path on every retried POST
    // (no `create` calls reached the DB layer, because every POST carried
    // a clientLocalId).
    expect(server.prisma.observation.upsert).toHaveBeenCalled();
    expect(server.prisma.observation.create).not.toHaveBeenCalled();
  });
});
