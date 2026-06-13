/**
 * POST /api/einstein/ask — Phase L Wave 2B Farm Einstein Q&A endpoint.
 *
 * Export discipline: ONLY route handlers + runtime config below. All
 * constants, types, and helpers live in lib/einstein/*.
 * (Phase K lesson: next build enforces this even though tsc doesn't.)
 *
 * Flow:
 *   1. Auth session → 401 if missing.
 *   2. Membership/authz gate (getPrismaForSlugWithAuth) → uniform 403
 *      EINSTEIN_FORBIDDEN for non-members (ein-M1: runs BEFORE any farm
 *      existence/tier probe so non-members cannot enumerate farms).
 *   3. Tier gate (isPaidTier) → 403 EINSTEIN_TIER_LOCKED if basic.
 *   4. assertWithinBudget → 429 EINSTEIN_BUDGET_EXHAUSTED.
 *   4. planQuery → Haiku classifier.
 *   5. retrieve (structured or semantic) based on plan.
 *   6. stampCostBeforeSend (mark-before-send) BEFORE Anthropic streaming call.
 *   7. streamAnswer → SSE frames to client.
 *   8. After stream ends: reconcile budget to REAL reported usage
 *      (api-F1/EIN-2) + persist RagQueryLog row with real tokens/cost
 *      (both best-effort).
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getPrismaForSlugWithAuth } from '@/lib/farm-prisma';
import { getFarmCreds } from '@/lib/meta-db';
import { isPaidTier } from '@/lib/tier';
import { logger } from '@/lib/logger';
import { publicHandler, routeError } from '@/lib/server/route';
import {
  assertWithinBudget,
  stampCostBeforeSend,
  reconcileCostAfterSend,
  EinsteinBudgetError,
} from '@/lib/einstein/budget';
import { planQuery, QueryPlannerError } from '@/lib/einstein/query-planner';
import { retrieve, RetrieverError } from '@/lib/einstein/retriever';
import type { StructuredQueryPlan, RetrievalResult } from '@/lib/einstein/retriever';
import {
  streamAnswer,
  EinsteinAnswerError,
  type EinsteinAnswer,
  type AnswerStreamEvent,
  type AnswerUsage,
} from '@/lib/einstein/answer';
import {
  DEFAULT_ASSISTANT_NAME,
  ESTIMATED_INPUT_TOKENS,
  ESTIMATED_OUTPUT_TOKENS,
  MAX_HISTORY_TURNS,
  MAX_HISTORY_TURN_CHARS,
  SONNET_INPUT_USD_PER_1M,
  SONNET_OUTPUT_USD_PER_1M,
  SONNET_CACHE_WRITE_USD_PER_1M,
  SONNET_CACHE_READ_USD_PER_1M,
} from '@/lib/einstein/defaults';
import { ZAR_PER_USD } from '@/lib/einstein/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Helpers (local to this file — small, non-reusable glue only) ──────────────

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface AskBody {
  question: string;
  assistantName?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  farmSlug: string;
}

function parseBody(raw: unknown): AskBody | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'Request body must be a JSON object' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.question !== 'string' || r.question.trim().length === 0) {
    return { error: 'question must be a non-empty string' };
  }
  if (r.question.length > 4000) {
    return { error: 'question must be ≤4000 characters' };
  }
  if (typeof r.farmSlug !== 'string' || r.farmSlug.length === 0) {
    return { error: 'farmSlug must be a non-empty string' };
  }
  let history: AskBody['history'];
  if (r.history !== undefined) {
    if (!Array.isArray(r.history)) return { error: 'history must be an array' };
    const turns: NonNullable<AskBody['history']> = [];
    for (const turn of r.history) {
      if (typeof turn !== 'object' || turn === null) continue;
      const t = turn as Record<string, unknown>;
      if (
        (t.role === 'user' || t.role === 'assistant') &&
        typeof t.content === 'string'
      ) {
        turns.push({ role: t.role, content: t.content });
      }
    }
    // api-F1/EIN-2 — bound history BEFORE the model call. Keep the most
    // recent MAX_HISTORY_TURNS turns and clamp each turn's content to
    // MAX_HISTORY_TURN_CHARS, so the history context is hard-bounded at
    // MAX_HISTORY_TURNS × MAX_HISTORY_TURN_CHARS chars; old turns roll off
    // instead of rejecting the request (history is advisory context).
    history = turns.slice(-MAX_HISTORY_TURNS).map((turn) =>
      turn.content.length > MAX_HISTORY_TURN_CHARS
        ? { ...turn, content: turn.content.slice(0, MAX_HISTORY_TURN_CHARS) }
        : turn,
    );
  }
  const assistantName =
    typeof r.assistantName === 'string' && r.assistantName.trim().length > 0
      ? r.assistantName.trim()
      : undefined;
  return {
    question: r.question.trim(),
    farmSlug: r.farmSlug,
    assistantName,
    history,
  };
}

function estimatePessimisticCostZar(): number {
  const inputUsd = (ESTIMATED_INPUT_TOKENS / 1_000_000) * SONNET_INPUT_USD_PER_1M;
  const outputUsd = (ESTIMATED_OUTPUT_TOKENS / 1_000_000) * SONNET_OUTPUT_USD_PER_1M;
  return (inputUsd + outputUsd) * ZAR_PER_USD;
}

/**
 * api-F1/EIN-2 — real cost from the SDK's reported usage, per billing
 * bucket: uncached input (1×), cache write (1.25×), cache read (0.1×),
 * output. Replaces the pessimistic pre-stamp once the stream completes.
 */
