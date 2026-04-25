// lib/server/inngest/einstein.ts — Phase L Wave 2C: Farm Einstein reindex engine.
//
// Four Inngest functions:
//
//   1. einsteinDailyReindex (cron fan-out)
//      Walks every tenant and emits one `einstein/reindex.tenant` event per slug.
//      Fires at 02:30 SAST — staggered 30 min after Phase K's task cron at 02:00
//      so we don't all hammer libsql at once.
//
//   2. reindexEinsteinTenant (per-tenant worker)
//      Scoops up all stale (or missing) chunks across 7 entity types, embeds them
//      in a single batched call, and upserts the results into `EinsteinChunk`.
//      Listens: `einstein/reindex.tenant`.
//
//   3. reindexEinsteinEntity (event-driven fast path)
//      Same worker as (2), scoped to a single entity. Used when a mutation handler
//      wants immediate re-embed of one observation/camp/task. Not hooked from any
//      route yet — we just register the function so 2D/future waves can fire events.
//      Listens: `einstein/reindex.entity`.
//
//   4. einsteinMonthlyBudgetReset (monthly cron)
//      Fires at midnight on the 1st of each month (SAST). Walks every tenant and
//      calls `resetMonthlyBudget(slug)` from the 2B budget module.
//
// Pattern reuse (see Phase J/K for precedent):
//   - Fan-out: mirrors dailyAlertFanout in lib/server/inngest/functions.ts:26-43.
//   - concurrency.limit: 5  — Inngest free-plan hard cap. Phase K lesson
//     memory/feedback-build-not-just-test.md §plan-limits.
//   - P2002 retry on upsert: lib/server/alerts/dedup.ts:28-34, 213-253.
//   - Mark-before-send / step-isolated external call: lib/server/alerts/dispatch.ts.
//   - Tenant Prisma helper: getPrismaForFarm from lib/farm-prisma.ts.
//   - Timezone on cron: "TZ=Africa/Johannesburg ..." per Phase K pattern.
//
// Guardrails (Phase L Wave 2C brief):
//   - NO module-load env reads. The Inngest constructor is env-safe; `embed()`
//     from 2A handles its own OPENAI_API_KEY read lazily.
//   - We import the shared inngest client — we do NOT instantiate a new one.
//   - Free-plan concurrency.limit: 5 is non-negotiable. Exceeding it fails
//     `inngest serve` sync at deploy time.
//   - Per-tenant rateLimit on the worker prevents runaway reindex when many
//     fast-path events queue up in a short window.

import type { PrismaClient } from "@prisma/client";
import { inngest } from "./client";
import { getAllFarmSlugs } from "@/lib/meta-db";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import {
  toEmbeddingText,
  type RenderedChunk,
  type EntityType,
} from "@/lib/einstein/chunker";
import { embed, embeddingToBytes } from "@/lib/einstein/embeddings";
import { resetMonthlyBudget } from "@/lib/einstein/budget";

// ── Event / trigger constants ───────────────────────────────────────────────

const TENANT_EVENT_REINDEX = "einstein/reindex.tenant";
const ENTITY_EVENT_REINDEX = "einstein/reindex.entity";

/** Concurrency cap — Inngest free-plan ceiling. DO NOT RAISE without upgrading
 *  the plan first. Phase K (`dd83312`) burned a deploy chain on this. */
const FREE_PLAN_CONCURRENCY_LIMIT = 5;

/** The 7 entity types Einstein embeds. Order matches the corpus spec in
 *  research-phase-l-farm-einstein.md. Kept in a const array so a missing
 *  switch-case surfaces as a type error rather than a silent gap. */
export const ENTITY_TYPES: readonly EntityType[] = [
  "observation",
  "camp",
  "animal",
  "task",
  "task_template",
  "notification",
  "it3_snapshot",
] as const;

// ── P2002 guard (copied from dedup.ts:28-34 — keeps this module free of a
// runtime Prisma type import so the test fixtures stay cheap). ──────────────

