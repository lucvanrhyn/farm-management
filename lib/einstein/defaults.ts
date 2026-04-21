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

/** Retrieval top-K for semantic search (per Scope-C lock 2026-04-20). */
export const RETRIEVAL_TOP_K = 8;

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
