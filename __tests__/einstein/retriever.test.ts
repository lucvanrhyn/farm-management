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

function makeFakePrisma(rows: unknown[], counts: Record<string, number> = {}) {
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

    const result = await retrieve.semantic('trio-b-boerdery', 'any sick cows recently?');
    expect(embedMock).toHaveBeenCalledWith(['any sick cows recently?']);
    expect(fake.__queryRawUnsafe).toHaveBeenCalled();
    const [sql, ...args] = fake.__queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/vector_distance_cos\(embedding, vector32\(\?\)\)/);
    expect(sql).toMatch(/ORDER BY distance ASC/);
    expect(sql).toMatch(/LIMIT \?/);
    // Last arg is topK (default 8)
    expect(args[args.length - 1]).toBe(8);
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
    await retrieve.semantic('trio-b-boerdery', 'q', { topK: 3 });
    const [, ...args] = fake.__queryRawUnsafe.mock.calls[0];
    expect(args[args.length - 1]).toBe(3);
  });

  it('applies entityTypeFilter as IN clause with sanitised whitelist', async () => {
    const fake = makeFakePrisma([]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    await retrieve.semantic('trio-b-boerdery', 'q', {
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
    await retrieve.semantic('trio-b-boerdery', 'q', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityTypeFilter: ['animal', 'DROP TABLE' as any],
    });
    const [sql] = fake.__queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/entityType IN \(\?\)/); // only one placeholder survived
  });

  it('applies dateRangeFilter as >= / <= clauses', async () => {
    const fake = makeFakePrisma([]);
    getPrismaForFarmMock.mockResolvedValue(fake);
    const start = new Date('2026-01-01');
    const end = new Date('2026-04-01');
    await retrieve.semantic('trio-b-boerdery', 'q', { dateRangeFilter: { start, end } });
    const [sql, ...args] = fake.__queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/sourceUpdatedAt >= \?/);
    expect(sql).toMatch(/sourceUpdatedAt <= \?/);
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
    const result = await retrieve.semantic('trio-b-boerdery', 'q');
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
      await retrieve.semantic('trio-b-boerdery', 'q');
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
    const result = await retrieve.structured('trio-b-boerdery', {
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
    const result = await retrieve.structured('trio-b-boerdery', {
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
    const result = await retrieve.structured('trio-b-boerdery', {
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

  it('returns empty chunks when no filter matches', async () => {
    const fake = makeFakePrisma([], {});
    getPrismaForFarmMock.mockResolvedValue(fake);
    const result = await retrieve.structured('trio-b-boerdery', {
      rewrittenQuery: 'q',
      isStructuredQuery: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entityTypeFilter: ['not-a-type' as any],
    });
    expect(result.chunks).toHaveLength(0);
  });
});
