/**
 * einstein-backfill-embeddings.ts — Phase L Wave 4 one-shot embedding backfill
 *
 * Walks trio-b-boerdery + basson-boerdery and embeds every existing row across
 * the 7 entity types (observation, camp, animal, task, task_template,
 * notification, it3_snapshot) into the EinsteinChunk table that
 * migrate-phase-l-einstein.ts just created.
 *
 * Design note — why this isn't a thin wrapper around `reindexForTenant`:
 *   The Inngest-side `reindexForTenant` runs all 7 entity types + a single
 *   batched embed() + sequential upserts with NO intermediate output. On a
 *   cold-start backfill where Phase J's notification table has tens of
 *   thousands of rows, that pipeline can run for 10+ minutes silently — and
 *   if it hangs, there's no way to tell which stage is stuck.
 *
 *   So this script reimplements the pipeline with per-entity-type progress
 *   logging and a configurable notification cap. It reuses the same helpers
 *   (toEmbeddingText, embed, embeddingToBytes) so semantics match the
 *   Inngest daily cron exactly.
 *
 * Resume support: every entity that already has a chunk (per the unique key
 * entityType + entityId + langTag) is skipped. Re-running after a crash picks
 * up from where it left off — no double-embed, no double-spend.
 *
 * Notification cap: for cold-start backfill only, we limit Notification rows
 * to the most recent N (default 2000) — older alerts aren't useful for RAG
 * and the tail can be tens-of-thousands of rows on active tenants. The daily
 * cron (reindexForTenant) doesn't need this cap because it only ever sees the
 * small daily delta.
 *
 * Cost envelope (per the Wave 4 plan): ~ZAR 5–15 per tenant at
 * text-embedding-3-small rates ($0.02/1M tokens × ZAR 18.5/USD).
 *
 * Preconditions:
 *   1. scripts/migrate-phase-l-einstein.ts must have run.
 *   2. OPENAI_API_KEY must be set in the environment (lazy read inside
 *      lib/einstein/embeddings.ts:77-86). We probe up-front so the script
 *      fails fast rather than embedding tenant 1 then dying on tenant 2.
 *
 * Exits nonzero if ANY tenant fails.
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/einstein-backfill-embeddings.ts
 */

import type { PrismaClient } from '@prisma/client';
import { getFarmCreds } from '../lib/meta-db';
import { getPrismaForFarm } from '../lib/farm-prisma';
import {
  toEmbeddingText,
  type EntityType,
  type RenderedChunk,
} from '../lib/einstein/chunker';
import { embed, embeddingToBytes } from '../lib/einstein/embeddings';

const TARGET_SLUGS: ReadonlyArray<string> = ['trio-b-boerdery', 'basson-boerdery'];

const ENTITY_TYPES: readonly EntityType[] = [
  'observation',
  'camp',
  'animal',
  'task',
  'task_template',
  'notification',
  'it3_snapshot',
] as const;

/** Notification cap — only the most recent N rows get embedded on cold-start. */
const NOTIFICATION_BACKFILL_CAP = 2000;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * True for unique-constraint violations on either Prisma's error code (P2002 —
 * what most Prisma adapters surface) or the raw SQLite code that bubbles up
 * unchanged through `@prisma/adapter-libsql` (`SQLITE_CONSTRAINT` + a UNIQUE
 * constraint message). The latter is specific to libSQL/Turso — don't assume
 * Prisma will translate the underlying driver error on every adapter.
 */
function isUniqueConstraint(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false;
  const code = (err as { code?: string }).code;
  if (code === 'P2002') return true;
  if (code === 'SQLITE_CONSTRAINT') {
    // Differentiate UNIQUE from other SQLite constraint violations so we
    // don't swallow NOT NULL / FK errors.
    return /UNIQUE/i.test(err.message);
  }
  return false;
}

/**
 * Fetch source rows + their change-timestamp for one entity type. Mirrors
 * the per-entity timestamp mapping in lib/server/inngest/einstein.ts:258-299
 * (editedAt ?? createdAt for observations, createdAt for camp/animal/task,
 * updatedAt for task_template/notification, issuedAt for it3_snapshot).
 *
 * Notification is capped to the most recent N rows — see module comment.
 */
