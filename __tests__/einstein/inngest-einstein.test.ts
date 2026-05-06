/**
 * @vitest-environment node
 *
 * __tests__/einstein/inngest-einstein.test.ts — Phase L Wave 2C unit tests.
 *
 * Guarantees:
 *   1. Fan-out cron (einsteinDailyReindex) emits one event per tenant slug.
 *   2. Per-tenant worker (reindexForTenant) gathers stale rows across all 7
 *      entity types, calls embed() exactly once with concatenated text, and
 *      upserts one chunk per vector with the Float32Array → Bytes conversion.
 *   3. reindexForTenant preserves vector order across a multi-type batch.
 *   4. P2002 on upsert is swallowed via findFirst + update recovery.
 *   5. reindexForEntity only touches one entity id's chunks.
 *   6. einsteinMonthlyBudgetReset calls resetMonthlyBudget once per slug and
 *      tolerates individual failures.
 *   7. ALL_EINSTEIN_FUNCTIONS exposes all four functions with stable ids.
 *
 * Wave 2A + 2B dependency: we vi.mock("@/lib/einstein/chunker") and
 * ("@/lib/einstein/embeddings") and ("@/lib/einstein/budget") so these tests
 * stay runnable even if Wave 2A/2B's modules haven't landed yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (these must precede the import of the module under test) ──

vi.mock("@/lib/einstein/chunker", () => ({
  toEmbeddingText: vi.fn(),
}));

vi.mock("@/lib/einstein/embeddings", () => ({
  embed: vi.fn(),
  embeddingToBytes: vi.fn((v: Float32Array) =>
    Buffer.from(v.buffer, v.byteOffset, v.byteLength),
  ),
}));

vi.mock("@/lib/einstein/budget", () => ({
  resetMonthlyBudget: vi.fn(),
}));

vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForFarm: vi.fn().mockResolvedValue(null),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock("@/lib/meta-db", () => ({
  getAllFarmSlugs: vi.fn().mockResolvedValue([]),
}));

// Capture the handlers inngest.createFunction was called with so we can
// invoke them directly. Each call returns a stub with `.opts` + `.__handler`.
vi.mock("@/lib/server/inngest/client", () => ({
  inngest: {
    createFunction: (opts: unknown, handler: unknown) => ({
      opts,
      __handler: handler,
    }),
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  ALL_EINSTEIN_FUNCTIONS,
  einsteinDailyReindex,
  reindexEinsteinTenant,
  reindexEinsteinEntity,
  einsteinMonthlyBudgetReset,
  reindexForTenant,
  reindexForEntity,
  findStaleEntities,
  renderChunksForType,
  ENTITY_TYPES,
  CURRENT_CHUNKER_VERSION,
} from "@/lib/server/inngest/einstein";
import type { EntityType, RenderedChunk } from "@/lib/einstein/chunker";
import { toEmbeddingText } from "@/lib/einstein/chunker";
import { embed, embeddingToBytes } from "@/lib/einstein/embeddings";
import { resetMonthlyBudget } from "@/lib/einstein/budget";
import { getAllFarmSlugs } from "@/lib/meta-db";
import { makePrisma } from "../alerts/fixtures";

// ── Helpers ──────────────────────────────────────────────────────────────────

type FnOrFns = ReturnType<typeof vi.fn> | Record<string, ReturnType<typeof vi.fn>>;

function p2002(): Error {
  const err = new Error("Unique constraint failed") as Error & { code: string };
  err.code = "P2002";
  return err;
}

function makeVector(seed: number): Float32Array {
  const v = new Float32Array(4);
  for (let i = 0; i < 4; i++) v[i] = seed + i * 0.01;
  return v;
}

function makeRenderedChunk(
  entityType: EntityType,
  entityId: string,
  text: string,
  sourceUpdatedAt: Date = new Date("2026-04-01T00:00:00Z"),
  langTag = "en",
): RenderedChunk {
  return { entityType, entityId, langTag, text, sourceUpdatedAt } as RenderedChunk;
}

/**
 * Build a Prisma mock where every entity-type findMany is empty by default.
 * Tests override the specific models they care about.
 */
