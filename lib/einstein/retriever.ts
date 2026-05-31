/**
 * lib/einstein/retriever.ts — Phase L Wave 2B semantic + structured retrieval.
 *
 * Semantic path:
 *   1. Embed the query via @/lib/einstein/embeddings (Wave 2A).
 *   2. $queryRawUnsafe with libSQL's vector_distance_cos() against EinsteinChunk.
 *   3. Return top-K with score = 1 - cosine_distance.
 *
 * Structured path:
 *   Dispatch typed Prisma queries based on the plan's entityTypeFilter +
 *   dateRangeFilter. Returns synthetic RetrievalResult rows so the answer
 *   LLM still has "citations" to ground its count/aggregation answer on.
 *
 * Multi-tenancy: farmSlug → getPrismaForFarm (per-tenant client cache).
 *
 * Vector SQL shape (Wave 4 DDL declares embedding as F32_BLOB(1536)):
 *   SELECT id, entityType, entityId, text, sourceUpdatedAt,
 *          vector_distance_cos(embedding, vector32(?)) AS distance
 *   FROM EinsteinChunk
 *   [WHERE entityType IN (...)]
 *   [AND sourceUpdatedAt BETWEEN ? AND ?]
 *   ORDER BY distance ASC
 *   LIMIT ?
 */

import { getPrismaForFarm } from '@/lib/farm-prisma';
import { embed, embeddingToBytes } from '@/lib/einstein/embeddings';
import { crossSpecies } from '@/lib/server/species-scoped-prisma';
import { RETRIEVAL_TOP_K } from './defaults';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EinsteinEntityType =
  | 'observation'
  | 'camp'
  | 'animal'
  | 'task'
  | 'task_template'
  | 'notification'
  | 'it3_snapshot';

export interface Citation {
  entityType: EinsteinEntityType;
  entityId: string;
  quote: string;
  relevance: 'direct' | 'supporting' | 'contextual';
}

export interface RetrievalChunk {
  entityType: EinsteinEntityType;
  entityId: string;
  text: string;
  score: number; // cosine similarity 0..1 (1 = identical)
  sourceUpdatedAt: Date;
}

export interface RetrievalResult {
  chunks: RetrievalChunk[];
  latencyMs: number;
}

export interface RetrieveOptions {
  topK?: number;
  entityTypeFilter?: EinsteinEntityType[];
  dateRangeFilter?: { start?: Date; end?: Date };
}

export interface StructuredQueryPlan {
  rewrittenQuery: string;
  entityTypeFilter?: EinsteinEntityType[];
  dateRangeFilter?: { start?: Date; end?: Date };
  isStructuredQuery: boolean;
}

// ── Typed errors ──────────────────────────────────────────────────────────────

export type RetrieverErrorCode =
  | 'RETRIEVER_FARM_NOT_FOUND'
  | 'RETRIEVER_EMBED_FAILED'
  | 'RETRIEVER_QUERY_FAILED';

export class RetrieverError extends Error {
  readonly code: RetrieverErrorCode;
  constructor(code: RetrieverErrorCode, message: string) {
    super(message);
    this.name = 'RetrieverError';
    this.code = code;
  }
}

// ── Allowed entity types (whitelist to prevent SQL injection via filter) ─────

const ALLOWED_ENTITY_TYPES: ReadonlySet<EinsteinEntityType> = new Set([
  'observation',
  'camp',
  'animal',
  'task',
  'task_template',
  'notification',
  'it3_snapshot',
]);

function sanitizeEntityFilter(
  filter: EinsteinEntityType[] | undefined,
): EinsteinEntityType[] | undefined {
  if (!filter || filter.length === 0) return undefined;
  const clean = filter.filter((t) => ALLOWED_ENTITY_TYPES.has(t));
  return clean.length === 0 ? undefined : clean;
}

// ── Row shape returned by $queryRawUnsafe ─────────────────────────────────────

interface RawVectorRow {
  id: string;
  entityType: string;
  entityId: string;
  text: string;
  sourceUpdatedAt: string | Date;
  distance: number;
}