async function loadSourceRows(
  prisma: PrismaClient,
  entityType: EntityType,
): Promise<Array<{ id: string; updatedAt: Date; row: unknown }>> {
  switch (entityType) {
    case 'observation': {
      // Denormalise animal identity + camp name so the chunker emits
      // "animal 'Bella' (Cattle, Angus, camp 'North Pasture')" instead of
      // bare IDs. Without this join, retrieval would only match campId /
      // animalId cuid strings — useless for natural-language queries.
      const [rows, animals, camps] = await Promise.all([
        prisma.observation.findMany({}),
        // cross-species by design: backfill embeddings cover every animal.
        prisma.animal.findMany({
          select: { animalId: true, name: true, species: true, breed: true },
        }),
        prisma.camp.findMany({ select: { campId: true, campName: true } }),
      ]);
      const animalById = new Map(animals.map((a) => [a.animalId, a]));
      const campById = new Map(camps.map((c) => [c.campId, c.campName]));
      return rows.map((r) => {
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
    }
    case 'camp': {
      const rows = await prisma.camp.findMany({});
      return rows.map((r) => ({ id: r.id, updatedAt: r.createdAt, row: r }));
    }
    case 'animal': {
      // Denormalise current-camp name so chunk text reads "currently camp
      // 'North Pasture'" instead of "currently camp <campId>".
      // cross-species by design: backfill embeddings cover every animal.
      const [rows, camps] = await Promise.all([
        prisma.animal.findMany({}),
        prisma.camp.findMany({ select: { campId: true, campName: true } }),
      ]);
      const campById = new Map(camps.map((c) => [c.campId, c.campName]));
      return rows.map((r) => {
        const enriched = {
          ...r,
          currentCampName: campById.get(r.currentCamp) ?? undefined,
        };
        return { id: r.id, updatedAt: r.createdAt, row: enriched };
      });
    }
    case 'task': {
      const rows = await prisma.task.findMany({});
      return rows.map((r) => ({ id: r.id, updatedAt: r.createdAt, row: r }));
    }
    case 'task_template': {
      const rows = await prisma.taskTemplate.findMany({});
      return rows.map((r) => ({ id: r.id, updatedAt: r.updatedAt, row: r }));
    }
    case 'notification': {
      const rows = await prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take: NOTIFICATION_BACKFILL_CAP,
      });
      return rows.map((r) => ({ id: r.id, updatedAt: r.updatedAt ?? r.createdAt, row: r }));
    }
    case 'it3_snapshot': {
      const rows = await prisma.it3Snapshot.findMany({});
      return rows.map((r) => ({ id: r.id, updatedAt: r.issuedAt, row: r }));
    }
  }
}

/**
 * Batched writer — splits rows into "new" (no existing chunk) and "stale"
 * (chunk exists but source has updated), then dispatches each set to the
 * fastest available path.
 *
 *   New rows (common on cold-start):
 *     prisma.einsteinChunk.createMany({ data: [...], skipDuplicates: true })
 *     → single `INSERT ... VALUES (...), (...), (...)` per batch.
 *     ONE Turso HTTP round-trip per batch of BATCH_SIZE_NEW rows.
 *
 *   Stale rows (rare on cold-start, common on daily cron):
 *     per-row `update`. Slow (1-2 round-trips per row) but the count is
 *     typically << the new count, so this doesn't dominate runtime.
 *
 *   Measured on basson observations (598 all-new rows):
 *     prior $transaction approach: ~36s per 26 rows  = ~14 min for 598
 *     new createMany approach:     ~0.5s per 100 rows = ~3 s for 598
 *     → ~280x speedup.
 *
 * `skipDuplicates` protects against P2002 races if a concurrent writer landed
 * the row between our existence-check and our INSERT. We don't fall back to
 * update on skip because in a cold-start backfill the data is identical.
 */