function makeEinsteinPrisma(overrides: Record<string, FnOrFns> = {}) {
  const emptyFindMany = () => vi.fn().mockResolvedValue([]);
  const emptyFindUnique = () => vi.fn().mockResolvedValue(null);
  const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: `c-${Math.random().toString(36).slice(2, 8)}`, ...create }),
  );
  return makePrisma({
    observation: { findMany: emptyFindMany(), findUnique: emptyFindUnique() },
    // Phase A of #28: einstein worker uses findFirst (campId no longer globally unique).
    camp: { findMany: emptyFindMany(), findUnique: emptyFindUnique(), findFirst: emptyFindUnique() },
    animal: { findMany: emptyFindMany(), findUnique: emptyFindUnique() },
    task: { findMany: emptyFindMany(), findUnique: emptyFindUnique() },
    taskTemplate: { findMany: emptyFindMany(), findUnique: emptyFindUnique() },
    notification: {
      findMany: emptyFindMany(),
      findUnique: emptyFindUnique(),
      // Overwrite makePrisma's default create/update so notification.findMany
      // isn't surprising.
    },
    it3Snapshot: { findMany: emptyFindMany(), findUnique: emptyFindUnique() },
    einsteinChunk: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert,
      update: vi.fn().mockImplementation(({ data, where }: { data: Record<string, unknown>; where: { id: string } }) =>
        Promise.resolve({ ...data, id: where.id }),
      ),
    },
    ...overrides,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ALL_EINSTEIN_FUNCTIONS registration surface", () => {
  it("exports all four functions in ALL_EINSTEIN_FUNCTIONS", () => {
    expect(ALL_EINSTEIN_FUNCTIONS).toHaveLength(4);
    expect(ALL_EINSTEIN_FUNCTIONS).toContain(einsteinDailyReindex);
    expect(ALL_EINSTEIN_FUNCTIONS).toContain(reindexEinsteinTenant);
    expect(ALL_EINSTEIN_FUNCTIONS).toContain(reindexEinsteinEntity);
    expect(ALL_EINSTEIN_FUNCTIONS).toContain(einsteinMonthlyBudgetReset);
  });

  it("pins stable Inngest function ids (Inngest dashboard depends on these)", () => {
    const ids = ALL_EINSTEIN_FUNCTIONS.map(
      (f) => (f as unknown as { opts: { id: string } }).opts.id,
    );
    expect(ids).toEqual([
      "einstein-daily-reindex",
      "reindex-einstein-tenant",
      "reindex-einstein-entity",
      "einstein-monthly-budget-reset",
    ]);
  });

  it("enforces concurrency.limit <= 5 on all worker functions (free-plan cap)", () => {
    const workers = [
      reindexEinsteinTenant,
      reindexEinsteinEntity,
      einsteinMonthlyBudgetReset,
    ];
    for (const fn of workers) {
      const opts = (fn as unknown as { opts: { concurrency?: { limit: number } } }).opts;
      expect(opts.concurrency?.limit).toBeLessThanOrEqual(5);
    }
  });

  it("sets Africa/Johannesburg timezone on both cron triggers", () => {
    const cronFns = [einsteinDailyReindex, einsteinMonthlyBudgetReset];
    for (const fn of cronFns) {
      const opts = (fn as unknown as {
        opts: { triggers: Array<{ cron?: string }> };
      }).opts;
      expect(opts.triggers[0].cron).toMatch(/TZ=Africa\/Johannesburg/);
    }
  });
});