function isP2002(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

// ── Public result shapes ────────────────────────────────────────────────────

export interface TenantReindexResult {
  slug: string;
  embedded: number;
  tokensUsed: number;
  costZar: number;
  durationMs: number;
}

export interface EntityReindexResult {
  slug: string;
  entityType: EntityType;
  entityId: string;
  embedded: number;
  tokensUsed: number;
  costZar: number;
  durationMs: number;
}

// ── Fan-out: einsteinDailyReindex ───────────────────────────────────────────

/**
 * Daily cron fan-out. Pure dispatch — all work happens on per-tenant events so
 * a single slow tenant doesn't block the others. Mirrors dailyAlertFanout.
 */
export const einsteinDailyReindex = inngest.createFunction(
  {
    id: "einstein-daily-reindex",
    triggers: [{ cron: "TZ=Africa/Johannesburg 30 2 * * *" }],
  },
  async ({ step }) => {
    const slugs = await step.run("load-tenants", () => getAllFarmSlugs());
    if (slugs.length === 0) return { tenantCount: 0 };
    await step.sendEvent(
      "fan-out",
      slugs.map((slug: string) => ({
        name: TENANT_EVENT_REINDEX,
        data: { farmSlug: slug },
      })),
    );
    return { tenantCount: slugs.length };
  },
);

// ── Per-tenant worker: reindexEinsteinTenant ────────────────────────────────

export const reindexEinsteinTenant = inngest.createFunction(
  {
    id: "reindex-einstein-tenant",
    retries: 3,
    concurrency: { limit: FREE_PLAN_CONCURRENCY_LIMIT },
    // A single tenant can only reindex once per 5-minute window. Prevents
    // runaway fast-path events from flooding OpenAI. The daily cron still
    // fires reliably because the rateLimit key is per-tenant and the last
    // burst was ~24 h ago.
    rateLimit: { limit: 1, period: "5m", key: "event.data.farmSlug" },
    triggers: [{ event: TENANT_EVENT_REINDEX }],
  },
  async ({ event, step }) => {
    const { farmSlug } = event.data as { farmSlug: string };
    if (!farmSlug || typeof farmSlug !== "string") {
      throw new Error(`reindex-einstein-tenant: invalid farmSlug payload`);
    }

    return step.run(`reindex-${farmSlug}`, async () => {
      const prisma = (await getPrismaForFarm(farmSlug)) as PrismaClient | null;
      if (!prisma) {
        // Loud failure per memory/silent-failure-pattern.md §4d.
        throw new Error(`No farm credentials for tenant "${farmSlug}"`);
      }
      return reindexForTenant(prisma, farmSlug);
    });
  },
);

// ── Event-driven fast path: reindexEinsteinEntity ───────────────────────────

export const reindexEinsteinEntity = inngest.createFunction(
  {
    id: "reindex-einstein-entity",
    retries: 3,
    concurrency: { limit: FREE_PLAN_CONCURRENCY_LIMIT },
    triggers: [{ event: ENTITY_EVENT_REINDEX }],
  },
  async ({ event, step }) => {
    const { farmSlug, entityType, entityId } = event.data as {
      farmSlug: string;
      entityType: EntityType;
      entityId: string;
    };
    if (!farmSlug || !entityType || !entityId) {
      throw new Error(
        `reindex-einstein-entity: invalid payload ${JSON.stringify(event.data)}`,
      );
    }
    if (!ENTITY_TYPES.includes(entityType)) {
      throw new Error(
        `reindex-einstein-entity: unknown entityType "${entityType}"`,
      );
    }

    return step.run(`reindex-${farmSlug}-${entityType}-${entityId}`, async () => {
      const prisma = (await getPrismaForFarm(farmSlug)) as PrismaClient | null;
      if (!prisma) {
        throw new Error(`No farm credentials for tenant "${farmSlug}"`);
      }
      return reindexForEntity(prisma, farmSlug, entityType, entityId);
    });
  },
);

// ── Monthly budget reset ────────────────────────────────────────────────────

export const einsteinMonthlyBudgetReset = inngest.createFunction(
  {
    id: "einstein-monthly-budget-reset",
    concurrency: { limit: FREE_PLAN_CONCURRENCY_LIMIT },
    // 00:00 on the 1st of each month, Africa/Johannesburg.
    triggers: [{ cron: "TZ=Africa/Johannesburg 0 0 1 * *" }],
  },
  async ({ step }) => {
    const slugs = await step.run("load-tenants", () => getAllFarmSlugs());
    if (slugs.length === 0) return { tenantCount: 0, resetCount: 0, failures: [] };

    let resetCount = 0;
    const failures: Array<{ slug: string; error: string }> = [];

    // Tolerate individual failures — one tenant's broken budget row shouldn't
    // block the other 99 from getting their monthly reset. Each reset runs
    // inside its own step.run so Inngest retries per-slug, not for the whole
    // cron firing.
    for (const slug of slugs) {
      try {
        await step.run(`reset-${slug}`, () => resetMonthlyBudget(slug));
        resetCount++;
      } catch (err) {
        failures.push({
          slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { tenantCount: slugs.length, resetCount, failures };
  },
);

// ── Core logic (testable, Prisma-mockable) ──────────────────────────────────

/**
 * Per-entity-type Prisma query. Returns rows whose chunk is missing OR
 * whose source `updatedAt` is newer than the existing chunk's
 * `sourceUpdatedAt`. We do this with a LEFT JOIN-style findMany + in-memory
 * filter: Prisma doesn't expose relational LEFT JOIN, so we:
 *   1. Load the entity rows (bounded — tenants are small).
 *   2. Load all existing chunks for that entityType keyed by entityId.
 *   3. Filter in JS: keep rows where no chunk exists OR row.updatedAt >
 *      chunk.sourceUpdatedAt.
 *
 * Returns the subset of source rows that need re-embedding.
 */
export async function findStaleEntities(
  prisma: PrismaClient,
  entityType: EntityType,
): Promise<Array<{ id: string; updatedAt: Date; row: unknown }>> {
  // Load the source rows — each entity type lives on its own Prisma model.
  // We carry the full row so `toEmbeddingText` can render without a second
  // round-trip.
  let sourceRows: Array<{ id: string; updatedAt: Date; row: unknown }> = [];
  switch (entityType) {
    // Per-entity timestamp mapping — FarmTrack's Prisma schema doesn't use a
    // uniform `updatedAt` column. Pick the field that represents "last
    // change" per the actual model shape, falling back to `createdAt` when a
    // change-timestamp doesn't exist. `sourceUpdatedAt` is what drives stale
    // detection via `row.updatedAt > chunk.sourceUpdatedAt`, so we want the
    // most-recently-mutated timestamp available per entity.
    case "observation": {
      // Denormalise animal identity + camp name so the chunker renders
      // "animal 'Bella' (Cattle, Angus, camp 'North Pasture')" instead of
      // bare IDs. See chunker comment on Wave 2A field-mismatch postmortem.
      const [rows, animals, camps] = await Promise.all([
        prisma.observation.findMany({}),
        // cross-species by design: RAG embeddings cover every animal entity.
        prisma.animal.findMany({
          select: { animalId: true, name: true, species: true, breed: true },
        }),
        prisma.camp.findMany({ select: { campId: true, campName: true } }),
      ]);
      const animalById = new Map(animals.map((a) => [a.animalId, a]));
      const campById = new Map(camps.map((c) => [c.campId, c.campName]));
      sourceRows = rows.map((r) => {
        const a = r.animalId ? animalById.get(r.animalId) : undefined;
        const enriched = {
          ...r,
          animalName: a?.name ?? undefined,
          species: a?.species ?? undefined,
          breed: a?.breed ?? undefined,
          campName: campById.get(r.campId) ?? undefined,
        };
        return { id: r.id, updatedAt: r.editedAt ?? r.createdAt, row: enriched };
      });
      break;
    }
    case "camp": {
      const rows = await prisma.camp.findMany({});
      sourceRows = rows.map((r) => ({ id: r.id, updatedAt: r.createdAt, row: r }));
      break;
    }
    case "animal": {
      // Denormalise current-camp name for readable chunk text.
      // cross-species by design: RAG embeddings cover every animal.
      const [rows, camps] = await Promise.all([
        prisma.animal.findMany({}),
        prisma.camp.findMany({ select: { campId: true, campName: true } }),
      ]);
      const campById = new Map(camps.map((c) => [c.campId, c.campName]));
      sourceRows = rows.map((r) => ({
        id: r.id,
        updatedAt: r.createdAt,
        row: { ...r, currentCampName: campById.get(r.currentCamp) ?? undefined },
      }));
      break;
    }
    case "task": {
      const rows = await prisma.task.findMany({});
      sourceRows = rows.map((r) => ({ id: r.id, updatedAt: r.createdAt, row: r }));
      break;
    }
    case "task_template": {
      const rows = await prisma.taskTemplate.findMany({});
      sourceRows = rows.map((r) => ({ id: r.id, updatedAt: r.updatedAt, row: r }));
      break;
    }
    case "notification": {
      const rows = await prisma.notification.findMany({});
      sourceRows = rows.map((r) => ({ id: r.id, updatedAt: r.updatedAt, row: r }));
      break;
    }
    case "it3_snapshot": {
      const rows = await prisma.it3Snapshot.findMany({});
      sourceRows = rows.map((r) => ({ id: r.id, updatedAt: r.issuedAt, row: r }));
      break;
    }
  }

  if (sourceRows.length === 0) return [];

  // Load existing chunks for these entity ids. We load ALL langTags (en + af
  // future) because the chunker may render both — stale detection uses the
  // minimum sourceUpdatedAt across langTags so we don't miss a dual-embed
  // update. If the chunker returns both en+af and only `en` is older, we
  // still re-embed (cheap); the upsert on (entityType, entityId, langTag)
  // scopes writes correctly.
  const existingChunks = await prisma.einsteinChunk.findMany({
    where: {
      entityType,
      entityId: { in: sourceRows.map((r) => r.id) },
    },
    select: { entityId: true, sourceUpdatedAt: true },
  });
  const minChunkAtByEntity = new Map<string, Date>();
  for (const chunk of existingChunks) {
    const prev = minChunkAtByEntity.get(chunk.entityId);
    if (!prev || chunk.sourceUpdatedAt.getTime() < prev.getTime()) {
      minChunkAtByEntity.set(chunk.entityId, chunk.sourceUpdatedAt);
    }
  }

  return sourceRows.filter((r) => {
    const chunkAt = minChunkAtByEntity.get(r.id);
    if (!chunkAt) return true; // no chunk → embed
    return r.updatedAt.getTime() > chunkAt.getTime(); // source newer → re-embed
  });
}

/**
 * Render one entity-type's stale rows to RenderedChunks via 2A's
 * `toEmbeddingText`. The chunker is synchronous and returns an array (it may
 * produce 1-2 chunks per row for future Afrikaans dual embedding). Empty
 * outputs from the chunker are dropped silently.
 */
export async function renderChunksForType(
  prisma: PrismaClient,
  entityType: EntityType,
): Promise<RenderedChunk[]> {
  const stale = await findStaleEntities(prisma, entityType);
  const chunks: RenderedChunk[] = [];
  for (const { id, row } of stale) {
    const rendered = toEmbeddingText({ entityType, entityId: id, row });
    if (Array.isArray(rendered)) {
      for (const c of rendered) chunks.push(c);
    }
  }
  return chunks;
}

/**
 * Upsert a RenderedChunk + embedding vector into EinsteinChunk. P2002 on the
 * composite unique (entityType, entityId, langTag) means a concurrent worker
 * (e.g. the fast-path event) beat us to the row — re-fetch and update instead
 * of crashing the whole step. Mirrors dedup.ts:213-253.
 *
 * Returns true if the row was written, false if P2002 couldn't be recovered.
 */
async function upsertChunk(
  prisma: PrismaClient,
  chunk: RenderedChunk,
  vector: Float32Array,
  tokensUsedForChunk: number,
  modelId: string,
): Promise<void> {
  const bytes = embeddingToBytes(vector);
  try {
    await prisma.einsteinChunk.upsert({
      where: {
        einstein_chunk_entity_lang: {
          entityType: chunk.entityType,
          entityId: chunk.entityId,
          langTag: chunk.langTag,
        },
      },
      create: {
        entityType: chunk.entityType,
        entityId: chunk.entityId,
        langTag: chunk.langTag,
        text: chunk.text,
        embedding: bytes,
        tokensUsed: tokensUsedForChunk,
        modelId,
        sourceUpdatedAt: chunk.sourceUpdatedAt,
      },
      update: {
        text: chunk.text,
        embedding: bytes,
        tokensUsed: tokensUsedForChunk,
        modelId,
        sourceUpdatedAt: chunk.sourceUpdatedAt,
      },
    });
  } catch (err) {
    if (!isP2002(err)) throw err;
    // Concurrent writer landed the row between our upsert's SELECT and
    // INSERT. Find it and merge — we're the newer writer so our
    // sourceUpdatedAt wins.
    const winner = await prisma.einsteinChunk.findFirst({
      where: {
        entityType: chunk.entityType,
        entityId: chunk.entityId,
        langTag: chunk.langTag,
      },
    });
    if (!winner) throw err;
    await prisma.einsteinChunk.update({
      where: { id: winner.id },
      data: {
        text: chunk.text,
        embedding: bytes,
        tokensUsed: tokensUsedForChunk,
        modelId,
        sourceUpdatedAt: chunk.sourceUpdatedAt,
      },
    });
  }
}

/**
 * Reindex one full tenant. Loads stale rows across all 7 entity types,
 * batches them into a single `embed()` call (2A does its own 2048-row
 * splitting), and upserts each embedded chunk. Returns summary metrics.
 */
export async function reindexForTenant(
  prisma: PrismaClient,
  slug: string,
): Promise<TenantReindexResult> {
  const start = Date.now();

  // Gather stale chunks across all 7 entity types. Sequential iteration is
  // fine — Inngest's step.run already isolates per-tenant concurrency.
  const allChunks: RenderedChunk[] = [];
  for (const entityType of ENTITY_TYPES) {
    const chunks = await renderChunksForType(prisma, entityType);
    allChunks.push(...chunks);
  }

  if (allChunks.length === 0) {
    return {
      slug,
      embedded: 0,
      tokensUsed: 0,
      costZar: 0,
      durationMs: Date.now() - start,
    };
  }

  // Single batched embed call. 2A splits into 2048-row batches internally
  // and preserves order. Order preservation is critical — vectors[i] maps
  // back to allChunks[i].
  const texts = allChunks.map((c) => c.text);
  const { vectors, modelId, usage } = await embed(texts);

  if (vectors.length !== allChunks.length) {
    throw new Error(
      `embed() returned ${vectors.length} vectors for ${allChunks.length} chunks — order cannot be preserved`,
    );
  }

  // Amortise per-chunk token usage evenly across chunks. The 2A API returns
  // aggregate usage, not per-row usage, so we report the average.
  const perChunkTokens = Math.max(
    1,
    Math.round(usage.promptTokens / allChunks.length),
  );

  let embedded = 0;
  for (let i = 0; i < allChunks.length; i++) {
    await upsertChunk(prisma, allChunks[i], vectors[i], perChunkTokens, modelId);
    embedded++;
  }

  return {
    slug,
    embedded,
    tokensUsed: usage.promptTokens,
    costZar: usage.costZar,
    durationMs: Date.now() - start,
  };
}

/**
 * Reindex a single entity. Fast-path counterpart to `reindexForTenant` — same
 * upsert pipeline, scoped to one (entityType, entityId).
 */
export async function reindexForEntity(
  prisma: PrismaClient,
  slug: string,
  entityType: EntityType,
  entityId: string,
): Promise<EntityReindexResult> {
  const start = Date.now();

  // Load the single source row via the right Prisma model.
  let sourceRow: { id: string; updatedAt: Date; row: unknown } | null = null;
  switch (entityType) {
    // Mirror the per-entity timestamp mapping from findStaleEntities() above.
    case "observation": {
      const r = await prisma.observation.findUnique({ where: { id: entityId } });
      if (r) {
        // Resolve animal + camp name for readable chunk text (matches batch path).
        const [animal, camp] = await Promise.all([
          r.animalId
            ? prisma.animal.findUnique({
                where: { animalId: r.animalId },
                select: { name: true, species: true, breed: true },
              })
            : Promise.resolve(null),
          prisma.camp.findUnique({
            where: { campId: r.campId },
            select: { campName: true },
          }),
        ]);
        const enriched = {
          ...r,
          animalName: animal?.name ?? undefined,
          species: animal?.species ?? undefined,
          breed: animal?.breed ?? undefined,
          campName: camp?.campName ?? undefined,
        };
        sourceRow = { id: r.id, updatedAt: r.editedAt ?? r.createdAt, row: enriched };
      }
      break;
    }
    case "camp": {
      const r = await prisma.camp.findUnique({ where: { id: entityId } });
      if (r) sourceRow = { id: r.id, updatedAt: r.createdAt, row: r };
      break;
    }
    case "animal": {
      const r = await prisma.animal.findUnique({ where: { id: entityId } });
      if (r) {
        const camp = await prisma.camp.findUnique({
          where: { campId: r.currentCamp },
          select: { campName: true },
        });
        const enriched = { ...r, currentCampName: camp?.campName ?? undefined };
        sourceRow = { id: r.id, updatedAt: r.createdAt, row: enriched };
      }
      break;
    }
    case "task": {
      const r = await prisma.task.findUnique({ where: { id: entityId } });
      if (r) sourceRow = { id: r.id, updatedAt: r.createdAt, row: r };
      break;
    }
    case "task_template": {
      const r = await prisma.taskTemplate.findUnique({ where: { id: entityId } });
      if (r) sourceRow = { id: r.id, updatedAt: r.updatedAt, row: r };
      break;
    }
    case "notification": {
      const r = await prisma.notification.findUnique({ where: { id: entityId } });
      if (r) sourceRow = { id: r.id, updatedAt: r.updatedAt, row: r };
      break;
    }
    case "it3_snapshot": {
      const r = await prisma.it3Snapshot.findUnique({ where: { id: entityId } });
      if (r) sourceRow = { id: r.id, updatedAt: r.issuedAt, row: r };
      break;
    }
  }

  if (!sourceRow) {
    // Entity was deleted between the event firing and our pickup — normal
    // (e.g. observation created + deleted in quick succession). Return zero
    // embeds rather than throwing so the Inngest retry budget isn't consumed.
    return {
      slug,
      entityType,
      entityId,
      embedded: 0,
      tokensUsed: 0,
      costZar: 0,
      durationMs: Date.now() - start,
    };
  }

  const rendered = toEmbeddingText({
    entityType,
    entityId: sourceRow.id,
    row: sourceRow.row,
  });
  if (!Array.isArray(rendered) || rendered.length === 0) {
    // No meaningful text (e.g. empty observation). Skip silently.
    return {
      slug,
      entityType,
      entityId,
      embedded: 0,
      tokensUsed: 0,
      costZar: 0,
      durationMs: Date.now() - start,
    };
  }

  const { vectors, modelId, usage } = await embed(rendered.map((r) => r.text));
  if (vectors.length !== rendered.length) {
    throw new Error(
      `embed() returned ${vectors.length} vectors for ${rendered.length} chunks`,
    );
  }

  const perChunkTokens = Math.max(
    1,
    Math.round(usage.promptTokens / rendered.length),
  );

  for (let i = 0; i < rendered.length; i++) {
    await upsertChunk(prisma, rendered[i], vectors[i], perChunkTokens, modelId);
  }

  return {
    slug,
    entityType,
    entityId,
    embedded: rendered.length,
    tokensUsed: usage.promptTokens,
    costZar: usage.costZar,
    durationMs: Date.now() - start,
  };
}

// ── Registration surface ────────────────────────────────────────────────────

export const ALL_EINSTEIN_FUNCTIONS = [
  einsteinDailyReindex,
  reindexEinsteinTenant,
  reindexEinsteinEntity,
  einsteinMonthlyBudgetReset,
];