async function writeChunksBatched(
  prisma: PrismaClient,
  newRows: Array<{
    chunk: RenderedChunk;
    vector: Float32Array;
    tokensUsedForChunk: number;
    modelId: string;
  }>,
  staleRows: Array<{
    chunk: RenderedChunk;
    vector: Float32Array;
    tokensUsedForChunk: number;
    modelId: string;
  }>,
  batchSizeNew: number = 100,
): Promise<void> {
  // ── New rows: createMany in batches ──────────────────────────────────────
  // NOTE: Prisma's `skipDuplicates: true` is NOT supported on SQLite/libSQL —
  // only on MySQL / Postgres / CockroachDB. We rely on the pre-filter that
  // excluded entityIds already in EinsteinChunk (via chunkAtByEntity). On
  // P2002 from a concurrent writer (e.g. Inngest cron racing with backfill),
  // we fall back to per-row upserts for the whole batch.
  for (let i = 0; i < newRows.length; i += batchSizeNew) {
    const batch = newRows.slice(i, i + batchSizeNew);
    try {
      await prisma.einsteinChunk.createMany({
        data: batch.map(({ chunk, vector, tokensUsedForChunk, modelId }) => ({
          entityType: chunk.entityType,
          entityId: chunk.entityId,
          langTag: chunk.langTag,
          text: chunk.text,
          embedding: embeddingToBytes(vector),
          tokensUsed: tokensUsedForChunk,
          modelId,
          sourceUpdatedAt: chunk.sourceUpdatedAt,
        })),
      });
    } catch (err) {
      if (!isUniqueConstraint(err)) throw err;
      // Concurrent writer raced us on one of the rows in this batch. Upsert
      // each individually — the ones that landed will be no-ops on the update
      // path.
      for (const { chunk, vector, tokensUsedForChunk, modelId } of batch) {
        await upsertChunkSingle(prisma, chunk, vector, tokensUsedForChunk, modelId);
      }
    }
  }

  // ── Stale rows: per-row update with P2002 safety ─────────────────────────
  for (const { chunk, vector, tokensUsedForChunk, modelId } of staleRows) {
    await upsertChunkSingle(prisma, chunk, vector, tokensUsedForChunk, modelId);
  }
}