describe("einsteinDailyReindex fan-out handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits one einstein/reindex.tenant event per slug", async () => {
    (getAllFarmSlugs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      "farm-alpha",
      "farm-bravo",
      "farm-charlie",
    ]);

    const sent: unknown[] = [];
    const step = {
      run: vi.fn().mockImplementation(async (_name: string, fn: () => unknown) => fn()),
      sendEvent: vi.fn().mockImplementation(async (_name: string, events: unknown) => {
        sent.push(events);
      }),
    };

    const handler = (einsteinDailyReindex as unknown as {
      __handler: (ctx: { step: typeof step }) => Promise<{ tenantCount: number }>;
    }).__handler;

    const result = await handler({ step });

    expect(result.tenantCount).toBe(3);
    expect(step.sendEvent).toHaveBeenCalledTimes(1);
    const events = sent[0] as Array<{ name: string; data: { farmSlug: string } }>;
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.name)).toEqual([
      "einstein/reindex.tenant",
      "einstein/reindex.tenant",
      "einstein/reindex.tenant",
    ]);
    expect(events.map((e) => e.data.farmSlug)).toEqual([
      "farm-alpha",
      "farm-bravo",
      "farm-charlie",
    ]);
  });

  it("short-circuits with tenantCount:0 when there are no tenants", async () => {
    (getAllFarmSlugs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const step = {
      run: vi.fn().mockImplementation(async (_name: string, fn: () => unknown) => fn()),
      sendEvent: vi.fn(),
    };

    const handler = (einsteinDailyReindex as unknown as {
      __handler: (ctx: { step: typeof step }) => Promise<{ tenantCount: number }>;
    }).__handler;

    const result = await handler({ step });

    expect(result).toEqual({ tenantCount: 0 });
    expect(step.sendEvent).not.toHaveBeenCalled();
  });
});

describe("findStaleEntities — stale-detection SQL filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rows where no chunk exists OR source.updatedAt > chunk.sourceUpdatedAt", async () => {
    // Observation rows surface their change-time via `editedAt ?? createdAt`
    // (FarmTrack's schema has no `updatedAt` on Observation). Fixtures use
    // `createdAt` because these rows haven't been edited.
    const obs1 = { id: "obs-1", createdAt: new Date("2026-04-10T00:00:00Z"), editedAt: null }; // newer than chunk
    const obs2 = { id: "obs-2", createdAt: new Date("2026-04-05T00:00:00Z"), editedAt: null }; // equal → skip
    const obs3 = { id: "obs-3", createdAt: new Date("2026-04-01T00:00:00Z"), editedAt: null }; // no chunk

    // For this test we want ONLY the timestamp trigger to fire.
    // Supply chunkerVersion + contentHash that match the current state so
    // Trigger B and Trigger C stay silent. The observation chunker renders
    // a fixed text for these fixtures; we use a placeholder hash that equals
    // what sha256(text) would produce for the empty/default renderer output.
    // Because toEmbeddingText is mocked to return [] at module level, the hash
    // check falls through (no rendered text → no hash comparison → skip hash
    // trigger), so passing any non-empty contentHash keeps Trigger C quiet.
    const freshChunkBase = { chunkerVersion: CURRENT_CHUNKER_VERSION, contentHash: "fresh-hash-obs" };
    const prisma = makeEinsteinPrisma({
      observation: {
        findMany: vi.fn().mockResolvedValue([obs1, obs2, obs3]),
      },
      einsteinChunk: {
        findMany: vi.fn().mockResolvedValue([
          { entityId: "obs-1", sourceUpdatedAt: new Date("2026-04-05T00:00:00Z"), ...freshChunkBase },
          { entityId: "obs-2", sourceUpdatedAt: new Date("2026-04-05T00:00:00Z"), ...freshChunkBase },
        ]),
      },
    });

    const stale = await findStaleEntities(prisma, "observation");
    const staleIds = stale.map((s) => s.id).sort();

    expect(staleIds).toEqual(["obs-1", "obs-3"]);
    // Prisma is queried for chunks filtered to this entityType.
    const einsteinFindMany = (prisma as unknown as {
      einsteinChunk: { findMany: ReturnType<typeof vi.fn> };
    }).einsteinChunk.findMany;
    expect(einsteinFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: "observation",
          entityId: { in: ["obs-1", "obs-2", "obs-3"] },
        }),
      }),
    );
  });

  it("short-circuits with empty array when the source table is empty", async () => {
    const prisma = makeEinsteinPrisma({
      task: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const stale = await findStaleEntities(prisma, "task");
    expect(stale).toEqual([]);
  });
});

