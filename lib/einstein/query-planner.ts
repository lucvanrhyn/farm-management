/**
 * lib/einstein/query-planner.ts — Phase L Wave 2B Haiku 4.5 classifier.
 *
 * Given a raw farmer question, decide:
 *   - Is this a structured aggregation question ("how many cows in camp 5")
 *     → isStructuredQuery = true; emit entityTypeFilter (+ dateRangeFilter).
 *   - Is this a free-text question ("what's going wrong with my breeding")
 *     → isStructuredQuery = false; emit rewrittenQuery for better embedding.
 *
 * Lazy-instantiated Anthropic client (mirrors lib/onboarding/adaptive-import.ts
 * getOpenAIClient pattern — constructor validates API key, so we defer until
 * handler time). Typed errors for every branch per the silent-failure cure.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_PLANNER_MODEL } from './defaults';
import type { EinsteinEntityType, StructuredQueryPlan } from './retriever';

// ── Typed errors ──────────────────────────────────────────────────────────────

export type QueryPlannerErrorCode =
  | 'QUERY_PLANNER_NO_KEY'
  | 'QUERY_PLANNER_INVALID_RESPONSE'
  | 'QUERY_PLANNER_API_ERROR';

export class QueryPlannerError extends Error {
  readonly code: QueryPlannerErrorCode;
  readonly rawResponse?: string;
  constructor(code: QueryPlannerErrorCode, message: string, rawResponse?: string) {
    super(message);
    this.name = 'QueryPlannerError';
    this.code = code;
    this.rawResponse = rawResponse;
  }
}

// ── Lazy client ───────────────────────────────────────────────────────────────

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new QueryPlannerError(
      'QUERY_PLANNER_NO_KEY',
      'ANTHROPIC_API_KEY must be set in environment variables',
    );
  }
  return new Anthropic({ apiKey });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_ENTITY_TYPES: ReadonlySet<EinsteinEntityType> = new Set([
  'observation',
  'camp',
  'animal',
  'task',
  'task_template',
  'notification',
  'it3_snapshot',
]);

const PLANNER_SYSTEM_PROMPT = `You are a query classifier for a South African livestock farm AI assistant.

For each user question, emit STRICT JSON (no prose, no markdown fences) matching:
{
  "rewrittenQuery": "<concise restatement for embedding, no pronouns>",
  "isStructuredQuery": <boolean>,
  "entityTypeFilter": [<one or more of "observation", "camp", "animal", "task", "task_template", "notification", "it3_snapshot">],
  "dateRangeFilter": { "start": "<YYYY-MM-DD>", "end": "<YYYY-MM-DD>" }
}

Rules:
- isStructuredQuery=true when the user asks for counts, aggregates, "how many", status summaries.
- isStructuredQuery=false when the user asks open-ended "why/how/what should I" questions.
- entityTypeFilter: include ONLY types relevant. Omit (or use empty array) if the question is unrestricted.
- dateRangeFilter: emit only if the question explicitly names a range ("last week", "March 2026", "since weaning"). Otherwise omit.
- rewrittenQuery: always present, ≤20 words.

Respond with the JSON object ONLY. No leading text, no trailing prose, no \`\`\`json fences.`;

// ── Public API ────────────────────────────────────────────────────────────────

export async function planQuery(question: string): Promise<StructuredQueryPlan> {
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new QueryPlannerError(
      'QUERY_PLANNER_INVALID_RESPONSE',
      'question must be a non-empty string',
    );
  }

  const client = getAnthropicClient();

  let rawText: string;
  try {
    const response = await client.messages.create({
      model: ANTHROPIC_PLANNER_MODEL,
      max_tokens: 400,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
    });
    // Concatenate all text blocks (Haiku normally emits one).
    rawText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  } catch (err) {
    throw new QueryPlannerError(
      'QUERY_PLANNER_API_ERROR',
      err instanceof Error ? err.message : 'Anthropic planner call failed',
    );
  }

  return parsePlannerResponse(rawText, question);
}

// ── Pure helpers (exported for direct unit testing) ──────────────────────────

export function parsePlannerResponse(
  raw: string,
  fallbackQuestion: string,
): StructuredQueryPlan {
  // Strip ```json ... ``` fences if Haiku slipped and wrote them.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    throw new QueryPlannerError(
      'QUERY_PLANNER_INVALID_RESPONSE',
      'Planner did not return valid JSON',
      raw,
    );
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new QueryPlannerError(
      'QUERY_PLANNER_INVALID_RESPONSE',
      'Planner JSON must be an object',
      raw,
    );
  }

  const record = obj as Record<string, unknown>;

  const rewrittenQuery =
    typeof record.rewrittenQuery === 'string' && record.rewrittenQuery.trim().length > 0
      ? record.rewrittenQuery.trim()
      : fallbackQuestion.trim();

  const isStructuredQuery = record.isStructuredQuery === true;

  let entityTypeFilter: EinsteinEntityType[] | undefined;
  if (Array.isArray(record.entityTypeFilter)) {
    const typed = record.entityTypeFilter.filter(
      (t): t is EinsteinEntityType =>
        typeof t === 'string' && ALLOWED_ENTITY_TYPES.has(t as EinsteinEntityType),
    );
    if (typed.length > 0) entityTypeFilter = typed;
  }

  let dateRangeFilter: { start?: Date; end?: Date } | undefined;
  if (
    record.dateRangeFilter &&
    typeof record.dateRangeFilter === 'object' &&
    !Array.isArray(record.dateRangeFilter)
  ) {
    const range = record.dateRangeFilter as Record<string, unknown>;
    const start = typeof range.start === 'string' ? safeDate(range.start) : undefined;
    const end = typeof range.end === 'string' ? safeDate(range.end) : undefined;
    if (start || end) dateRangeFilter = { start, end };
  }

  return {
    rewrittenQuery,
    isStructuredQuery,
    entityTypeFilter,
    dateRangeFilter,
  };
}

function safeDate(s: string): Date | undefined {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
