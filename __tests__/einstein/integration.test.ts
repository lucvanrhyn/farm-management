/**
 * @vitest-environment node
 *
 * __tests__/einstein/integration.test.ts — Phase L Wave 3F integration tests.
 *
 * Exercises the full ask→feedback roundtrip with mocked externals. Extends the
 * patterns established in ask-route.test.ts without duplicating its coverage.
 *
 * Covered additional behaviours:
 *   1. Happy-path roundtrip: ask → accumulate queryLogId from final frame →
 *      feedback POST upserts RagQueryLog.feedback.
 *   2. Basic tier → 403 EINSTEIN_TIER_LOCKED (integration layer, not just unit).
 *   3. Budget exhausted → stampCostBeforeSend throws EINSTEIN_BUDGET_EXHAUSTED →
 *      SSE error frame with resetsAt → client receives typed code.
 *   4. Citation fabrication: model returns citation entityId NOT in
 *      retrieval.chunks → answer validator emits EINSTEIN_CITATION_FABRICATION →
 *      SSE error frame → RagQueryLog written with errorCode.
 *   5. RagQueryLog row is written even on error paths (finally block invariant).
 *   6. Feedback route: 404 when queryLogId does not exist (P2025 handling).
 *   7. Feedback route: 400 for invalid feedback value.
 *   8. Feedback route: 403 for Basic-tier farm.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Session mock ──────────────────────────────────────────────────────────────

const mockGetServerSession = vi.fn();
vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock('next-auth/providers/credentials', () => ({
  default: () => ({ id: 'credentials' }),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

// ── Meta DB / tier ────────────────────────────────────────────────────────────

const mockGetFarmCreds = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  getFarmCreds: (...args: unknown[]) => mockGetFarmCreds(...args),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockFarmSettingsFindFirst = vi.fn();
const mockRagQueryLogCreate = vi.fn();
const mockRagQueryLogUpdate = vi.fn();

const mockPrisma = {
  farmSettings: { findFirst: mockFarmSettingsFindFirst },
  ragQueryLog: { create: mockRagQueryLogCreate, update: mockRagQueryLogUpdate },
};

const mockGetPrismaForSlugWithAuth = vi.fn();
const mockGetPrismaWithAuth = vi.fn();
const mockGetPrismaForFarm = vi.fn();

vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForSlugWithAuth: (...args: unknown[]) =>
    mockGetPrismaForSlugWithAuth(...args),
  getPrismaWithAuth: (...args: unknown[]) => mockGetPrismaWithAuth(...args),
  getPrismaForFarm: (...args: unknown[]) => mockGetPrismaForFarm(...args),
}));

// ── Einstein module mocks ─────────────────────────────────────────────────────

const mockAssertWithinBudget = vi.fn();
const mockStampCostBeforeSend = vi.fn();
const mockPlanQuery = vi.fn();
const mockRetrieveSemantic = vi.fn();
const mockRetrieveStructured = vi.fn();
const mockStreamAnswer = vi.fn();

vi.mock('@/lib/einstein/budget', async () => {
  const actual = await vi.importActual<typeof import('@/lib/einstein/budget')>(
    '@/lib/einstein/budget',
  );
  return {
    ...actual,
    assertWithinBudget: (...args: unknown[]) => mockAssertWithinBudget(...args),
    stampCostBeforeSend: (...args: unknown[]) => mockStampCostBeforeSend(...args),
    EinsteinBudgetError: actual.EinsteinBudgetError,
  };
});

vi.mock('@/lib/einstein/query-planner', async () => {
  const actual = await vi.importActual<typeof import('@/lib/einstein/query-planner')>(
    '@/lib/einstein/query-planner',
  );
  return {
    ...actual,
    planQuery: (...args: unknown[]) => mockPlanQuery(...args),
    QueryPlannerError: actual.QueryPlannerError,
  };
});

vi.mock('@/lib/einstein/retriever', async () => {
  const actual = await vi.importActual<typeof import('@/lib/einstein/retriever')>(
    '@/lib/einstein/retriever',
  );
  return {
    ...actual,
    retrieve: {
      semantic: (...args: unknown[]) => mockRetrieveSemantic(...args),
      structured: (...args: unknown[]) => mockRetrieveStructured(...args),
    },
    RetrieverError: actual.RetrieverError,
  };
});

vi.mock('@/lib/einstein/answer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/einstein/answer')>(
    '@/lib/einstein/answer',
  );
  return {
    ...actual,
    streamAnswer: (...args: unknown[]) => mockStreamAnswer(...args),
    EinsteinAnswerError: actual.EinsteinAnswerError,
  };
});

// Import routes AFTER mocks.
const { POST: askPOST } = await import('@/app/api/einstein/ask/route');
const { POST: feedbackPOST } = await import('@/app/api/einstein/feedback/route');
const { EinsteinBudgetError } = await import('@/lib/einstein/budget');

// ── Shared test fixtures ──────────────────────────────────────────────────────

const validSession = {
  user: {
    id: 'user-abc',
    email: 'farmer@example.com',
    farms: [{ slug: 'delta-livestock', role: 'farm_admin' }],
  },
};

const advancedCreds = { tursoUrl: 'libsql://x', tursoAuthToken: 'tkn', tier: 'advanced' };
const basicCreds = { ...advancedCreds, tier: 'basic' };

function makeAskRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/einstein/ask', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeFeedbackRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/einstein/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readSSE(resp: Response): Promise<string> {
  if (!resp.body) return '';
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

async function* buildStreamEvents(events: Array<Record<string, unknown>>) {
  for (const ev of events) yield ev;
}

function setupAskHappyPath() {
  mockGetServerSession.mockResolvedValue(validSession);
  mockGetFarmCreds.mockResolvedValue(advancedCreds);
  mockGetPrismaForSlugWithAuth.mockResolvedValue({
    prisma: mockPrisma,
    slug: 'delta-livestock',
    role: 'farm_admin',
  });
  mockAssertWithinBudget.mockResolvedValue({ tier: 'advanced', remainingZar: 75 });
  mockStampCostBeforeSend.mockResolvedValue(undefined);
  mockPlanQuery.mockResolvedValue({ rewrittenQuery: 'q', isStructuredQuery: false });
  mockRetrieveSemantic.mockResolvedValue({
    chunks: [
      {
        entityType: 'observation',
        entityId: 'obs-integration-1',
        text: 'treatment record',
        score: 0.88,
        sourceUpdatedAt: new Date('2026-04-10'),
      },
    ],
    latencyMs: 18,
  });
  mockFarmSettingsFindFirst.mockResolvedValue({
    aiSettings: JSON.stringify({ assistantName: 'FarmBot', methodology: { tier: 'advanced' } }),
  });
  mockRagQueryLogCreate.mockResolvedValue({ id: 'log-integration-1' });
}

function resetAll() {
  mockGetServerSession.mockReset();
  mockGetFarmCreds.mockReset();
  mockGetPrismaForSlugWithAuth.mockReset();
  mockGetPrismaWithAuth.mockReset();
  mockGetPrismaForFarm.mockReset();
  mockAssertWithinBudget.mockReset();
  mockStampCostBeforeSend.mockReset();
  mockPlanQuery.mockReset();
  mockRetrieveSemantic.mockReset();
  mockRetrieveStructured.mockReset();
  mockStreamAnswer.mockReset();
  mockFarmSettingsFindFirst.mockReset();
  mockRagQueryLogCreate.mockReset();
  mockRagQueryLogUpdate.mockReset();
}

beforeEach(() => resetAll());

// ── Test 1: Full ask → feedback roundtrip ─────────────────────────────────────

describe('Integration: full ask → feedback roundtrip', () => {
  it('streams final frame with queryLogId; feedback POST records on the same log row', async () => {
    setupAskHappyPath();

    const FINAL_PAYLOAD = {
      answer: 'Bonnie received Ivermectin on 10 April.',
      citations: [
        {
          entityType: 'observation',
          entityId: 'obs-integration-1',
          quote: 'Ivermectin injectable 5ml',
          relevance: 'direct',
        },
      ],
      confidence: 'high',
    };

    mockStreamAnswer.mockImplementation(() =>
      buildStreamEvents([
        { type: 'token', text: 'Bonnie received ' },
        { type: 'token', text: 'Ivermectin on 10 April.' },
        { type: 'final', payload: FINAL_PAYLOAD },
      ]),
    );

    // Step A: POST /api/einstein/ask
    const askResp = await askPOST(
      makeAskRequest({ question: 'What treatment did Bonnie get?', farmSlug: 'delta-livestock' }),
    );
    expect(askResp.status).toBe(200);
    const sseBody = await readSSE(askResp);
    expect(sseBody).toMatch(/event: final/);

    // The RagQueryLog was written
    expect(mockRagQueryLogCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockRagQueryLogCreate.mock.calls[0][0] as {
      data: { answerText: string; errorCode: null };
    };
    expect(createArgs.data.answerText).toBe('Bonnie received Ivermectin on 10 April.');
    expect(createArgs.data.errorCode).toBeNull();

    // Step B: POST /api/einstein/feedback for the same log row
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(advancedCreds);
    mockGetPrismaWithAuth.mockResolvedValue({
      prisma: mockPrisma,
      slug: 'delta-livestock',
    });
    mockRagQueryLogUpdate.mockResolvedValue({ id: 'log-integration-1' });

    const feedbackResp = await feedbackPOST(
      makeFeedbackRequest({
        queryLogId: 'log-integration-1',
        feedback: 'up',
        note: 'Correct and well-cited',
      }),
    );
    expect(feedbackResp.status).toBe(200);
    const feedbackJson = await feedbackResp.json();
    expect(feedbackJson.success).toBe(true);

    // Verify update was called with correct feedback value
    expect(mockRagQueryLogUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockRagQueryLogUpdate.mock.calls[0][0] as {
      where: { id: string };
      data: { feedback: string; feedbackNote: string };
    };
    expect(updateCall.where.id).toBe('log-integration-1');
    expect(updateCall.data.feedback).toBe('up');
    expect(updateCall.data.feedbackNote).toBe('Correct and well-cited');
  });
});

// ── Test 2: Tier lock (integration layer) ─────────────────────────────────────

describe('Integration: tier lock', () => {
  it('returns 403 EINSTEIN_TIER_LOCKED for Basic tier (integration, not mocked at budget level)', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(basicCreds);

    const resp = await askPOST(
      makeAskRequest({ question: 'Is my herd healthy?', farmSlug: 'delta-livestock' }),
    );
    expect(resp.status).toBe(403);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_TIER_LOCKED');

    // Budget and stream should never have been touched for a locked tier
    expect(mockAssertWithinBudget).not.toHaveBeenCalled();
    expect(mockStreamAnswer).not.toHaveBeenCalled();
  });
});

// ── Test 3: Budget exhausted → error frame ────────────────────────────────────

describe('Integration: budget exhausted via stampCostBeforeSend', () => {
  it('returns 500 error when stampCostBeforeSend throws EINSTEIN_BUDGET_EXHAUSTED', async () => {
    // assertWithinBudget passes (budget looks OK before stamp)
    // stampCostBeforeSend throws (race: budget consumed between check and stamp)
    setupAskHappyPath();
    const budgetErr = new EinsteinBudgetError(
      'EINSTEIN_BUDGET_EXHAUSTED',
      'Budget just expired',
      '2026-05-01T00:00:00.000Z',
    );
    mockStampCostBeforeSend.mockRejectedValue(budgetErr);

    const resp = await askPOST(
      makeAskRequest({ question: 'How are my animals?', farmSlug: 'delta-livestock' }),
    );
    // stampCostBeforeSend error returns 500 (not 429 — the budget was ok when checked)
    expect(resp.status).toBe(500);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_BUDGET_EXHAUSTED');
    expect(json.resetsAt).toBe('2026-05-01T00:00:00.000Z');

    // streamAnswer must not have been called — we short-circuit before the LLM
    expect(mockStreamAnswer).not.toHaveBeenCalled();
  });
});

// ── Test 4: Citation fabrication → SSE error frame ───────────────────────────

describe('Integration: citation fabrication detection', () => {
  it('emits EINSTEIN_CITATION_FABRICATION error frame and writes RagQueryLog with errorCode', async () => {
    setupAskHappyPath();
    // The model returns a citation for an entityId NOT in the retrieved chunks
    mockStreamAnswer.mockImplementation(() =>
      buildStreamEvents([
        { type: 'token', text: 'Some answer...' },
        {
          type: 'error',
          code: 'EINSTEIN_CITATION_FABRICATION',
          message: 'Citation entityId fabricated-entity-999 not in retrieval chunks',
        },
      ]),
    );

    const resp = await askPOST(
      makeAskRequest({ question: 'Tell me about camp 3', farmSlug: 'delta-livestock' }),
    );
    expect(resp.status).toBe(200); // SSE always starts with 200
    const body = await readSSE(resp);
    expect(body).toMatch(/event: error/);
    expect(body).toMatch(/EINSTEIN_CITATION_FABRICATION/);

    // RagQueryLog must be written with errorCode even on fabrication error
    expect(mockRagQueryLogCreate).toHaveBeenCalledTimes(1);
    const logArgs = mockRagQueryLogCreate.mock.calls[0][0] as {
      data: { errorCode: string; answerText: null };
    };
    expect(logArgs.data.errorCode).toBe('EINSTEIN_CITATION_FABRICATION');
    expect(logArgs.data.answerText).toBeNull();
  });
});

// ── Test 5: RagQueryLog written on all error paths ────────────────────────────

describe('Integration: RagQueryLog written on all error paths (finally block)', () => {
  it('writes RagQueryLog even when streamAnswer throws an unexpected error', async () => {
    setupAskHappyPath();
    // Simulate an unexpected throw from streamAnswer (not a typed error frame)
    mockStreamAnswer.mockImplementation(async function* () {
      yield { type: 'token', text: 'Starting...' };
      throw new Error('Unexpected Anthropic network error');
    });

    const resp = await askPOST(
      makeAskRequest({ question: 'What is my LSU count?', farmSlug: 'delta-livestock' }),
    );
    // Response is 200 + SSE (stream opened), error embedded in SSE body
    expect(resp.status).toBe(200);
    const body = await readSSE(resp);
    expect(body).toMatch(/event: error/);
    expect(body).toMatch(/EINSTEIN_STREAM_FAILED/);

    // RagQueryLog must still be written
    expect(mockRagQueryLogCreate).toHaveBeenCalledTimes(1);
    const logArgs = mockRagQueryLogCreate.mock.calls[0][0] as {
      data: { errorCode: string };
    };
    expect(logArgs.data.errorCode).toBe('EINSTEIN_STREAM_FAILED');
  });
});

// ── Test 6: Feedback 404 for missing queryLogId ───────────────────────────────

describe('Integration: feedback route edge cases', () => {
  it('returns 404 EINSTEIN_FEEDBACK_NOT_FOUND when Prisma throws P2025', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(advancedCreds);
    mockGetPrismaWithAuth.mockResolvedValue({
      prisma: mockPrisma,
      slug: 'delta-livestock',
    });
    // Simulate Prisma P2025 — record not found
    mockRagQueryLogUpdate.mockRejectedValue({ code: 'P2025', message: 'Record not found' });

    const resp = await feedbackPOST(
      makeFeedbackRequest({ queryLogId: 'nonexistent-id', feedback: 'down' }),
    );
    expect(resp.status).toBe(404);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_FEEDBACK_NOT_FOUND');
  });

  it('returns 400 EINSTEIN_BAD_REQUEST for invalid feedback value', async () => {
    mockGetServerSession.mockResolvedValue(validSession);

    const resp = await feedbackPOST(
      makeFeedbackRequest({ queryLogId: 'log-1', feedback: 'sideways' }),
    );
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_BAD_REQUEST');
  });

  it('returns 403 EINSTEIN_TIER_LOCKED for Basic-tier farm on feedback route', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetPrismaWithAuth.mockResolvedValue({
      prisma: mockPrisma,
      slug: 'delta-livestock',
    });
    mockGetFarmCreds.mockResolvedValue(basicCreds);

    const resp = await feedbackPOST(
      makeFeedbackRequest({ queryLogId: 'log-1', feedback: 'up' }),
    );
    expect(resp.status).toBe(403);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_TIER_LOCKED');
  });
});

// ── Test 7: Ask with history parameter ───────────────────────────────────────

describe('Integration: ask with conversation history', () => {
  it('passes history to streamAnswer and handles well-formed history array', async () => {
    setupAskHappyPath();
    mockStreamAnswer.mockImplementation(() =>
      buildStreamEvents([
        {
          type: 'final',
          payload: {
            answer: 'Yes, 5 cattle were treated.',
            citations: [
              {
                entityType: 'observation',
                entityId: 'obs-integration-1',
                quote: 'treated 5 cattle',
                relevance: 'direct',
              },
            ],
            confidence: 'high',
          },
        },
      ]),
    );

    const resp = await askPOST(
      makeAskRequest({
        question: 'How many cattle were treated last month?',
        farmSlug: 'delta-livestock',
        history: [
          { role: 'user', content: 'What about the camps?' },
          { role: 'assistant', content: 'There are 8 camps.' },
        ],
      }),
    );
    expect(resp.status).toBe(200);
    await readSSE(resp);
    // streamAnswer was called once
    expect(mockStreamAnswer).toHaveBeenCalledTimes(1);
    // The call received the history array
    const streamCall = mockStreamAnswer.mock.calls[0][0] as {
      history: Array<{ role: string; content: string }>;
    };
    expect(streamCall.history).toHaveLength(2);
    expect(streamCall.history[0].role).toBe('user');
  });
});