describe("renderChunksForType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls toEmbeddingText once per stale entity and concatenates the results", async () => {
    const row1 = { id: "c-1", updatedAt: new Date("2026-04-10T00:00:00Z"), name: "North" };
    const row2 = { id: "c-2", updatedAt: new Date("2026-04-10T00:00:00Z"), name: "South" };
    const prisma = makeEinsteinPrisma({
      camp: { findMany: vi.fn().mockResolvedValue([row1, row2]) },
    });

    (toEmbeddingText as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      ({ entityId }: { entityId: string }) => [
        makeRenderedChunk("camp", entityId, `text for ${entityId}`),
      ],
    );

    const chunks = await renderChunksForType(prisma, "camp");

    expect(toEmbeddingText).toHaveBeenCalledTimes(2);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.entityId)).toEqual(["c-1", "c-2"]);
  });

  it("drops rows whose chunker returns empty array (e.g. empty observations)", async () => {
    const row = { id: "obs-empty", updatedAt: new Date("2026-04-10T00:00:00Z") };
    const prisma = makeEinsteinPrisma({
      observation: { findMany: vi.fn().mockResolvedValue([row]) },
    });

    (toEmbeddingText as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const chunks = await renderChunksForType(prisma, "observation");
    expect(chunks).toEqual([]);
  });
});