function normaliseDate(raw: string | Date): Date {
  if (raw instanceof Date) return raw;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

// ── Semantic retrieval ────────────────────────────────────────────────────────

async function semantic(
  farmSlug: string,
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const started = Date.now();

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    throw new RetrieverError(
      'RETRIEVER_FARM_NOT_FOUND',
      `Tenant DB for ${farmSlug} not reachable`,
    );
  }

  // Embed the user query. If 2A throws we rewrap into a typed RetrieverError
  // so the upstream route always has a code to log.
  let queryEmbedding: Float32Array;
  try {
    const embedResult = await embed([query]);
    queryEmbedding = embedResult.vectors[0];
    if (!queryEmbedding) {
      throw new RetrieverError(
        'RETRIEVER_EMBED_FAILED',
        'embed() returned empty embedding array',
      );
    }
  } catch (err) {
    if (err instanceof RetrieverError) throw err;
    throw new RetrieverError(
      'RETRIEVER_EMBED_FAILED',
      err instanceof Error ? err.message : 'embed() failed',
    );
  }

  const topK = Math.max(1, Math.min(opts.topK ?? RETRIEVAL_TOP_K, 50));
  const entityFilter = sanitizeEntityFilter(opts.entityTypeFilter);
  const dateStart = opts.dateRangeFilter?.start;
  const dateEnd = opts.dateRangeFilter?.end;

  // Build WHERE fragments. Entity types come from a whitelist (no raw
  // user input in SQL), dates flow in as parameterised args.
  const whereParts: string[] = [];
  const args: unknown[] = [embeddingToBytes(queryEmbedding)];

  if (entityFilter) {
    const placeholders = entityFilter.map(() => '?').join(', ');
    whereParts.push(`entityType IN (${placeholders})`);
    args.push(...entityFilter);
  }
  if (dateStart) {
    whereParts.push(`sourceUpdatedAt >= ?`);
    args.push(dateStart.toISOString());
  }
  if (dateEnd) {
    whereParts.push(`sourceUpdatedAt <= ?`);
    args.push(dateEnd.toISOString());
  }
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  args.push(topK);

  const sql = `
    SELECT id, entityType, entityId, text, sourceUpdatedAt,
           vector_distance_cos(embedding, vector32(?)) AS distance
    FROM EinsteinChunk
    ${whereClause}
    ORDER BY distance ASC
    LIMIT ?
  `.trim();

  let rows: RawVectorRow[];
  try {
    rows = await prisma.$queryRawUnsafe<RawVectorRow[]>(sql, ...args);
  } catch (err) {
    throw new RetrieverError(
      'RETRIEVER_QUERY_FAILED',
      err instanceof Error ? err.message : 'vector query failed',
    );
  }

  const chunks: RetrievalChunk[] = rows.map((row) => ({
    entityType: row.entityType as EinsteinEntityType,
    entityId: row.entityId,
    text: row.text,
    score: clampScore(1 - Number(row.distance)),
    sourceUpdatedAt: normaliseDate(row.sourceUpdatedAt),
  }));

  return {
    chunks,
    latencyMs: Date.now() - started,
  };
}

function clampScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * Human-readable " between <start> and <now>" suffix for aggregate chunk
 * text. Returns '' when no date range is set. Shared by the observation,
 * task, and notification structured handlers so the citation phrasing
 * stays identical across entity types.
 */
function labelFor(dateStart?: Date, dateEnd?: Date): string {
  if (!dateStart && !dateEnd) return '';
  return ` between ${dateStart?.toISOString().slice(0, 10) ?? 'start'} and ${
    dateEnd?.toISOString().slice(0, 10) ?? 'now'
  }`;
}

// ── Structured retrieval ──────────────────────────────────────────────────────

/**
 * Dispatches typed Prisma queries based on the plan's entity filter.
 * Returns one synthetic chunk per entity type, carrying an aggregate
 * summary string that the answer LLM can cite.
 *
 * Covers the high-signal structured paths:
 *   - "animal" → count by species/status      (crossSpecies door)
 *   - "camp" → count of camps                  (crossSpecies door)
 *   - "observation" → count in date range      (crossSpecies door, observedAt)
 *   - "task" → count in date range             (raw prisma, dueDate axis)
 *   - "notification" → count in date range     (raw prisma, createdAt axis)
 *
 * animal/camp/observation are species-bearing models reached via the
 * crossSpecies() door (ADR-0005). task/notification carry no species axis
 * and are not guarded by that arch test, so they use raw `prisma`, matching
 * the rest of the codebase (lib/server/inngest/einstein.ts ingestion).
 *
 * task_template + it3_snapshot remain deferred (#516) — they fall through
 * to semantic-only retrieval. Unknown entity types fall through to an empty
 * result (caller falls back to semantic retrieval in that case).
 */
