/**
 * @vitest-environment node
 *
 * __tests__/einstein/answer.test.ts — Phase L Wave 2B Claude Sonnet streamer.
 *
 * Covered behaviours:
 *   - streamAnswer yields `{type:'token', text}` per delta, then `{type:'final', payload}`.
 *   - Missing ANTHROPIC_API_KEY → yields `{type:'error', code:'EINSTEIN_ANSWER_NO_KEY'}`
 *     (NOT throw — the generator gracefully emits an error frame).
 *   - Lazy client: importing the module doesn't construct Anthropic at load-time.
 *   - Citation fabrication: if the model cites an entityId not present in the
 *     retrieval set, yields `{type:'error', code:'EINSTEIN_CITATION_FABRICATION'}`
 *     — REGARDLESS of refusedReason (S20 / ein-M3).
 *   - Grounding contract (S20 / ein-M3): a non-empty factual answer with zero
 *     citations yields `{type:'error', code:'EINSTEIN_ANSWER_UNGROUNDED'}`.
 *     Refusals (refusedReason set) are exempt — a refusal is not free-generation.
 *   - Invalid tail JSON → yields `{type:'error', code:'EINSTEIN_ANSWER_INVALID_JSON'}`.
 *   - SDK throw → `{type:'error', code:'EINSTEIN_ANSWER_API_ERROR'}`.
 *   - parseAnswerJson pure helper: valid JSON → EinsteinAnswer; invalid → throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RetrievalResult } from '@/lib/einstein/retriever';

// ── Anthropic SDK mock ────────────────────────────────────────────────────────

// The stream() method must return an async-iterable. Individual tests replace
// `streamScript` with the sequence of events the SDK should emit.
let streamScript: unknown[] = [];
let streamShouldThrow: Error | null = null;
const streamMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicMock {
    messages = {
      stream: (...args: unknown[]) => {
        streamMock(...args);
        if (streamShouldThrow) {
          throw streamShouldThrow;
        }
        const script = streamScript;
        return {
          async *[Symbol.asyncIterator]() {
            for (const ev of script) {
              yield ev;
            }
          },
        };
      },
    };
    constructor(public readonly opts?: { apiKey?: string }) {}
  }
  return { default: AnthropicMock };
});

const { streamAnswer, parseAnswerJson, EinsteinAnswerError } = await import(
  '@/lib/einstein/answer'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkDelta(text: string) {
  return {
    type: 'content_block_delta',
    delta: { type: 'text_delta', text },
  };
}

function mkRetrieval(chunkIds: string[]): RetrievalResult {
  return {
    chunks: chunkIds.map((id, i) => ({
      entityType: 'observation',
      entityId: id,
      text: `chunk text for ${id}`,
      score: 0.9 - i * 0.05,
      sourceUpdatedAt: new Date('2026-04-01'),
    })),
    latencyMs: 42,
  };
}

async function collectEvents(
  gen: AsyncGenerator<unknown>,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for await (const ev of gen) {
    out.push(ev as Record<string, unknown>);
  }
  return out;
}

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  streamScript = [];
  streamShouldThrow = null;
  streamMock.mockReset();
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

describe('streamAnswer — happy path', () => {
  it('yields token events per delta, then a final event with the parsed payload', async () => {
    const tailJson = JSON.stringify({
      answer: 'You have 3 sick cows.',
      citations: [
        {
          entityType: 'observation',
          entityId: 'obs-1',
          quote: 'mastitis',
          relevance: 'direct',
        },
      ],
      confidence: 'high',
    });
    streamScript = [
      mkDelta('Looking at the chunks...\n\n'),
      mkDelta('```json\n'),
      mkDelta(tailJson),
      mkDelta('\n```'),
    ];

    const events = await collectEvents(
      streamAnswer({
        question: 'any sick?',
        assistantName: 'Einstein',
        methodology: { feedPhilosophy: 'veld-first' },
        retrieval: mkRetrieval(['obs-1']),
      }),
    );

    const tokens = events.filter((e) => e.type === 'token');
    const finals = events.filter((e) => e.type === 'final');
    const errors = events.filter((e) => e.type === 'error');

    expect(tokens).toHaveLength(4);
    expect(finals).toHaveLength(1);
    expect(errors).toHaveLength(0);
    const finalPayload = (finals[0] as { payload: { answer: string } }).payload;
    expect(finalPayload.answer).toBe('You have 3 sick cows.');
  });

  it('passes through history turns to the SDK messages array', async () => {
    streamScript = [
      mkDelta(
        '```json\n' +
          JSON.stringify({
            answer: 'ok',
            citations: [],
            confidence: 'low',
            refusedReason: 'NO_GROUNDED_EVIDENCE',
          }) +
          '\n```',
      ),
    ];
    await collectEvents(
      streamAnswer({
        question: 'follow up',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval([]),
        history: [
          { role: 'user', content: 'prev q' },
          { role: 'assistant', content: 'prev a' },
        ],
      }),
    );
    const call = streamMock.mock.calls[0][0] as {
      messages: Array<{
        role: string;
        content: string | Array<{ type: string; text: string }>;
      }>;
    };
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0]).toEqual({ role: 'user', content: 'prev q' });
    expect(call.messages[1]).toEqual({ role: 'assistant', content: 'prev a' });
    // Final turn: [retrieval data block, question] — the question is the
    // trailing text block (S19 moved retrieval into the user turn).
    const lastTurn = call.messages[2];
    expect(lastTurn.role).toBe('user');
    const blocks = lastTurn.content as Array<{ type: string; text: string }>;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[blocks.length - 1].text).toBe('follow up');
  });
});

describe('streamAnswer — error frames', () => {
  it('missing ANTHROPIC_API_KEY yields EINSTEIN_ANSWER_NO_KEY and returns', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const events = await collectEvents(
      streamAnswer({
        question: 'q',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval([]),
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].code).toBe('EINSTEIN_ANSWER_NO_KEY');
    // SDK never invoked when key missing.
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('SDK throw yields EINSTEIN_ANSWER_API_ERROR', async () => {
    streamShouldThrow = new Error('upstream 500');
    const events = await collectEvents(
      streamAnswer({
        question: 'q',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval([]),
      }),
    );
    const err = events.find((e) => e.type === 'error') as
      | { code: string; message: string }
      | undefined;
    expect(err?.code).toBe('EINSTEIN_ANSWER_API_ERROR');
  });

  it('citation fabrication (entityId not in retrieval) yields EINSTEIN_CITATION_FABRICATION', async () => {
    const tailJson = JSON.stringify({
      answer: 'Based on obs-fake.',
      citations: [
        {
          entityType: 'observation',
          entityId: 'obs-fake-never-retrieved',
          quote: 'x',
          relevance: 'direct',
        },
      ],
      confidence: 'medium',
    });
    streamScript = [mkDelta('narr\n```json\n' + tailJson + '\n```')];

    const events = await collectEvents(
      streamAnswer({
        question: 'q',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval(['obs-real-1', 'obs-real-2']),
      }),
    );
    const err = events.find((e) => e.type === 'error') as
      | { code: string }
      | undefined;
    const finals = events.filter((e) => e.type === 'final');
    expect(err?.code).toBe('EINSTEIN_CITATION_FABRICATION');
    expect(finals).toHaveLength(0);
  });

  it('refusal with zero citations passes the grounding gate — final frame carries refusedReason', async () => {
    const tailJson = JSON.stringify({
      answer: 'I cannot answer — no grounded evidence.',
      citations: [],
      confidence: 'low',
      refusedReason: 'NO_GROUNDED_EVIDENCE',
    });
    streamScript = [mkDelta('```json\n' + tailJson + '\n```')];

    const events = await collectEvents(
      streamAnswer({
        question: 'q',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval([]),
      }),
    );
    const finals = events.filter((e) => e.type === 'final');
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(0);
    expect(finals).toHaveLength(1);
    const payload = (finals[0] as { payload: { refusedReason?: string } }).payload;
    expect(payload.refusedReason).toBe('NO_GROUNDED_EVIDENCE');
  });

  it('S20: fabricated citation is rejected even when refusedReason is set', async () => {
    const tailJson = JSON.stringify({
      answer: 'Partially refusing, but here is obs-fake anyway.',
      citations: [
        {
          entityType: 'observation',
          entityId: 'obs-fake-never-retrieved',
          quote: 'x',
          relevance: 'direct',
        },
      ],
      confidence: 'low',
      refusedReason: 'NO_GROUNDED_EVIDENCE',
    });
    streamScript = [mkDelta('```json\n' + tailJson + '\n```')];

    const events = await collectEvents(
      streamAnswer({
        question: 'q',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval(['obs-real-1']),
      }),
    );
    const err = events.find((e) => e.type === 'error') as
      | { code: string }
      | undefined;
    const finals = events.filter((e) => e.type === 'final');
    expect(err?.code).toBe('EINSTEIN_CITATION_FABRICATION');
    expect(finals).toHaveLength(0);
  });

  it('S20: non-empty factual answer with zero citations is rejected as ungrounded', async () => {
    const tailJson = JSON.stringify({
      answer: 'Your cows are definitely all healthy, trust me.',
      citations: [],
      confidence: 'high',
    });
    streamScript = [mkDelta('```json\n' + tailJson + '\n```')];

    const events = await collectEvents(
      streamAnswer({
        question: 'q',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval(['obs-real-1', 'obs-real-2']),
      }),
    );
    const err = events.find((e) => e.type === 'error') as
      | { code: string }
      | undefined;
    const finals = events.filter((e) => e.type === 'final');
    expect(err?.code).toBe('EINSTEIN_ANSWER_UNGROUNDED');
    expect(finals).toHaveLength(0);
  });

  it('S20: free-generation over an empty retrieval set is rejected as ungrounded', async () => {
    const tailJson = JSON.stringify({
      answer: 'Generally, mastitis is treated with antibiotics.',
      citations: [],
      confidence: 'medium',
    });
    streamScript = [mkDelta('```json\n' + tailJson + '\n```')];

    const events = await collectEvents(
      streamAnswer({
        question: 'q',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval([]),
      }),
    );
    const err = events.find((e) => e.type === 'error') as
      | { code: string }
      | undefined;
    const finals = events.filter((e) => e.type === 'final');
    expect(err?.code).toBe('EINSTEIN_ANSWER_UNGROUNDED');
    expect(finals).toHaveLength(0);
  });

  it('invalid tail JSON yields EINSTEIN_ANSWER_INVALID_JSON', async () => {
    streamScript = [mkDelta('no json at all here')];
    const events = await collectEvents(
      streamAnswer({
        question: 'q',
        assistantName: 'Einstein',
        methodology: null,
        retrieval: mkRetrieval([]),
      }),
    );
    const err = events.find((e) => e.type === 'error') as
      | { code: string }
      | undefined;
    expect(err?.code).toBe('EINSTEIN_ANSWER_INVALID_JSON');
  });
});

describe('parseAnswerJson — pure helper', () => {
  it('parses a well-formed fenced JSON block', () => {
    const raw =
      'narr narr narr\n```json\n' +
      JSON.stringify({
        answer: 'hi',
        citations: [
          {
            entityType: 'camp',
            entityId: 'c1',
            quote: 'q',
            relevance: 'supporting',
          },
        ],
        confidence: 'medium',
      }) +
      '\n```';
    const parsed = parseAnswerJson(raw);
    expect(parsed.answer).toBe('hi');
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0].entityId).toBe('c1');
    expect(parsed.confidence).toBe('medium');
  });

  it('throws EinsteinAnswerError on missing confidence', () => {
    const raw =
      '```json\n' +
      JSON.stringify({ answer: 'x', citations: [] }) +
      '\n```';
    try {
      parseAnswerJson(raw);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EinsteinAnswerError);
      expect((err as InstanceType<typeof EinsteinAnswerError>).code).toBe(
        'EINSTEIN_ANSWER_INVALID_JSON',
      );
    }
  });

  it('throws on invalid JSON contents', () => {
    expect(() => parseAnswerJson('```json\nnot json\n```')).toThrow(
      EinsteinAnswerError,
    );
  });

  it('drops citations with empty entityId but keeps the rest', () => {
    const raw =
      '```json\n' +
      JSON.stringify({
        answer: 'x',
        citations: [
          { entityType: 'animal', entityId: '', quote: '', relevance: 'direct' },
          { entityType: 'animal', entityId: 'a1', quote: '', relevance: 'direct' },
        ],
        confidence: 'high',
      }) +
      '\n```';
    const parsed = parseAnswerJson(raw);
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0].entityId).toBe('a1');
  });
});
