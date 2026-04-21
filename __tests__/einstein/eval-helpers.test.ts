/**
 * @vitest-environment node
 *
 * __tests__/einstein/eval-helpers.test.ts — Phase L Wave 3F TDD-first tests.
 *
 * Tests for `scripts/einstein-eval-helpers.ts`. Scoring logic is extracted from
 * `scripts/einstein-eval.ts` so it can be unit-tested without hitting any live
 * server or external API.
 *
 * Covered behaviours:
 *   - scoreGroundedQuestion: passes when answer is non-refused + has citations +
 *     all citation entityTypes are in expectedCitationEntityTypes.
 *   - scoreGroundedQuestion: fails when refusedReason is set (unnecessary refusal).
 *   - scoreGroundedQuestion: fails when citations array is empty.
 *   - scoreGroundedQuestion: fails when a citation entityType is not in expected set.
 *   - scoreAdversarial: passes when refusedReason is set + citations is empty.
 *   - scoreAdversarial: fails when answer is not refused (model should have refused).
 *   - scoreAdversarial: fails when refusedReason is null but citations present.
 *   - computeOverallG4: passes at ≥95% threshold.
 *   - computeOverallG4: fails below 95%.
 *   - computeOverallG4: handles edge cases (all pass, all fail, exactly 20/20).
 *   - buildSummaryTable: returns a string with header row and category counts.
 *   - parseSSEFinalFrame: extracts final payload from SSE stream text.
 *   - parseSSEFinalFrame: returns null when no final frame present.
 *   - parseSSEFinalFrame: returns null on malformed final frame JSON.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreGroundedQuestion,
  scoreAdversarial,
  computeOverallG4,
  buildSummaryTable,
  parseSSEFinalFrame,
  type EvalQuestionResult,
  type GoldenEntry,
  type EvalFinalPayload,
} from '../../scripts/einstein-eval-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeGoldenEntry(overrides: Partial<GoldenEntry> = {}): GoldenEntry {
  return {
    id: 'q-001',
    question: 'How many observations in camp 1?',
    expectedGroundedAnswer: true,
    expectedCitationEntityTypes: ['observation', 'camp'],
    category: 'repro',
    ...overrides,
  };
}

function makePayload(overrides: Partial<EvalFinalPayload> = {}): EvalFinalPayload {
  return {
    answer: 'There were 5 observations in camp 1 during April.',
    citations: [
      { entityType: 'observation', entityId: 'obs-1', quote: 'camp 1', relevance: 'direct' },
    ],
    confidence: 'high',
    refusedReason: undefined,
    ...overrides,
  };
}

// ── scoreGroundedQuestion ─────────────────────────────────────────────────────

describe('scoreGroundedQuestion', () => {
  it('returns passed=true when answer is answered, has citations, all types in expected set', () => {
    const entry = makeGoldenEntry();
    const payload = makePayload();
    const result = scoreGroundedQuestion(entry, payload);
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns passed=false when refusedReason is set (unnecessary refusal)', () => {
    const entry = makeGoldenEntry();
    const payload = makePayload({ refusedReason: 'NO_GROUNDED_EVIDENCE' });
    const result = scoreGroundedQuestion(entry, payload);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/refused/i);
  });

  it('returns passed=false when citations array is empty', () => {
    const entry = makeGoldenEntry();
    const payload = makePayload({ citations: [] });
    const result = scoreGroundedQuestion(entry, payload);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/no citation/i);
  });

  it('returns passed=false when a citation entityType is not in expected set', () => {
    const entry = makeGoldenEntry({ expectedCitationEntityTypes: ['observation'] });
    const payload = makePayload({
      citations: [
        { entityType: 'observation', entityId: 'obs-1', quote: 'x', relevance: 'direct' },
        { entityType: 'camp', entityId: 'camp-1', quote: 'y', relevance: 'contextual' },
      ],
    });
    const result = scoreGroundedQuestion(entry, payload);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/entityType/i);
  });

  it('passes when multiple citations all have expected entity types', () => {
    const entry = makeGoldenEntry({
      expectedCitationEntityTypes: ['observation', 'camp', 'animal'],
    });
    const payload = makePayload({
      citations: [
        { entityType: 'observation', entityId: 'obs-1', quote: 'x', relevance: 'direct' },
        { entityType: 'animal', entityId: 'ani-1', quote: 'y', relevance: 'supporting' },
      ],
    });
    const result = scoreGroundedQuestion(entry, payload);
    expect(result.passed).toBe(true);
  });

  it('passes with a single citation matching the expected type', () => {
    const entry = makeGoldenEntry({ expectedCitationEntityTypes: ['camp'] });
    const payload = makePayload({
      citations: [
        { entityType: 'camp', entityId: 'camp-1', quote: 'North paddock', relevance: 'direct' },
      ],
    });
    const result = scoreGroundedQuestion(entry, payload);
    expect(result.passed).toBe(true);
  });
});

// ── scoreAdversarial ──────────────────────────────────────────────────────────

describe('scoreAdversarial', () => {
  it('returns passed=true when refusedReason is set and citations is empty', () => {
    const entry = makeGoldenEntry({ expectedGroundedAnswer: false, category: 'out-of-scope' });
    const payload = makePayload({
      citations: [],
      refusedReason: 'OUT_OF_SCOPE',
      answer: "I don't have information about that.",
    });
    const result = scoreAdversarial(entry, payload);
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns passed=false when refusedReason is missing (model should have refused)', () => {
    const entry = makeGoldenEntry({ expectedGroundedAnswer: false, category: 'out-of-scope' });
    const payload = makePayload({
      citations: [],
      refusedReason: undefined,
      answer: "The weather tomorrow will be sunny.",
    });
    const result = scoreAdversarial(entry, payload);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/should have refused/i);
  });

  it('returns passed=false when citations are present on an adversarial question', () => {
    const entry = makeGoldenEntry({ expectedGroundedAnswer: false, category: 'out-of-scope' });
    const payload = makePayload({
      refusedReason: 'OUT_OF_SCOPE',
      citations: [
        { entityType: 'observation', entityId: 'obs-1', quote: 'x', relevance: 'direct' },
      ],
    });
    const result = scoreAdversarial(entry, payload);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/citation/i);
  });

  it('passes when refusedReason is NO_GROUNDED_EVIDENCE and no citations', () => {
    const entry = makeGoldenEntry({ expectedGroundedAnswer: false, category: 'ambiguous' });
    const payload = makePayload({
      citations: [],
      refusedReason: 'NO_GROUNDED_EVIDENCE',
      answer: "I don't have enough information.",
    });
    const result = scoreAdversarial(entry, payload);
    expect(result.passed).toBe(true);
  });
});

// ── computeOverallG4 ──────────────────────────────────────────────────────────

describe('computeOverallG4', () => {
  function makeResult(passed: boolean, id = 'q-001'): EvalQuestionResult {
    return {
      id,
      question: 'test question',
      category: 'repro',
      expectedGroundedAnswer: true,
      passed,
      reason: passed ? undefined : 'test failure reason',
      payload: makePayload(),
    };
  }

  it('returns pass=true when all 20 questions pass (100% = ≥95%)', () => {
    const results = Array.from({ length: 20 }, (_, i) => makeResult(true, `q-${i}`));
    const { pass, rate } = computeOverallG4(results);
    expect(pass).toBe(true);
    expect(rate).toBe(1.0);
  });

  it('returns pass=true at exactly 19/20 = 95%', () => {
    const results = [
      ...Array.from({ length: 19 }, (_, i) => makeResult(true, `q-${i}`)),
      makeResult(false, 'q-19'),
    ];
    const { pass, rate } = computeOverallG4(results);
    expect(pass).toBe(true);
    expect(rate).toBeCloseTo(0.95);
  });

  it('returns pass=false at 18/20 = 90%', () => {
    const results = [
      ...Array.from({ length: 18 }, (_, i) => makeResult(true, `q-${i}`)),
      makeResult(false, 'q-18'),
      makeResult(false, 'q-19'),
    ];
    const { pass, rate } = computeOverallG4(results);
    expect(pass).toBe(false);
    expect(rate).toBeCloseTo(0.90);
  });

  it('returns pass=false at 0/20', () => {
    const results = Array.from({ length: 20 }, (_, i) => makeResult(false, `q-${i}`));
    const { pass, rate } = computeOverallG4(results);
    expect(pass).toBe(false);
    expect(rate).toBe(0);
  });

  it('handles empty results array gracefully (0% = fail)', () => {
    const { pass, rate } = computeOverallG4([]);
    expect(pass).toBe(false);
    expect(rate).toBe(0);
  });

  it('applies 95% threshold correctly (0.949 is fail, 0.950 is pass)', () => {
    // Simulate 20 results: 18.98 would round up in decimals but 18/20=0.9 fails
    // Use 20 questions: 19 pass = 95% = pass boundary
    const nineteenPass = [
      ...Array.from({ length: 19 }, (_, i) => makeResult(true, `q-${i}`)),
      makeResult(false, 'q-19'),
    ];
    expect(computeOverallG4(nineteenPass).pass).toBe(true);
  });
});

// ── buildSummaryTable ─────────────────────────────────────────────────────────

describe('buildSummaryTable', () => {
  it('returns a string with header and separator row', () => {
    const results: EvalQuestionResult[] = [
      {
        id: 'q-001',
        question: 'test question',
        category: 'repro',
        expectedGroundedAnswer: true,
        passed: true,
        payload: makePayload(),
      },
      {
        id: 'q-002',
        question: 'adversarial test',
        category: 'out-of-scope',
        expectedGroundedAnswer: false,
        passed: false,
        reason: 'should have refused',
        payload: makePayload({ refusedReason: undefined }),
      },
    ];
    // g4.pass=false → verdict is FAIL; PASS does not appear in this output
    const table = buildSummaryTable(results, { pass: false, rate: 0.5 });
    expect(typeof table).toBe('string');
    expect(table).toContain('FAIL');
    expect(table).toContain('G4');
    // The failed question should be listed
    expect(table).toContain('q-002');
  });

  it('includes per-category breakdown in output', () => {
    const results: EvalQuestionResult[] = [
      {
        id: 'q-001',
        question: 'q',
        category: 'repro',
        expectedGroundedAnswer: true,
        passed: true,
        payload: makePayload(),
      },
      {
        id: 'q-002',
        question: 'q2',
        category: 'veld',
        expectedGroundedAnswer: true,
        passed: false,
        reason: 'no citations',
        payload: makePayload({ citations: [] }),
      },
    ];
    const table = buildSummaryTable(results, { pass: false, rate: 0.5 });
    expect(table).toContain('repro');
    expect(table).toContain('veld');
  });

  it('shows overall rate as percentage', () => {
    const results: EvalQuestionResult[] = [];
    const table = buildSummaryTable(results, { pass: true, rate: 0.95 });
    expect(table).toContain('95');
  });
});

// ── parseSSEFinalFrame ────────────────────────────────────────────────────────

describe('parseSSEFinalFrame', () => {
  it('extracts payload from a valid SSE final frame', () => {
    const payload = makePayload();
    const sseText = [
      'event: token\ndata: {"text":"Hello "}\n\n',
      `event: final\ndata: ${JSON.stringify(payload)}\n\n`,
    ].join('');
    const result = parseSSEFinalFrame(sseText);
    expect(result).not.toBeNull();
    expect(result?.answer).toBe(payload.answer);
    expect(result?.citations).toHaveLength(1);
    expect(result?.confidence).toBe('high');
  });

  it('returns null when no final frame is present', () => {
    const sseText = 'event: token\ndata: {"text":"Hello"}\n\n';
    expect(parseSSEFinalFrame(sseText)).toBeNull();
  });

  it('returns null when final frame has malformed JSON', () => {
    const sseText = 'event: final\ndata: {not valid json}\n\n';
    expect(parseSSEFinalFrame(sseText)).toBeNull();
  });

  it('handles a final frame with refusedReason', () => {
    const payload = makePayload({ citations: [], refusedReason: 'OUT_OF_SCOPE' });
    const sseText = `event: final\ndata: ${JSON.stringify(payload)}\n\n`;
    const result = parseSSEFinalFrame(sseText);
    expect(result?.refusedReason).toBe('OUT_OF_SCOPE');
    expect(result?.citations).toHaveLength(0);
  });

  it('returns null when SSE text is empty', () => {
    expect(parseSSEFinalFrame('')).toBeNull();
  });

  it('extracts the last final frame when multiple final frames appear (edge case)', () => {
    const payload1 = makePayload({ answer: 'first answer' });
    const payload2 = makePayload({ answer: 'second answer' });
    const sseText = [
      `event: final\ndata: ${JSON.stringify(payload1)}\n\n`,
      `event: final\ndata: ${JSON.stringify(payload2)}\n\n`,
    ].join('');
    const result = parseSSEFinalFrame(sseText);
    expect(result?.answer).toBe('second answer');
  });
});
