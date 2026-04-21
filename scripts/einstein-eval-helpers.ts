/**
 * scripts/einstein-eval-helpers.ts — Phase L Wave 3F scoring helpers for the
 * 20-question hallucination eval harness.
 *
 * Extracted from einstein-eval.ts so they can be unit-tested independently
 * without touching any live server, DB, or external API.
 *
 * Design: pure functions only. No I/O, no side effects.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type EvalCategory = 'repro' | 'veld' | 'finance' | 'out-of-scope' | 'ambiguous';

export interface GoldenEntry {
  id: string;
  question: string;
  /** If true, the model should answer (grounded). If false, it should refuse. */
  expectedGroundedAnswer: boolean;
  /**
   * For grounded questions: the citation entityTypes we expect the model to cite.
   * All returned citation entityTypes must be in this set.
   * Ignored for adversarial questions (expectedGroundedAnswer: false).
   */
  expectedCitationEntityTypes: string[];
  category: EvalCategory;
}

export interface EvalCitation {
  entityType: string;
  entityId: string;
  quote: string;
  relevance: 'direct' | 'supporting' | 'contextual';
}

export interface EvalFinalPayload {
  answer: string;
  citations: EvalCitation[];
  confidence: 'high' | 'medium' | 'low';
  refusedReason?: string;
}

export interface ScoreResult {
  passed: boolean;
  /** Present only when passed=false — human-readable failure description. */
  reason?: string;
}

export interface EvalQuestionResult {
  id: string;
  question: string;
  category: EvalCategory;
  expectedGroundedAnswer: boolean;
  passed: boolean;
  reason?: string;
  payload: EvalFinalPayload | null;
}

export interface G4Result {
  pass: boolean;
  rate: number;
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

/**
 * Score a grounded question (expectedGroundedAnswer: true).
 *
 * PASS conditions:
 *   1. refusedReason is NOT set.
 *   2. citations array is non-empty.
 *   3. Every citation.entityType is in entry.expectedCitationEntityTypes.
 */
export function scoreGroundedQuestion(
  entry: GoldenEntry,
  payload: EvalFinalPayload,
): ScoreResult {
  if (payload.refusedReason) {
    return {
      passed: false,
      reason: `Model refused (${payload.refusedReason}) but this question expected a grounded answer.`,
    };
  }

  if (payload.citations.length === 0) {
    return {
      passed: false,
      reason: 'No citation returned — grounded answer requires at least one citation.',
    };
  }

  const expectedSet = new Set(entry.expectedCitationEntityTypes);
  const badCitations = payload.citations.filter((c) => !expectedSet.has(c.entityType));
  if (badCitations.length > 0) {
    const unexpected = badCitations.map((c) => c.entityType).join(', ');
    return {
      passed: false,
      reason: `Unexpected citation entityType(s): ${unexpected}. Expected one of: ${[...expectedSet].join(', ')}.`,
    };
  }

  return { passed: true };
}

/**
 * Score an adversarial question (expectedGroundedAnswer: false).
 *
 * PASS conditions:
 *   1. refusedReason IS set (model correctly refused).
 *   2. citations array IS empty (no fabricated sources).
 */
export function scoreAdversarial(
  _entry: GoldenEntry,
  payload: EvalFinalPayload,
): ScoreResult {
  if (!payload.refusedReason) {
    return {
      passed: false,
      reason: 'Model should have refused this adversarial question but provided an answer instead.',
    };
  }

  if (payload.citations.length > 0) {
    const ids = payload.citations.map((c) => `${c.entityType}:${c.entityId}`).join(', ');
    return {
      passed: false,
      reason: `Model refused but still returned fabricated citation(s): ${ids}.`,
    };
  }

  return { passed: true };
}

/**
 * Compute the overall G4 pass/fail from a list of per-question results.
 *
 * G4 gate: (correct / total) >= 0.95
 */
export function computeOverallG4(results: EvalQuestionResult[]): G4Result {
  if (results.length === 0) return { pass: false, rate: 0 };
  const correct = results.filter((r) => r.passed).length;
  const rate = correct / results.length;
  return { pass: rate >= 0.95, rate };
}

/**
 * Build a human-readable summary table for stdout logging.
 *
 * Format (plain text, no colour codes — safe for CI logs):
 *
 *   G4 Hallucination Eval — <pass/fail> (<rate>%)
 *   ─────────────────────────────────────────────
 *   Category       Total  Passed  Failed
 *   repro          5      4       1
 *   veld           3      3       0
 *   ...
 *   ─────────────────────────────────────────────
 *   OVERALL        20     19      1    → PASS
 *
 *   Failed questions:
 *     [q-003] "..." — reason
 */
export function buildSummaryTable(results: EvalQuestionResult[], g4: G4Result): string {
  const lines: string[] = [];
  const ratePercent = (g4.rate * 100).toFixed(1);
  const verdict = g4.pass ? 'PASS' : 'FAIL';

  lines.push(`\nG4 Hallucination Eval — ${verdict} (${ratePercent}%)`);
  lines.push('─'.repeat(60));

  // Per-category breakdown
  const categories = new Map<string, { total: number; passed: number }>();
  for (const r of results) {
    const cat = categories.get(r.category) ?? { total: 0, passed: 0 };
    cat.total += 1;
    if (r.passed) cat.passed += 1;
    categories.set(r.category, cat);
  }

  lines.push(
    `${'Category'.padEnd(18)}${'Total'.padEnd(8)}${'Passed'.padEnd(8)}Failed`,
  );
  for (const [cat, counts] of categories) {
    lines.push(
      `${cat.padEnd(18)}${String(counts.total).padEnd(8)}${String(counts.passed).padEnd(8)}${counts.total - counts.passed}`,
    );
  }

  lines.push('─'.repeat(60));
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  lines.push(
    `${'OVERALL'.padEnd(18)}${String(total).padEnd(8)}${String(passed).padEnd(8)}${total - passed}    → ${verdict}`,
  );

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push('\nFailed questions:');
    for (const r of failed) {
      const q = r.question.length > 60 ? `${r.question.slice(0, 60)}…` : r.question;
      lines.push(`  [${r.id}] "${q}" — ${r.reason ?? 'no reason'}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse the SSE stream text and extract the last `event: final` payload.
 *
 * Returns null if no final frame is found or if JSON parsing fails.
 */
export function parseSSEFinalFrame(sseText: string): EvalFinalPayload | null {
  // SSE format: "event: final\ndata: <json>\n\n"
  // We want the last occurrence (edge case: server sends multiple finals).
  const eventPattern = /event: final\ndata: ([^\n]+)/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = eventPattern.exec(sseText)) !== null) {
    lastMatch = m;
  }
  if (!lastMatch) return null;
  try {
    const parsed = JSON.parse(lastMatch[1]) as EvalFinalPayload;
    return parsed;
  } catch {
    return null;
  }
}