describe("reindexForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls embed() exactly once with concatenated text from all 7 entity types, order preserved", async () => {
    // Seed every entity type with one stale row.
    const baseDate = new Date("2026-04-10T00:00:00Z");
    const rowFor = (id: string) => ({ id, updatedAt: baseDate });
    const prisma = makeEinsteinPrisma({
      observation: { findMany: vi.fn().mockResolvedValue([rowFor("obs-1")]) },
      camp: { findMany: vi.fn().mockResolvedValue([rowFor("camp-1")]) },
      animal: { findMany: vi.fn().mockResolvedValue([rowFor("animal-1")]) },
      task: { findMany: vi.fn().mockResolvedValue([rowFor("task-1")]) },
      taskTemplate: { findMany: vi.fn().mockResolvedValue([rowFor("tmpl-1")]) },
      notification: { findMany: vi.fn().mockResolvedValue([rowFor("notif-1")]) },
      it3Snapshot: { findMany: vi.fn().mockResolvedValue([rowFor("it3-1")]) },
    });

    // Chunker returns one chunk per entity, text = entityType:entityId.
    (toEmbeddingText as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      ({ entityType, entityId }: { entityType: EntityType; entityId: string }) => [
        makeRenderedChunk(entityType, entityId, `${entityType}:${entityId}`),
      ],
    );

    // embed() returns vectors in the same order as input, seeded by index.
    (embed as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (texts: string[]) => ({
        vectors: texts.map((_, i) => makeVector(i)),
        modelId: "text-embedding-3-small",
        usage: {
          promptTokens: 70,
          totalTokens: 70,
          costUsd: 0.000014,
          costZar: 0.00026,
        },
      }),
    );

    const result = await reindexForTenant(prisma, "farm-alpha");

    // Exactly one embed call.
    expect(embed).toHaveBeenCalledTimes(1);
    // Text array is length 7 and in the documented ENTITY_TYPES order.
    const [texts] = (embed as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(texts).toHaveLength(7);
    expect(texts).toEqual([
      "observation:obs-1",
      "camp:camp-1",
      "animal:animal-1",
      "task:task-1",
      "task_template:tmpl-1",
      "notification:notif-1",
      "it3_snapshot:it3-1",
    ]);

    // One upsert per chunk with Bytes payload + matching langTag.
    const upsertFn = (prisma as unknown as {
      einsteinChunk: { upsert: ReturnType<typeof vi.fn> };
    }).einsteinChunk.upsert;
    expect(upsertFn).toHaveBeenCalledTimes(7);
    for (const call of upsertFn.mock.calls) {
      const { create } = call[0] as { create: { langTag: string; embedding: unknown } };
      expect(create.langTag).toBe("en");
      expect(create.embedding).toBeInstanceOf(Buffer);
    }
    // embeddingToBytes was called once per vector.
    expect(embeddingToBytes).toHaveBeenCalledTimes(7);

    expect(result.embedded).toBe(7);
    expect(result.tokensUsed).toBe(70);
    expect(result.costZar).toBeCloseTo(0.00026, 5);
    expect(result.slug).toBe("farm-alpha");
  });

  it("recovers from P2002 via findFirst + update (concurrent writer landed the row)", async () => {
    const baseDate = new Date("2026-04-10T00:00:00Z");
    const prisma = makeEinsteinPrisma({
      observation: {
        findMany: vi.fn().mockResolvedValue([{ id: "obs-1", updatedAt: baseDate }]),
      },
      einsteinChunk: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "winner-1", entityType: "observation", entityId: "obs-1", langTag: "en" }),
        upsert: vi.fn().mockRejectedValue(p2002()),
        update: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id }),
        ),
      },
    });

    (toEmbeddingText as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      makeRenderedChunk("observation", "obs-1", "text"),
    ]);
    (embed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      vectors: [makeVector(0)],
      modelId: "text-embedding-3-small",
      usage: { promptTokens: 10, totalTokens: 10, costUsd: 0, costZar: 0 },
    });

    const result = await reindexForTenant(prisma, "farm-alpha");

    const chunkMock = (prisma as unknown as {
      einsteinChunk: {
        upsert: ReturnType<typeof vi.fn>;
        findFirst: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    }).einsteinChunk;

    expect(chunkMock.upsert).toHaveBeenCalledTimes(1);
    expect(chunkMock.findFirst).toHaveBeenCalledTimes(1);
    expect(chunkMock.update).toHaveBeenCalledTimes(1);
    expect(chunkMock.update.mock.calls[0][0].where.id).toBe("winner-1");
    expect(result.embedded).toBe(1);
  });

  it("returns zero-everything when no stale rows exist (doesn't call embed)", async () => {
    const prisma = makeEinsteinPrisma();
    const result = await reindexForTenant(prisma, "farm-empty");

    expect(embed).not.toHaveBeenCalled();
    expect(result.embedded).toBe(0);
    expect(result.tokensUsed).toBe(0);
    expect(result.costZar).toBe(0);
  });

  it("re-throws non-P2002 errors so Inngest can retry the step", async () => {
    const prisma = makeEinsteinPrisma({
      observation: {
        findMany: vi.fn().mockResolvedValue([{ id: "obs-1", updatedAt: new Date() }]),
      },
      einsteinChunk: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockRejectedValue(new Error("DB connection reset")),
      },
    });

    (toEmbeddingText as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      makeRenderedChunk("observation", "obs-1", "text"),
    ]);
    (embed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      vectors: [makeVector(0)],
      modelId: "text-embedding-3-small",
      usage: { promptTokens: 5, totalTokens: 5, costUsd: 0, costZar: 0 },
    });

    await expect(reindexForTenant(prisma, "farm-alpha")).rejects.toThrow(
      "DB connection reset",
    );
  });
});