async function structured(
  farmSlug: string,
  plan: StructuredQueryPlan,
): Promise<RetrievalResult> {
  const started = Date.now();

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    throw new RetrieverError(
      'RETRIEVER_FARM_NOT_FOUND',
      `Tenant DB for ${farmSlug} not reachable`,
    );
  }

  const filter = sanitizeEntityFilter(plan.entityTypeFilter) ?? [];
  const chunks: RetrievalChunk[] = [];
  const dateStart = plan.dateRangeFilter?.start;
  const dateEnd = plan.dateRangeFilter?.end;

  for (const entityType of filter) {
    try {
      if (entityType === 'animal') {
        // cross-species by design: RAG aggregate covers every animal entity.
        const active = await crossSpecies(prisma, 'einstein-rag').animal.count({ where: { status: 'Active' } });
        const total = await crossSpecies(prisma, 'einstein-rag').animal.count();
        chunks.push({
          entityType: 'animal',
          entityId: 'aggregate:animals',
          text: `Total animals: ${total}. Active: ${active}.`,
          score: 1,
          sourceUpdatedAt: new Date(),
        });
      } else if (entityType === 'camp') {
        const count = await crossSpecies(prisma, 'einstein-rag').camp.count();
        chunks.push({
          entityType: 'camp',
          entityId: 'aggregate:camps',
          text: `Total camps: ${count}.`,
          score: 1,
          sourceUpdatedAt: new Date(),
        });
      } else if (entityType === 'observation') {
        const where: Record<string, unknown> = {};
        if (dateStart || dateEnd) {
          const rangeClause: Record<string, Date> = {};
          if (dateStart) rangeClause.gte = dateStart;
          if (dateEnd) rangeClause.lte = dateEnd;
          where.observedAt = rangeClause;
        }
        const count = await crossSpecies(prisma, 'einstein-rag').observation.count({ where });
        chunks.push({
          entityType: 'observation',
          entityId: 'aggregate:observations',
          text: `Total observations${labelFor(dateStart, dateEnd)}: ${count}.`,
          score: 1,
          sourceUpdatedAt: new Date(),
        });
      } else if (entityType === 'task') {
        // Task is NOT a species-bearing model (no `species` column, not
        // guarded by ADR-0005), so it is reached via raw `prisma.task`,
        // matching the rest of the codebase (lib/server/inngest/einstein.ts,
        // lib/domain/tasks/*). The event axis is `dueDate` ("when the task
        // is relevant"), NOT `createdAt` (the mutation axis). `dueDate` is a
        // String column storing YYYY-MM-DD, so the range bounds must be
        // date-strings — passing a Date would compare against String values
        // and silently match nothing.
        const where: Record<string, unknown> = {};
        if (dateStart || dateEnd) {
          const rangeClause: Record<string, string> = {};
          if (dateStart) rangeClause.gte = dateStart.toISOString().slice(0, 10);
          if (dateEnd) rangeClause.lte = dateEnd.toISOString().slice(0, 10);
          where.dueDate = rangeClause;
        }
        const count = await prisma.task.count({ where });
        chunks.push({
          entityType: 'task',
          entityId: 'aggregate:tasks',
          text: `Total tasks${labelFor(dateStart, dateEnd)}: ${count}.`,
          score: 1,
          sourceUpdatedAt: new Date(),
        });
      } else if (entityType === 'notification') {
        // Notification is likewise non-species-scoped → raw `prisma`. The
        // event axis is `createdAt` (when the notification was raised), a
        // DateTime column, so Date bounds pass through directly.
        const where: Record<string, unknown> = {};
        if (dateStart || dateEnd) {
          const rangeClause: Record<string, Date> = {};
          if (dateStart) rangeClause.gte = dateStart;
          if (dateEnd) rangeClause.lte = dateEnd;
          where.createdAt = rangeClause;
        }
        const count = await prisma.notification.count({ where });
        chunks.push({
          entityType: 'notification',
          entityId: 'aggregate:notifications',
          text: `Total notifications${labelFor(dateStart, dateEnd)}: ${count}.`,
          score: 1,
          sourceUpdatedAt: new Date(),
        });
      }
      // task_template + it3_snapshot remain unhandled (deferred — #516).
      // Unknown entity types → silently skipped. Caller is expected to fall
      // back to semantic if the chunks array ends up empty.
    } catch (err) {
      throw new RetrieverError(
        'RETRIEVER_QUERY_FAILED',
        err instanceof Error ? err.message : `structured query failed for ${entityType}`,
      );
    }
  }

  return {
    chunks,
    latencyMs: Date.now() - started,
  };
}

// ── Public namespace export (per contract) ────────────────────────────────────

export const retrieve = {
  semantic,
  structured,
};