/** Single-row P2002-safe upsert. Only used for stale rows in cold-start. */
async function upsertChunkSingle(
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
    if (!isUniqueConstraint(err)) throw err;
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
 * Backfill one entity type end-to-end:
 *   load rows → skip those already chunked → render → embed → upsert.
 *
 * Logs start/counts/timing so a hanging stage is visible immediately.
 */
async function backfillEntityType(
  prisma: PrismaClient,
  slug: string,
  entityType: EntityType,
): Promise<{ embedded: number; tokensUsed: number; costZar: number }> {
  const t0 = Date.now();
  process.stdout.write(`    ${entityType.padEnd(14)} loading rows…`);

  const sourceRows = await loadSourceRows(prisma, entityType);
  process.stdout.write(` ${sourceRows.length} row(s) in ${Date.now() - t0}ms\n`);

  if (sourceRows.length === 0) return { embedded: 0, tokensUsed: 0, costZar: 0 };

  // Skip entities that already have chunks (resume support).
  const t1 = Date.now();
  process.stdout.write(`    ${entityType.padEnd(14)} checking existing chunks…`);
  const existing = await prisma.einsteinChunk.findMany({
    where: { entityType, entityId: { in: sourceRows.map((r) => r.id) } },
    select: { entityId: true, sourceUpdatedAt: true },
  });
  const chunkAtByEntity = new Map<string, Date>();
  for (const c of existing) {
    const prev = chunkAtByEntity.get(c.entityId);
    if (!prev || c.sourceUpdatedAt.getTime() < prev.getTime()) {
      chunkAtByEntity.set(c.entityId, c.sourceUpdatedAt);
    }
  }
  const stale = sourceRows.filter((r) => {
    const at = chunkAtByEntity.get(r.id);
    return !at || r.updatedAt.getTime() > at.getTime();
  });
  process.stdout.write(
    ` ${existing.length} existing, ${stale.length} stale/new in ${Date.now() - t1}ms\n`,
  );

  if (stale.length === 0) return { embedded: 0, tokensUsed: 0, costZar: 0 };

  // Render chunks (chunker returns 1 for English-only, 2 for Afrikaans-dual).
  // Tag each chunk with whether its parent entity already has a chunk in
  // EinsteinChunk — drives the new-vs-stale split for the writer.
  const renderedWithFlag: Array<{ chunk: RenderedChunk; hasExisting: boolean }> = [];
  for (const { id, row } of stale) {
    const hasExisting = chunkAtByEntity.has(id);
    const rendered = toEmbeddingText({ entityType, entityId: id, row });
    for (const c of rendered) renderedWithFlag.push({ chunk: c, hasExisting });
  }
  if (renderedWithFlag.length === 0) return { embedded: 0, tokensUsed: 0, costZar: 0 };

  // Embed in one call — 2A batches to 2048 internally and preserves order.
  const t2 = Date.now();
  process.stdout.write(`    ${entityType.padEnd(14)} embedding ${renderedWithFlag.length} chunk(s)…`);
  const { vectors, modelId, usage } = await embed(renderedWithFlag.map((r) => r.chunk.text));
  if (vectors.length !== renderedWithFlag.length) {
    throw new Error(
      `embed() returned ${vectors.length} vectors for ${renderedWithFlag.length} chunks`,
    );
  }
  process.stdout.write(
    ` ${usage.promptTokens} tokens, ZAR ${usage.costZar.toFixed(4)} in ${Date.now() - t2}ms\n`,
  );

  // Split into new (createMany fast path) vs stale (per-row update).
  const perChunkTokens = Math.max(1, Math.round(usage.promptTokens / renderedWithFlag.length));
  const newRows: Parameters<typeof writeChunksBatched>[1] = [];
  const staleRows: Parameters<typeof writeChunksBatched>[1] = [];
  for (let i = 0; i < renderedWithFlag.length; i++) {
    const row = {
      chunk: renderedWithFlag[i].chunk,
      vector: vectors[i],
      tokensUsedForChunk: perChunkTokens,
      modelId,
    };
    if (renderedWithFlag[i].hasExisting) staleRows.push(row);
    else newRows.push(row);
  }

  const t3 = Date.now();
  process.stdout.write(
    `    ${entityType.padEnd(14)} writing ${newRows.length} new via createMany + ` +
      `${staleRows.length} stale via update…`,
  );
  await writeChunksBatched(prisma, newRows, staleRows, 100);
  process.stdout.write(` done in ${Date.now() - t3}ms\n`);

  return {
    embedded: renderedWithFlag.length,
    tokensUsed: usage.promptTokens,
    costZar: usage.costZar,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n-- Phase L Wave 4: Einstein embedding backfill --\n');
  console.log(`Target tenants:  ${TARGET_SLUGS.join(', ')}`);
  console.log(`Entity types:    ${ENTITY_TYPES.join(', ')}`);
  console.log(`Notification cap: ${NOTIFICATION_BACKFILL_CAP} most recent rows per tenant`);

  if (!process.env.OPENAI_API_KEY) {
    console.error('\nFAIL: OPENAI_API_KEY is not set. Add it to .env.local and re-run.');
    process.exit(1);
  }
  console.log(`OpenAI API key:  present (${process.env.OPENAI_API_KEY.slice(0, 8)}…)\n`);

  for (const slug of TARGET_SLUGS) {
    const creds = await getFarmCreds(slug);
    if (!creds) {
      console.error(`FAIL: No Turso credentials for tenant "${slug}".`);
      process.exit(1);
    }
  }

  let totalEmbedded = 0;
  let totalTokens = 0;
  let totalCostZar = 0;
  let failed = 0;

  for (const slug of TARGET_SLUGS) {
    console.log(`\n-- ${slug} --`);
    const tenantStart = Date.now();

    const prisma = (await getPrismaForFarm(slug)) as PrismaClient | null;
    if (!prisma) {
      console.error(`  [${slug}] FAIL: getPrismaForFarm returned null`);
      failed += 1;
      continue;
    }

    let tenantEmbedded = 0;
    let tenantTokens = 0;
    let tenantCostZar = 0;

    for (const entityType of ENTITY_TYPES) {
      try {
        const res = await backfillEntityType(prisma, slug, entityType);
        tenantEmbedded += res.embedded;
        tenantTokens += res.tokensUsed;
        tenantCostZar += res.costZar;
      } catch (err) {
        console.error(`    [${slug}/${entityType}] FAIL:`, err);
        failed += 1;
      }
    }

    totalEmbedded += tenantEmbedded;
    totalTokens += tenantTokens;
    totalCostZar += tenantCostZar;

    console.log(
      `  [${slug}] subtotal — ${tenantEmbedded} chunk(s), ${tenantTokens} tokens, ` +
        `ZAR ${tenantCostZar.toFixed(4)}, ${((Date.now() - tenantStart) / 1000).toFixed(1)}s`,
    );
  }

  console.log('\n-- Totals --');
  console.log(`  embedded:     ${totalEmbedded} chunk(s)`);
  console.log(`  tokens used:  ${totalTokens}`);
  console.log(`  cost:         ZAR ${totalCostZar.toFixed(4)}`);
  console.log(`  failures:     ${failed}`);

  if (failed > 0) {
    console.error(`\n${failed} entity-type backfill(s) failed. Re-run after fixing — idempotent.`);
    process.exit(1);
  }

  console.log('\nDone. Next: set Vercel env vars + run scripts/einstein-eval.ts against preview.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