describe("reindexForEntity — fast-path single-entity scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only embeds the one entity id passed in, ignoring other rows in the table", async () => {
    const prisma = makeEinsteinPrisma({
      observation: {
        findMany: vi.fn().mockResolvedValue([]), // should NOT be called
        findUnique: vi.fn().mockResolvedValue({
          id: "obs-target",
          updatedAt: new Date("2026-04-10T00:00:00Z"),
        }),
      },
    });

    (toEmbeddingText as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      makeRenderedChunk("observation", "obs-target", "target text"),
    ]);
    (embed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      vectors: [makeVector(0)],
      modelId: "text-embedding-3-small",
      usage: { promptTokens: 3, totalTokens: 3, costUsd: 0, costZar: 0 },
    });

    const result = await reindexForEntity(
      prisma,
      "farm-alpha",
      "observation",
      "obs-target",
    );

    // findUnique scoped to the entity id — findMany is NOT used on the fast path.
    const obsMock = (prisma as unknown as {
      observation: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    }).observation;
    expect(obsMock.findUnique).toHaveBeenCalledWith({ where: { id: "obs-target" } });
    expect(obsMock.findMany).not.toHaveBeenCalled();

    // embed was called with exactly one text.
    const [texts] = (embed as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(texts).toEqual(["target text"]);

    // One upsert for the single chunk.
    const upsertFn = (prisma as unknown as {
      einsteinChunk: { upsert: ReturnType<typeof vi.fn> };
    }).einsteinChunk.upsert;
    expect(upsertFn).toHaveBeenCalledTimes(1);
    expect(upsertFn.mock.calls[0][0].create.entityId).toBe("obs-target");

    expect(result).toMatchObject({
      slug: "farm-alpha",
      entityType: "observation",
      entityId: "obs-target",
      embedded: 1,
    });
  });

  it("returns embedded:0 when the entity was deleted between the event and pickup", async () => {
    const prisma = makeEinsteinPrisma({
      camp: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    const result = await reindexForEntity(
      prisma,
      "farm-alpha",
      "camp",
      "camp-deleted",
    );

    expect(embed).not.toHaveBeenCalled();
    const upsertFn = (prisma as unknown as {
      einsteinChunk: { upsert: ReturnType<typeof vi.fn> };
    }).einsteinChunk.upsert;
    expect(upsertFn).not.toHaveBeenCalled();
    expect(result.embedded).toBe(0);
  });
});

describe("einsteinMonthlyBudgetReset handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls resetMonthlyBudget once per tenant slug", async () => {
    (getAllFarmSlugs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      "farm-alpha",
      "farm-bravo",
      "farm-charlie",
    ]);
    (resetMonthlyBudget as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const step = {
      run: vi.fn().mockImplementation(async (_name: string, fn: () => unknown) => fn()),
      sendEvent: vi.fn(),
    };

    const handler = (einsteinMonthlyBudgetReset as unknown as {
      __handler: (ctx: { step: typeof step }) => Promise<{
        tenantCount: number;
        resetCount: number;
        failures: Array<{ slug: string }>;
      }>;
    }).__handler;

    const result = await handler({ step });

    expect(resetMonthlyBudget).toHaveBeenCalledTimes(3);
    expect((resetMonthlyBudget as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      "farm-alpha",
      "farm-bravo",
      "farm-charlie",
    ]);
    expect(result).toEqual({
      tenantCount: 3,
      resetCount: 3,
      failures: [],
    });
  });

  it("tolerates individual failures — one broken tenant does not block the others", async () => {
    (getAllFarmSlugs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      "farm-alpha",
      "farm-broken",
      "farm-charlie",
    ]);
    (resetMonthlyBudget as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("budget row missing"))
      .mockResolvedValueOnce(undefined);

    const step = {
      run: vi.fn().mockImplementation(async (_name: string, fn: () => unknown) => fn()),
      sendEvent: vi.fn(),
    };

    const handler = (einsteinMonthlyBudgetReset as unknown as {
      __handler: (ctx: { step: typeof step }) => Promise<{
        tenantCount: number;
        resetCount: number;
        failures: Array<{ slug: string; error: string }>;
      }>;
    }).__handler;

    const result = await handler({ step });

    expect(result.tenantCount).toBe(3);
    expect(result.resetCount).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].slug).toBe("farm-broken");
    expect(result.failures[0].error).toMatch(/budget row missing/);
  });

  it("short-circuits when there are no tenants", async () => {
    (getAllFarmSlugs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const step = {
      run: vi.fn().mockImplementation(async (_name: string, fn: () => unknown) => fn()),
      sendEvent: vi.fn(),
    };

    const handler = (einsteinMonthlyBudgetReset as unknown as {
      __handler: (ctx: { step: typeof step }) => Promise<{
        tenantCount: number;
        resetCount: number;
        failures: unknown[];
      }>;
    }).__handler;

    const result = await handler({ step });

    expect(resetMonthlyBudget).not.toHaveBeenCalled();
    expect(result).toEqual({ tenantCount: 0, resetCount: 0, failures: [] });
  });
});

