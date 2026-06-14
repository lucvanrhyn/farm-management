/**
 * @vitest-environment node
 *
 * __tests__/einstein/retriever.test.ts — Phase L Wave 2B semantic + structured retrieval.
 *
 * Covered behaviours:
 *   - semantic() embeds, runs vector_distance_cos SQL, inverts distance→score
 *   - entityTypeFilter adds IN clause; dateRangeFilter adds date bounds
 *   - topK threads through to the LIMIT argument
 *   - structured() dispatches typed Prisma counts by entity type
 *   - missing farm → RetrieverError
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STRUCTURED_DETAIL_LIMIT } from '@/lib/einstein/defaults';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const getPrismaForFarmMock = vi.fn();
const embedMock = vi.fn();
const embeddingToBytesMock = vi.fn();

vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: (...args: unknown[]) => getPrismaForFarmMock(...args),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock('@/lib/einstein/embeddings', () => ({
  embed: (...args: unknown[]) => embedMock(...args),
  embeddingToBytes: (...args: unknown[]) => embeddingToBytesMock(...args),
  EmbeddingError: class extends Error {},
  ZAR_PER_USD: 18.5,
}));

const { retrieve, RetrieverError } = await import('@/lib/einstein/retriever');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakePrisma(
  rows: unknown[],
  counts: Record<string, number> = {},
  observationRows: unknown[] = [],
) {
  const queryRawUnsafe = vi.fn().mockResolvedValue(rows);
  return {
    $queryRawUnsafe: queryRawUnsafe,
    animal: {
      count: vi.fn().mockImplementation((args: { where?: { status?: string } } = {}) => {
        if (args?.where?.status === 'Active') return Promise.resolve(counts.activeAnimals ?? 0);
        return Promise.resolve(counts.totalAnimals ?? 0);
      }),
    },
    camp: {
      count: vi.fn().mockResolvedValue(counts.camps ?? 0),
    },
    observation: {
      count: vi.fn().mockResolvedValue(counts.observations ?? 0),
      findMany: vi.fn().mockResolvedValue(observationRows),
    },
    task: {
      count: vi.fn().mockResolvedValue(counts.tasks ?? 0),
    },
    notification: {
      count: vi.fn().mockResolvedValue(counts.notifications ?? 0),
    },
    __queryRawUnsafe: queryRawUnsafe, // so tests can inspect invocations
  };
}

beforeEach(() => {
  getPrismaForFarmMock.mockReset();
  embedMock.mockReset();
  embeddingToBytesMock.mockReset();
  embeddingToBytesMock.mockImplementation((v: number[]) => new Uint8Array(v.length * 4));
  // 2A's embed() contract: { vectors: Float32Array[], usage: {...}, modelId }.
  // Retriever reads vectors[0] — return one 1536-dim Float32Array per call.
  embedMock.mockResolvedValue({
    vectors: [new Float32Array(Array.from({ length: 1536 }, () => 0.001))],
    usage: { promptTokens: 3, totalTokens: 3, costUsd: 0.00006, costZar: 0.001 },
    modelId: 'text-embedding-3-small',
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('retrieve.semantic', () => {
  it('embeds the query and runs vector_distance_cos SQL with LIMIT', async () => {
    const fakeRows = [
      {
        id: 'c1',
        entityType: 'observation',
        entityId: 'obs-1',
        text: 'mastitis in cow A-12',
        sourceUpdatedAt: new Date('2026-04-01').toISOString(),
        distance: 0.1,
      },
      {
        id: 'c2',
        entityType: 'observation',
        entityId: 'obs-2',
        text: 'weighing under 200kg',
        sourceUpdatedAt: new Date('2026-04-10').toISOString(),
        distance: 0.3,
      },
    ];
    const fake = makeFakePrisma(fakeRows);
    getPrismaForFarmMock.mockResolvedValue(fake);

    const result = await retrieve.semantic('delta-livestock', 'any sick cows recently?');
    expect(embedMock).toHaveBeenCalledWith(['any sick cows recently?']);
    expect(fake.__queryRawUnsafe).toHaveBeenCalled();
    const [sql, ...args] = fake.__queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/vector_distance_cos\(embedding, vector32\(\?\)\)/);
    expect(sql).toMatch(/ORDER BY distance ASC/);
    expect(sql).toMatch(/LIMIT \?/);
    // Last arg is topK (default 16 — raised from 8 for dense date windows, #516)
    expect(args[args.length - 1]).toBe(16);
    expect(result.chunks).toHaveLength(2);
    // Distance 0.1 → score 0.9, distance 0.3 → score 0.7
    expect(result.chunks[0].score).toBeCloseTo(0.9, 5);
    expect(result.chunks[1].score).toBeCloseTo(0.7, 5);
    expect(result.chunks[0].entityType).toBe('observation');
    expect(result.chunks[0].entityId).toBe('obs-1');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('respects topK override', async () => {
    const fake = makeFakePrisma([]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    await retrieve.semantic('delta-livestock', 'q', { topK: 3 });
    const [, ...args] = fake.__queryRawUnsafe.mock.calls[0];
    expect(args[args.length - 1]).toBe(3);
  });

  it('applies entityTypeFilter as IN clause with sanitised whitelist', async () => {
    const fake = makeFakePrisma([]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    await retrieve.semantic('delta-livestock', 'q', {
      entityTypeFilter: ['animal', 'camp'],
    });
    const [sql, ...args] = fake.__queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/entityType IN \(\?, \?\)/);
    // args[0] is embedding bytes; then the IN values, then LIMIT.
    expect(args).toContain('animal');
    expect(args).toContain('camp');
  });

  it('silently drops non-whitelisted entity types from the filter', async () => {
    const fake = makeFakePrisma([]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    await retrieve.semantic('delta-livestock', 'q', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityTypeFilter: ['animal', 'DROP TABLE' as any],
    });
    const [sql] = fake.__queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/entityType IN \(\?\)/); // only one placeholder survived
  });

  it('applies dateRangeFilter on the COALESCE(observedAt, sourceUpdatedAt) event axis (#516)', async () => {
    const fake = makeFakePrisma([]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    const start = new Date('2026-01-01');
    const end = new Date('2026-04-01');
    await retrieve.semantic('delta-livestock', 'q', { dateRangeFilter: { start, end } });
    const [sql, ...args] = fake.__queryRawUnsafe.mock.calls[0];
    // The date window keys on the EVENT axis: observedAt when the chunk carries
    // one (populated going forward by the chunker), else the record-mutation
    // sourceUpdatedAt — so old chunks (observedAt NULL) keep their pre-column
    // behaviour with zero regression, while event-dated chunks match the window
    // they actually fall inside.
    expect(sql).toMatch(/COALESCE\(observedAt, sourceUpdatedAt\) >= \?/);
    expect(sql).toMatch(/COALESCE\(observedAt, sourceUpdatedAt\) <= \?/);
    // and the returned chunk date is surfaced on the same event axis
    expect(sql).toMatch(/COALESCE\(observedAt, sourceUpdatedAt\) AS sourceUpdatedAt/);
    expect(args).toContain(start.toISOString());
    expect(args).toContain(end.toISOString());
  });

  it('clamps negative scores (distance > 1) to 0 and >1 to 1', async () => {
    const fake = makeFakePrisma([
      {
        id: 'c1',
        entityType: 'camp',
        entityId: 'cm1',
        text: 'x',
        sourceUpdatedAt: new Date().toISOString(),
        distance: 1.8, // score would be -0.8
      },
      {
        id: 'c2',
        entityType: 'camp',
        entityId: 'cm2',
        text: 'y',
        sourceUpdatedAt: new Date().toISOString(),
        distance: -0.5, // score would be 1.5
      },
    ]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.semantic('delta-livestock', 'q');
    expect(result.chunks[0].score).toBe(0);
    expect(result.chunks[1].score).toBe(1);
  });

  it('throws RetrieverError when farm is unreachable', async () => {
    getPrismaForFarmMock.mockResolvedValue(null);
    await expect(retrieve.semantic('ghost', 'q')).rejects.toBeInstanceOf(RetrieverError);
  });

  it('throws RETRIEVER_EMBED_FAILED when embed throws', async () => {
    embedMock.mockRejectedValueOnce(new Error('OpenAI 429'));
    const fake = makeFakePrisma([]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    try {
      await retrieve.semantic('delta-livestock', 'q');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RetrieverError);
      expect((err as InstanceType<typeof RetrieverError>).code).toBe('RETRIEVER_EMBED_FAILED');
    }
  });
});

describe('retrieve.structured', () => {
  it('dispatches animal counts when entity filter includes "animal"', async () => {
    const fake = makeFakePrisma([], { totalAnimals: 150, activeAnimals: 103 });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'how many animals',
      isStructuredQuery: true,
      entityTypeFilter: ['animal'],
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].entityType).toBe('animal');
    expect(result.chunks[0].text).toMatch(/Total animals: 150.*Active: 103/);
    expect(result.chunks[0].score).toBe(1);
  });

  it('dispatches camp counts', async () => {
    const fake = makeFakePrisma([], { camps: 42 });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'how many camps',
      isStructuredQuery: true,
      entityTypeFilter: ['camp'],
    });
    expect(result.chunks[0].text).toMatch(/Total camps: 42/);
  });

  it('dispatches observation counts with date range', async () => {
    const fake = makeFakePrisma([], { observations: 17 });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const start = new Date('2026-03-01');
    const end = new Date('2026-04-01');
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'how many obs',
      isStructuredQuery: true,
      entityTypeFilter: ['observation'],
      dateRangeFilter: { start, end },
    });
    expect(result.chunks[0].text).toMatch(/Total observations.*17/);
    expect(fake.observation.count).toHaveBeenCalledWith({
      where: { observedAt: { gte: start, lte: end } },
    });
  });

  it('fetches observation detail rows on the observedAt axis with cap + desc order (#516)', async () => {
    const start = new Date('2026-03-01');
    const end = new Date('2026-04-01');
    const detailRows = [
      {
        id: 'obs-77',
        type: 'health',
        observedAt: new Date('2026-03-20'),
        campId: 'camp-3',
        animalId: 'an-9',
        details: 'mild lameness left hind',
        loggedBy: 'Thabo',
      },
    ];
    const fake = makeFakePrisma([], { observations: 17 }, detailRows);
    getPrismaForFarmMock.mockResolvedValue(fake);
    await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'what was observed last month',
      isStructuredQuery: true,
      entityTypeFilter: ['observation'],
      dateRangeFilter: { start, end },
    });
    // Detail rows MUST be fetched on the event axis (observedAt), capped, and
    // most-recent-first. This is the same axis as the count — so a date window
    // resolves the same set of events, not the record-mutation axis.
    expect(fake.observation.findMany).toHaveBeenCalledWith({
      where: { observedAt: { gte: start, lte: end } },
      orderBy: { observedAt: 'desc' },
      take: STRUCTURED_DETAIL_LIMIT,
    });
  });

  it('returns a late-logged observation as a detail chunk by its observedAt, not its record date (#516 regression)', async () => {
    const start = new Date('2026-03-01');
    const end = new Date('2026-04-01');
    // observedAt is INSIDE the window (2026-03-15) but the row was logged/
    // edited much later (2026-05-30). The semantic path keys on the record
    // date and would MISS it; the structured detail path keys on observedAt
    // and MUST surface it. The door is filtered on observedAt, so the fake
    // simply returns this in-window row.
    const lateLogged = {
      id: 'obs-late-1',
      type: 'weight',
      observedAt: new Date('2026-03-15'),
      campId: 'camp-7',
      animalId: 'an-42',
      details: 'recorded retroactively from the paper logbook',
      loggedBy: 'Naledi',
    };
    const fake = makeFakePrisma([], { observations: 1 }, [lateLogged]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'what was observed in March',
      isStructuredQuery: true,
      entityTypeFilter: ['observation'],
      dateRangeFilter: { start, end },
    });
    const detail = result.chunks.find((c) => c.entityId === 'obs-late-1');
    expect(detail).toBeDefined();
    expect(detail!.entityType).toBe('observation');
    // sourceUpdatedAt is anchored to the EVENT date (observedAt), not the
    // record-mutation date — this is what grounds the date-windowed answer.
    expect(detail!.sourceUpdatedAt.toISOString().slice(0, 10)).toBe('2026-03-15');
    expect(detail!.text).toMatch(/observation:weight @ 2026-03-15/);
    expect(detail!.text).toMatch(/an-42/);
    expect(detail!.text).toMatch(/recorded retroactively/);
  });

  it('emits the aggregate count chunk alongside the detail rows', async () => {
    const start = new Date('2026-03-01');
    const end = new Date('2026-04-01');
    const detailRows = [
      { id: 'o1', type: 'health', observedAt: new Date('2026-03-10'), campId: 'c1', animalId: 'a1', details: 'd1', loggedBy: 'x' },
      { id: 'o2', type: 'weight', observedAt: new Date('2026-03-05'), campId: 'c2', animalId: 'a2', details: 'd2', loggedBy: 'y' },
    ];
    const fake = makeFakePrisma([], { observations: 2 }, detailRows);
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'observations in March',
      isStructuredQuery: true,
      entityTypeFilter: ['observation'],
      dateRangeFilter: { start, end },
    });
    // The aggregate count is still present (answers "how many").
    const count = result.chunks.find((c) => c.entityId === 'aggregate:observations');
    expect(count).toBeDefined();
    expect(count!.text).toMatch(/Total observations.*2/);
    expect(count!.score).toBe(1);
    // Plus one detail chunk per row, each carrying the real observation id so
    // the answer LLM can cite it.
    expect(result.chunks.filter((c) => c.entityId === 'o1' || c.entityId === 'o2')).toHaveLength(2);
    // Detail chunks sit just below the count's score so a downstream budget
    // keeps them, but the count still sorts ahead.
    const o1 = result.chunks.find((c) => c.entityId === 'o1')!;
    expect(o1.score).toBe(0.99);
    expect(o1.entityType).toBe('observation');
  });

  it('notes truncation only when the detail rows hit the cap', async () => {
    const start = new Date('2026-03-01');
    const end = new Date('2026-04-01');
    const full = Array.from({ length: STRUCTURED_DETAIL_LIMIT }, (_, i) => ({
      id: `obs-${i}`,
      type: 'health',
      observedAt: new Date('2026-03-10'),
      campId: 'c1',
      animalId: `a${i}`,
      details: `note ${i}`,
      loggedBy: 'x',
    }));
    const fake = makeFakePrisma([], { observations: 99 }, full);
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'observations in March',
      isStructuredQuery: true,
      entityTypeFilter: ['observation'],
      dateRangeFilter: { start, end },
    });
    const trunc = result.chunks.find(
      (c) => c.entityId === 'aggregate:observations:truncated',
    );
    expect(trunc).toBeDefined();
    expect(trunc!.text).toMatch(new RegExp(`${STRUCTURED_DETAIL_LIMIT} most recent`));
  });

  it('dispatches task counts with date range on dueDate (YYYY-MM-DD string axis)', async () => {
    const fake = makeFakePrisma([], { tasks: 9 });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const start = new Date('2026-03-01');
    const end = new Date('2026-04-01');
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'how many tasks',
      isStructuredQuery: true,
      entityTypeFilter: ['task'],
      dateRangeFilter: { start, end },
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].entityType).toBe('task');
    expect(result.chunks[0].entityId).toBe('aggregate:tasks');
    expect(result.chunks[0].text).toMatch(/9/);
    expect(result.chunks[0].score).toBe(1);
    // dueDate is a String column storing YYYY-MM-DD — the range bounds
    // must be date-strings, not Date objects, or the lexicographic
    // comparison silently fails to match any row.
    expect(fake.task.count).toHaveBeenCalledWith({
      where: { dueDate: { gte: '2026-03-01', lte: '2026-04-01' } },
    });
  });

  it('dispatches notification counts with date range on createdAt', async () => {
    const fake = makeFakePrisma([], { notifications: 23 });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const start = new Date('2026-03-01');
    const end = new Date('2026-04-01');
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'how many notifications',
      isStructuredQuery: true,
      entityTypeFilter: ['notification'],
      dateRangeFilter: { start, end },
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].entityType).toBe('notification');
    expect(result.chunks[0].entityId).toBe('aggregate:notifications');
    expect(result.chunks[0].text).toMatch(/23/);
    expect(result.chunks[0].score).toBe(1);
    // createdAt is a DateTime column — Date bounds pass through directly.
    expect(fake.notification.count).toHaveBeenCalledWith({
      where: { createdAt: { gte: start, lte: end } },
    });
  });

  it('dispatches task/notification counts without a date range (no where clause)', async () => {
    const fake = makeFakePrisma([], { tasks: 5, notifications: 7 });
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'tasks and notifications',
      isStructuredQuery: true,
      entityTypeFilter: ['task', 'notification'],
    });
    expect(result.chunks).toHaveLength(2);
    expect(fake.task.count).toHaveBeenCalledWith({ where: {} });
    expect(fake.notification.count).toHaveBeenCalledWith({ where: {} });
  });

  it('returns empty chunks when no filter matches', async () => {
    const fake = makeFakePrisma([], {});
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.structured('delta-livestock', {
      rewrittenQuery: 'q',
      isStructuredQuery: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityTypeFilter: ['not-a-type' as any],
    });
    expect(result.chunks).toHaveLength(0);
  });
});