function computeActualCostZar(usage: AnswerUsage): number {
  const usd =
    (usage.inputTokens / 1_000_000) * SONNET_INPUT_USD_PER_1M +
    (usage.cacheCreationInputTokens / 1_000_000) * SONNET_CACHE_WRITE_USD_PER_1M +
    (usage.cacheReadInputTokens / 1_000_000) * SONNET_CACHE_READ_USD_PER_1M +
    (usage.outputTokens / 1_000_000) * SONNET_OUTPUT_USD_PER_1M;
  return usd * ZAR_PER_USD;
}

function readAiSettingsFromPrisma(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
): Promise<{ methodology: unknown; assistantName?: string }> {
  return prisma.farmSettings
    .findFirst({})
    .then((row: { aiSettings?: string | null } | null) => {
      if (!row?.aiSettings) return { methodology: null };
      try {
        const blob = JSON.parse(row.aiSettings) as {
          methodology?: unknown;
          assistantName?: string;
        };
        return {
          methodology: blob.methodology ?? null,
          assistantName: blob.assistantName,
        };
      } catch {
        return { methodology: null };
      }
    });
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Wave H3 (#175) — wrapped in `publicHandler` for typed-error envelope on
 * unexpected throws + observability. The route's own auth, tier gate, budget
 * assertion, mark-before-send cost stamping, SSE streaming, and best-effort
 * RagQueryLog write are all preserved verbatim inside `handle`. The adapter
 * only intervenes when the handler itself throws unexpectedly.
 */
export const POST = publicHandler({
  handle: async (req: NextRequest): Promise<Response> => {
    const session = await getServerSession(authOptions);
    if (!session) {
      // Issue #486 (Epic B4): fold the legacy `EINSTEIN_UNAUTHENTICATED`
      // (`{ code, message }`) onto the canonical ADR-0001 AUTH_REQUIRED
      // envelope (`{ error, message }`) the route adapters emit. 401 status
      // unchanged. The remaining EINSTEIN_* codes below are domain-specific
      // (tier/budget/retriever) and stay on `jsonError`.
      return routeError('AUTH_REQUIRED', 'Unauthorized', 401);
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonError('EINSTEIN_BAD_REQUEST', 'Request body must be valid JSON', 400);
    }

    const parsed = parseBody(rawBody);
    if ('error' in parsed) {
      return jsonError('EINSTEIN_BAD_REQUEST', parsed.error, 400);
    }

    // Membership/authz gate FIRST (ein-M1). getPrismaForSlugWithAuth checks
    // session membership before any meta-DB lookup, so a non-member receives
    // ONE uniform Forbidden response regardless of whether the farm exists or
    // what tier it is on — no farm-existence/tier enumeration surface.
    const authed = await getPrismaForSlugWithAuth(session, parsed.farmSlug);
    if ('error' in authed) {
      return jsonError('EINSTEIN_FORBIDDEN', authed.error, authed.status);
    }
    const { prisma } = authed;

    // Tier gate — members only (runs strictly after authz so tier is never
    // disclosed to non-members). The 404 branch is a defensive race guard:
    // a member whose farm vanished from the meta DB between authz and here.
    const creds = await getFarmCreds(parsed.farmSlug);
    if (!creds) {
      return jsonError('EINSTEIN_FARM_NOT_FOUND', `Farm ${parsed.farmSlug} not found`, 404);
    }
    if (!isPaidTier(creds.tier)) {
      return jsonError(
        'EINSTEIN_TIER_LOCKED',
        'Farm Einstein requires an Advanced or Consulting subscription.',
        403,
      );
    }

    // Budget assertion (consulting → bypass).
    try {
      await assertWithinBudget(parsed.farmSlug);
    } catch (err) {
      if (err instanceof EinsteinBudgetError) {
        const status = err.code === 'EINSTEIN_BUDGET_EXHAUSTED' ? 429 : 500;
        return new Response(
          JSON.stringify({ code: err.code, message: err.message, resetsAt: err.resetsAt }),
          { status, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return jsonError('EINSTEIN_BUDGET_UNKNOWN', 'budget check failed', 500);
    }

    // Plan the query (Haiku).
    let plan: StructuredQueryPlan;
    try {
      plan = await planQuery(parsed.question);
    } catch (err) {
      if (err instanceof QueryPlannerError) {
        return jsonError(err.code, err.message, err.code === 'QUERY_PLANNER_NO_KEY' ? 500 : 502);
      }
      return jsonError('QUERY_PLANNER_API_ERROR', 'query planner failed', 502);
    }

    // Retrieve — hybrid when the plan is "structured" (Haiku classified it as a
    // count/aggregate question). The structured path answers pure counts like
    // "how many animals" but misses field-value lookups like "how many hectares
    // is camp X". Running BOTH in parallel and merging chunks lets the answer
    // LLM pick the right evidence: the aggregate count if it matches, otherwise
    // the semantic chunks that carry the actual field values.
    //
    // Pre-fix (2026-04-21 postmortem): this was an exclusive OR. Any question
    // whose planner-rewrite contained "how many" got classified structured and
    // short-circuited past the camp/animal detail chunks, producing
    // NO_GROUNDED_EVIDENCE refusals on obviously-answerable lookups.
    let retrieval: RetrievalResult;
    try {
      const hybridMode =
        plan.isStructuredQuery && (plan.entityTypeFilter?.length ?? 0) > 0;
      if (hybridMode) {
        const [structured, semantic] = await Promise.all([
          retrieve.structured(parsed.farmSlug, plan),
          retrieve.semantic(parsed.farmSlug, plan.rewrittenQuery, {
            entityTypeFilter: plan.entityTypeFilter,
            dateRangeFilter: plan.dateRangeFilter,
          }),
        ]);
        retrieval = {
          // Structured chunks ship first so the answer LLM sees the aggregate
          // up front; semantic detail chunks provide grounding for specific
          // field values / names. Citations dedupe by entityId downstream.
          chunks: [...structured.chunks, ...semantic.chunks],
          latencyMs: Math.max(structured.latencyMs, semantic.latencyMs),
        };
      } else {
        retrieval = await retrieve.semantic(parsed.farmSlug, plan.rewrittenQuery, {
          entityTypeFilter: plan.entityTypeFilter,
          dateRangeFilter: plan.dateRangeFilter,
        });
      }
    } catch (err) {
      if (err instanceof RetrieverError) {
        return jsonError(err.code, err.message, 502);
      }
      return jsonError('RETRIEVER_UNKNOWN', 'retrieval failed', 500);
    }

    // Load methodology + resolve assistant name (request override > stored > default).
    const { methodology, assistantName: storedName } = await readAiSettingsFromPrisma(prisma);
    const assistantName = parsed.assistantName ?? storedName ?? DEFAULT_ASSISTANT_NAME;

    // MARK-BEFORE-SEND: stamp pessimistic cost BEFORE Anthropic streaming call.
    const estimatedCostZar = estimatePessimisticCostZar();
    try {
      await stampCostBeforeSend(parsed.farmSlug, estimatedCostZar);
    } catch (err) {
      if (err instanceof EinsteinBudgetError) {
        return new Response(
          JSON.stringify({ code: err.code, message: err.message, resetsAt: err.resetsAt }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return jsonError('EINSTEIN_BUDGET_STAMP_FAILED', 'failed to pre-stamp cost', 500);
    }

    // Open SSE stream. We iterate streamAnswer() and forward each event.
    const answerStartedAt = Date.now();
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        let finalPayload: EinsteinAnswer | null = null;
        let errorCode: string | null = null;
        let errorMessage: string | null = null;
        let usage: AnswerUsage | null = null;

        try {
          for await (const ev of streamAnswer({
            question: parsed.question,
            assistantName,
            methodology,
            retrieval,
            history: parsed.history,
          })) {
            const typed = ev as AnswerStreamEvent;
            if (typed.type === 'token') {
              send('token', { text: typed.text });
            } else if (typed.type === 'usage') {
              // api-F1/EIN-2 — real consumption reported by the SDK; consumed
              // in the finally block for cost reconciliation + honest logging.
              usage = typed.usage;
            } else if (typed.type === 'final') {
              finalPayload = typed.payload;
              send('final', typed.payload);
            } else if (typed.type === 'error') {
              errorCode = typed.code;
              errorMessage = typed.message;
              send('error', { code: typed.code, message: typed.message });
              break;
            }
          }
        } catch (err) {
          if (err instanceof EinsteinAnswerError) {
            errorCode = err.code;
            errorMessage = err.message;
          } else {
            errorCode = 'EINSTEIN_STREAM_FAILED';
            errorMessage = err instanceof Error ? err.message : 'unknown stream error';
          }
          send('error', { code: errorCode, message: errorMessage });
        } finally {
          // api-F1/EIN-2 — reconcile the pessimistic pre-stamp to REAL usage.
          // Only when the SDK reported usage; on pre-usage failures the
          // conservative estimate stands (never under-charge). Best-effort:
          // a reconcile failure must not kill the stream, but it is logged
          // loudly — never silently swallowed.
          const actualCostZar = usage ? computeActualCostZar(usage) : null;
          if (actualCostZar !== null) {
            try {
              await reconcileCostAfterSend(
                parsed.farmSlug,
                actualCostZar - estimatedCostZar,
              );
            } catch (reconcileErr) {
              logger.warn('[einstein/ask] failed to reconcile budget to real usage', {
                err:
                  reconcileErr instanceof Error
                    ? reconcileErr.message
                    : String(reconcileErr),
              });
            }
          }

          // Best-effort RagQueryLog row. Never let logging throw into the stream.
          try {
            await prisma.ragQueryLog.create({
              data: {
                userId: session.user?.id ?? 'unknown',
                assistantName,
                question: parsed.question,
                answerText: finalPayload?.answer ?? null,
                citations: JSON.stringify(finalPayload?.citations ?? []),
                retrievalLatencyMs: retrieval.latencyMs,
                answerLatencyMs: Date.now() - answerStartedAt,
                // Real tokens when the SDK reported them, else the estimate
                // (api-F1/EIN-2 — logged cost reflects real consumption).
                // Column mapping: inputTokens = uncached input (base rate);
                // cachedInputTokens = cache-read + cache-write input (the
                // cache-system buckets). costZar is the authoritative figure,
                // computed per-bucket in computeActualCostZar.
                inputTokens: usage ? usage.inputTokens : ESTIMATED_INPUT_TOKENS,
                outputTokens: usage ? usage.outputTokens : ESTIMATED_OUTPUT_TOKENS,
                cachedInputTokens: usage
                  ? usage.cacheReadInputTokens + usage.cacheCreationInputTokens
                  : 0,
                costZar: actualCostZar ?? estimatedCostZar,
                modelId: 'claude-sonnet-4-6',
                errorCode,
                refusedReason: finalPayload?.refusedReason ?? null,
              },
            });
          } catch (logErr) {
            logger.warn('[einstein/ask] failed to persist RagQueryLog', {
              err: logErr instanceof Error ? logErr.message : String(logErr),
            });
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  },
});