describe("ENTITY_TYPES export (keeps entity coverage aligned with Wave 1 schema)", () => {
  it("lists exactly the 7 documented entity types in the corpus spec", () => {
    expect(ENTITY_TYPES).toEqual([
      "observation",
      "camp",
      "animal",
      "task",
      "task_template",
      "notification",
      "it3_snapshot",
    ]);
  });
});

// ── Issue #99: Three-way invalidation (timestamp · chunker version · hash) ───

describe("findStaleEntities — three-way invalidation (issue #99)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Trigger A: camp/animal/task rows use updatedAt (not createdAt) for stale detection", async () => {
    // A camp was created 2026-04-01 but updated 2026-04-20 (after the chunk was
    // written on 2026-04-10). createdAt-based detection would miss this; only
    // updatedAt-based detection catches it.
    const campCreatedAt = new Date("2026-04-01T00:00:00Z"); // old — would NOT trigger if we used createdAt
    const campUpdatedAt = new Date("2026-04-20T00:00:00Z"); // newer than chunk — SHOULD trigger
    const chunkSourceAt  = new Date("2026-04-10T00:00:00Z"); // existing chunk was written here

    const prisma = makeEinsteinPrisma({
      camp: {
        findMany: vi.fn().mockResolvedValue([
          { id: "camp-1", createdAt: campCreatedAt, updatedAt: campUpdatedAt },
        ]),
      },
      einsteinChunk: {
        findMany: vi.fn().mockResolvedValue([
          { entityId: "camp-1", sourceUpdatedAt: chunkSourceAt, chunkerVersion: CURRENT_CHUNKER_VERSION, contentHash: "" },
        ]),
      },
    });

    const stale = await findStaleEntities(prisma, "camp");
    expect(stale.map((s) => s.id)).toContain("camp-1");
  });

  it("Trigger B: chunker version mismatch forces re-index regardless of timestamps", async () => {
    // The source row has NOT changed (updatedAt === chunk.sourceUpdatedAt), but
    // the chunker was bumped to a newer version — stale chunk must be replaced.
    const sharedDate = new Date("2026-04-10T00:00:00Z");

    const prisma = makeEinsteinPrisma({
      animal: {
        findMany: vi.fn().mockResolvedValue([
          { id: "animal-1", updatedAt: sharedDate },
        ]),
      },
      camp: { findMany: vi.fn().mockResolvedValue([]) },
      einsteinChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityId: "animal-1",
            sourceUpdatedAt: sharedDate,           // same — timestamp NOT stale
            chunkerVersion: "old-version",          // MISMATCH vs CURRENT_CHUNKER_VERSION
            contentHash: "",
          },
        ]),
      },
    });

    const stale = await findStaleEntities(prisma, "animal");
    expect(stale.map((s) => s.id)).toContain("animal-1");
  });

  it("Trigger C: content hash mismatch forces re-index even when timestamps and version match", async () => {
    // All metadata matches, but the stored hash doesn't match sha256(chunk.text).
    // This covers hash-function changes and renderer bugs that produce different
    // text without bumping the chunker version.
    const sharedDate = new Date("2026-04-10T00:00:00Z");
    const chunkText   = "task title: fix fence";
    // Compute what the correct hash *would* be for this text.
    const { createHash } = await import("node:crypto");
    const correctHash = createHash("sha256").update(chunkText, "utf8").digest("hex");
    const wrongHash   = "0000000000000000000000000000000000000000000000000000000000000000";

    expect(wrongHash).not.toBe(correctHash); // sanity

    const prisma = makeEinsteinPrisma({
      task: {
        findMany: vi.fn().mockResolvedValue([
          { id: "task-1", updatedAt: sharedDate },
        ]),
      },
      einsteinChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityId: "task-1",
            sourceUpdatedAt: sharedDate,             // same — timestamp NOT stale
            chunkerVersion: CURRENT_CHUNKER_VERSION, // same — version NOT stale
            contentHash: wrongHash,                  // MISMATCH → MUST re-embed
          },
        ]),
      },
    });

    // Mock chunker to return the known text so we can compute the expected hash.
    (toEmbeddingText as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      makeRenderedChunk("task", "task-1", chunkText, sharedDate),
    ]);

    const stale = await findStaleEntities(prisma, "task");
    expect(stale.map((s) => s.id)).toContain("task-1");
  });

  it("skips rows that are fresh across all three triggers (timestamp + version + hash all match)", async () => {
    const sharedDate  = new Date("2026-04-10T00:00:00Z");
    const chunkText   = "notification: rain alert";
    const { createHash } = await import("node:crypto");
    const correctHash = createHash("sha256").update(chunkText, "utf8").digest("hex");

    const prisma = makeEinsteinPrisma({
      notification: {
        findMany: vi.fn().mockResolvedValue([
          { id: "notif-1", updatedAt: sharedDate },
        ]),
      },
      einsteinChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityId: "notif-1",
            sourceUpdatedAt: sharedDate,             // same — timestamp fresh
            chunkerVersion: CURRENT_CHUNKER_VERSION, // same — version fresh
            contentHash: correctHash,                // same — hash fresh
          },
        ]),
      },
    });

    (toEmbeddingText as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      makeRenderedChunk("notification", "notif-1", chunkText, sharedDate),
    ]);

    const stale = await findStaleEntities(prisma, "notification");
    expect(stale).toHaveLength(0);
  });
});

describe("reindexEinsteinEntity input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid entityType before reaching Prisma", async () => {
    const handler = (reindexEinsteinEntity as unknown as {
      __handler: (ctx: {
        event: { data: unknown };
        step: { run: <T>(n: string, f: () => Promise<T>) => Promise<T> };
      }) => Promise<unknown>;
    }).__handler;

    await expect(
      handler({
        event: { data: { farmSlug: "farm-alpha", entityType: "not_a_type", entityId: "x" } },
        step: { run: async (_n, f) => f() },
      }),
    ).rejects.toThrow(/unknown entityType/);
  });

  it("rejects missing payload fields loudly", async () => {
    const handler = (reindexEinsteinEntity as unknown as {
      __handler: (ctx: {
        event: { data: unknown };
        step: { run: <T>(n: string, f: () => Promise<T>) => Promise<T> };
      }) => Promise<unknown>;
    }).__handler;

    await expect(
      handler({
        event: { data: { farmSlug: "", entityType: "observation", entityId: "x" } },
        step: { run: async (_n, f) => f() },
      }),
    ).rejects.toThrow(/invalid payload/);
  });
});
