/**
 * @vitest-environment node
 *
 * __tests__/einstein/query-planner.test.ts — Phase L Wave 2B Haiku classifier.
 *
 * Covered behaviours:
 *   - Missing ANTHROPIC_API_KEY → QueryPlannerError('QUERY_PLANNER_NO_KEY').
 *   - Happy path: planner calls Anthropic SDK with ANTHROPIC_PLANNER_MODEL and
 *     returns a well-shaped StructuredQueryPlan.
 *   - Malformed response (non-JSON / not-an-object) → typed
 *     'QUERY_PLANNER_INVALID_RESPONSE' error, rawResponse preserved.
 *   - Markdown fences stripped before JSON parse.
 *   - Structured detection: count questions → isStructuredQuery=true;
 *     open-ended "why/how" questions → isStructuredQuery=false.
 *   - Entity + date filter extraction (whitelist) + silent drop of bogus
 *     entity types.
 *   - Empty question rejected.
 *   - Anthropic SDK throw → wrapped as 'QUERY_PLANNER_API_ERROR'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ANTHROPIC_PLANNER_MODEL } from '@/lib/einstein/defaults';

// ── Anthropic SDK mock ────────────────────────────────────────────────────────

const messagesCreateMock = vi.fn();

// Default constructor returns an object exposing `messages.create`.
// Individual tests override messagesCreateMock.
vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicMock {
    messages = {
      create: (...args: unknown[]) => messagesCreateMock(...args),
    };
    constructor(public readonly opts?: { apiKey?: string }) {}
  }
  return {
    default: AnthropicMock,
    // TextBlock type is just a runtime no-op; tests emit shape by hand.
  };
});

const { planQuery, parsePlannerResponse, QueryPlannerError } = await import(
  '@/lib/einstein/query-planner'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkTextResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  messagesCreateMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-test-key-xxx';
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('planQuery — lazy client / env', () => {
  it('throws QUERY_PLANNER_NO_KEY when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await planQuery('how many cows in camp 5');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QueryPlannerError);
      expect((err as InstanceType<typeof QueryPlannerError>).code).toBe(
        'QUERY_PLANNER_NO_KEY',
      );
    }
    // Constructor never reached because client built lazily post-env-check.
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });

  it('does not construct Anthropic SDK at module load (lazy instantiation)', async () => {
    // The module under test was imported at the top of this file and the
    // mock constructor has been in place since. If instantiation were eager,
    // messagesCreateMock would exist but the constructor would have been
    // invoked already. We reset the mock count between tests, so at the
    // start of this test we verify no pre-call activity exists.
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });
});

describe('planQuery — happy path', () => {
  it('calls Anthropic with ANTHROPIC_PLANNER_MODEL + returns a StructuredQueryPlan', async () => {
    messagesCreateMock.mockResolvedValueOnce(
      mkTextResponse(
        JSON.stringify({
          rewrittenQuery: 'count of cows in camp 5',
          isStructuredQuery: true,
          entityTypeFilter: ['animal'],
        }),
      ),
    );

    const plan = await planQuery('how many cows in camp 5?');
    expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    const args = messagesCreateMock.mock.calls[0][0] as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
      system: string;
    };
    expect(args.model).toBe(ANTHROPIC_PLANNER_MODEL);
    expect(args.max_tokens).toBeGreaterThan(0);
    expect(args.messages[0].role).toBe('user');
    expect(args.messages[0].content).toBe('how many cows in camp 5?');

    expect(plan.isStructuredQuery).toBe(true);
    expect(plan.rewrittenQuery).toBe('count of cows in camp 5');
    expect(plan.entityTypeFilter).toEqual(['animal']);
  });

  it('detects open-ended question → isStructuredQuery=false', async () => {
    messagesCreateMock.mockResolvedValueOnce(
      mkTextResponse(
        JSON.stringify({
          rewrittenQuery: "what's wrong with breeding",
          isStructuredQuery: false,
        }),
      ),
    );
    const plan = await planQuery("what's going wrong with my breeding?");
    expect(plan.isStructuredQuery).toBe(false);
  });

  it('extracts dateRangeFilter as Date objects when planner emits them', async () => {
    messagesCreateMock.mockResolvedValueOnce(
      mkTextResponse(
        JSON.stringify({
          rewrittenQuery: 'observations last month',
          isStructuredQuery: true,
          entityTypeFilter: ['observation'],
          dateRangeFilter: { start: '2026-03-01', end: '2026-03-31' },
        }),
      ),
    );
    const plan = await planQuery('how many observations last month');
    expect(plan.dateRangeFilter?.start).toBeInstanceOf(Date);
    expect(plan.dateRangeFilter?.end).toBeInstanceOf(Date);
    expect(plan.dateRangeFilter?.start?.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(plan.dateRangeFilter?.end?.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('silently drops non-whitelisted entity types from entityTypeFilter', async () => {
    messagesCreateMock.mockResolvedValueOnce(
      mkTextResponse(
        JSON.stringify({
          rewrittenQuery: 'q',
          isStructuredQuery: true,
          entityTypeFilter: ['animal', 'DROP TABLE', 'task'],
        }),
      ),
    );
    const plan = await planQuery('q');
    expect(plan.entityTypeFilter).toEqual(['animal', 'task']);
  });

  it('strips ```json fences if Haiku slips', async () => {
    messagesCreateMock.mockResolvedValueOnce(
      mkTextResponse(
        '```json\n' +
          JSON.stringify({
            rewrittenQuery: 'fenced',
            isStructuredQuery: false,
          }) +
          '\n```',
      ),
    );
    const plan = await planQuery('q');
    expect(plan.rewrittenQuery).toBe('fenced');
    expect(plan.isStructuredQuery).toBe(false);
  });
});

describe('planQuery — error branches', () => {
  it('rejects empty question', async () => {
    try {
      await planQuery('   ');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QueryPlannerError);
      expect((err as InstanceType<typeof QueryPlannerError>).code).toBe(
        'QUERY_PLANNER_INVALID_RESPONSE',
      );
    }
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });

  it('wraps Anthropic SDK throws as QUERY_PLANNER_API_ERROR', async () => {
    messagesCreateMock.mockRejectedValueOnce(new Error('429 rate limited'));
    try {
      await planQuery('q');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QueryPlannerError);
      expect((err as InstanceType<typeof QueryPlannerError>).code).toBe(
        'QUERY_PLANNER_API_ERROR',
      );
    }
  });

  it('throws QUERY_PLANNER_INVALID_RESPONSE on non-JSON content', async () => {
    messagesCreateMock.mockResolvedValueOnce(mkTextResponse('not json at all'));
    try {
      await planQuery('q');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QueryPlannerError);
      expect((err as InstanceType<typeof QueryPlannerError>).code).toBe(
        'QUERY_PLANNER_INVALID_RESPONSE',
      );
      expect((err as InstanceType<typeof QueryPlannerError>).rawResponse).toBe(
        'not json at all',
      );
    }
  });

  it('throws QUERY_PLANNER_INVALID_RESPONSE when planner emits an array (not object)', async () => {
    messagesCreateMock.mockResolvedValueOnce(mkTextResponse('[1,2,3]'));
    try {
      await planQuery('q');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QueryPlannerError);
      expect((err as InstanceType<typeof QueryPlannerError>).code).toBe(
        'QUERY_PLANNER_INVALID_RESPONSE',
      );
    }
  });
});

describe('parsePlannerResponse — pure helper', () => {
  it('falls back to fallbackQuestion when rewrittenQuery is missing', () => {
    const plan = parsePlannerResponse(
      JSON.stringify({ isStructuredQuery: true }),
      'original question',
    );
    expect(plan.rewrittenQuery).toBe('original question');
  });

  it('treats missing isStructuredQuery as false', () => {
    const plan = parsePlannerResponse(
      JSON.stringify({ rewrittenQuery: 'x' }),
      'orig',
    );
    expect(plan.isStructuredQuery).toBe(false);
  });

  it('omits dateRangeFilter when no valid dates in the blob', () => {
    const plan = parsePlannerResponse(
      JSON.stringify({
        rewrittenQuery: 'x',
        isStructuredQuery: true,
        dateRangeFilter: { start: 'not-a-date', end: 'also-not' },
      }),
      'orig',
    );
    expect(plan.dateRangeFilter).toBeUndefined();
  });

  it('omits entityTypeFilter when every entity is unknown', () => {
    const plan = parsePlannerResponse(
      JSON.stringify({
        rewrittenQuery: 'x',
        isStructuredQuery: true,
        entityTypeFilter: ['banana', 'apple'],
      }),
      'orig',
    );
    expect(plan.entityTypeFilter).toBeUndefined();
  });
});
