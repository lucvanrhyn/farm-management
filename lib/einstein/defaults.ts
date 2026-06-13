/**
 * lib/einstein/defaults.ts — Phase L Wave 2B hoisted constants.
 *
 * Kept separate so both lib files AND route.ts files can import without
 * violating the "route.ts exports ONLY handlers + config" rule (Phase K
 * lesson de7056b / feedback-build-not-just-test.md).
 */

export const DEFAULT_ASSISTANT_NAME = 'Einstein';
export const DEFAULT_BUDGET_CAP_ZAR = 100;
export const DEFAULT_RESPONSE_LANGUAGE: 'en' | 'af' | 'auto' = 'auto';

/**
 * Retrieval top-K for semantic search (per Scope-C lock 2026-04-20).
 * Raised 8 → 16 for #516: dense fortnight date windows were under-fetched
 * at top-8. The change is rank-neutral (top-8 ⊂ top-16, same ORDER BY
 * distance ASC) and the 50-cap in retriever.ts still bounds the LIMIT.
 */
export const RETRIEVAL_TOP_K = 16;

/**
 * Max number of structured *detail* rows the observation handler fetches in
 * addition to its aggregate count chunk (#516, Issue 1 — observedAt-axis miss).
 *
 * Why this exists: the semantic path filters EinsteinChunk on `sourceUpdatedAt`
 * (the record-mutation axis) while the structured observation handler filters
 * `Observation.observedAt` (the event axis). A date-windowed question ("what was
 * observed last week") therefore MISSES an observation that was *recorded*
 * outside the window even though it was *observed* inside it — the semantic
 * detail chunk is absent and the structured path returned only a COUNT, leaving
 * the LLM a bare number with no grounding. We now also return the actual
 * in-window Observation rows as detail chunks, sourced by the correct event
 * axis, capped here so a dense fortnight can't balloon the answer context.
 *
 * Rows are ordered `observedAt` desc (most-recent-first) and truncated to this
 * many. 25 comfortably covers a typical dense window while staying well under
 * the semantic top-K budget the answer LLM already handles.
 */
export const STRUCTURED_DETAIL_LIMIT = 25;

/**
 * Conversation-history caps for /api/einstein/ask (api-F1/EIN-2).
 *
 * Without these a client can ship an unbounded `history` array (multi-MB
 * context → token-cost abuse). The route keeps the most recent
 * MAX_HISTORY_TURNS turns and clamps each turn's content to
 * MAX_HISTORY_TURN_CHARS, so total history context is bounded by
 * MAX_HISTORY_TURNS × MAX_HISTORY_TURN_CHARS characters (~80k chars).
 * Both are 1-line tunables (same pattern as RETRIEVAL_TOP_K above).
 */
export const MAX_HISTORY_TURNS = 20;
/** Per-turn content clamp — mirrors the 4000-char cap on `question`. */
export const MAX_HISTORY_TURN_CHARS = 4000;

/** Claude Sonnet 4.6 — answer generation model. */
export const ANTHROPIC_ANSWER_MODEL = 'claude-sonnet-4-6';

/** Claude Haiku 4.5 — query planner / classifier. */
export const ANTHROPIC_PLANNER_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Rough ZAR-per-token estimates for Sonnet 4.6. Used at request time to
 * pre-stamp budget before the SDK call (mark-before-send). Actual cost is
 * recomputed from returned usage after the call.
 *
 * Sonnet 4.6 pricing (USD per 1M tokens, 2026-04):
 *   input:  $3.00
 *   output: $15.00
 * Using ZAR_PER_USD = 18.5 (matches lib/einstein/embeddings.ts constant).
 */
export const SONNET_INPUT_USD_PER_1M = 3.0;
export const SONNET_OUTPUT_USD_PER_1M = 15.0;

/**
 * Prompt-cache rates for Sonnet 4.6 (api-F1/EIN-2 — real-usage cost
 * reconciliation). The answer call marks its system blocks with
 * `cache_control: {type: 'ephemeral'}` (5-minute TTL), so real usage splits
 * input into three buckets billed at different rates:
 *   uncached input            → SONNET_INPUT_USD_PER_1M  (1×)
 *   cache WRITE (creation)    → 1.25× input  = $3.75/1M
 *   cache READ                → 0.1×  input  = $0.30/1M
 */
export const SONNET_CACHE_WRITE_USD_PER_1M = 3.75;
export const SONNET_CACHE_READ_USD_PER_1M = 0.3;

/**
 * Haiku 4.5 pricing for the planner call (USD per 1M tokens):
 *   input:  $0.80
 *   output: $4.00
 */
export const HAIKU_INPUT_USD_PER_1M = 0.8;
export const HAIKU_OUTPUT_USD_PER_1M = 4.0;

/** Rough pre-stamp token estimates — used to calculate the pessimistic ZAR cost. */
export const ESTIMATED_INPUT_TOKENS = 3200;
export const ESTIMATED_OUTPUT_TOKENS = 500;

/**
 * Confidence tiers returned by the answer LLM. Used by the UI to pick
 * visual treatment (green / amber / red dot).
 */
export type EinsteinConfidence = 'high' | 'medium' | 'low';

/** Typed refusal reasons — mirrors RagQueryLog.refusedReason column. */
export type EinsteinRefusalReason =
  | 'NO_GROUNDED_EVIDENCE'
  | 'OUT_OF_SCOPE'
  | 'TIER_LIMIT';
