/**
 * @vitest-environment node
 *
 * __tests__/einstein/ask-route.test.ts — Phase L Wave 2B POST /api/einstein/ask.
 *
 * Covered behaviours:
 *   1. Unauth session → 401 EINSTEIN_UNAUTHENTICATED.
 *   2. Bad body (not JSON / missing question / missing slug) → 400.
 *   3. Farm not in meta DB → 404 EINSTEIN_FARM_NOT_FOUND.
 *   4. Basic tier → 403 EINSTEIN_TIER_LOCKED.
 *   5. Slug not in session.user.farms → 403 EINSTEIN_FORBIDDEN.
 *   6. Budget exhausted → 429 EINSTEIN_BUDGET_EXHAUSTED with resetsAt.
 *   7. Happy path (advanced tier, budget ok) → 200 + Content-Type text/event-stream.
 *      Stream frames include `event: token` and `event: final`. stampCostBeforeSend
 *      fires BEFORE the first streamAnswer event is consumed (mark-before-send
 *      ordering). RagQueryLog.create invoked with the estimated ZAR cost.
 *   8. Consulting tier happy path: budget check still runs (non-throwing).
 *   9. Stream-time citation fabrication → `event: error` frame in SSE output,
 *      no crash, RagQueryLog still written with errorCode.
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

const mockPrisma = {
  farmSettings: {
    findFirst: mockFarmSettingsFindFirst,
  },
  ragQueryLog: {
    create: mockRagQueryLogCreate,
  },
};

const mockGetPrismaForSlugWithAuth = vi.fn();
const mockGetPrismaForFarm = vi.fn();
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForSlugWithAuth: (...args: unknown[]) =>
    mockGetPrismaForSlugWithAuth(...args),
  getPrismaForFarm: (...args: unknown[]) => mockGetPrismaForFarm(...args),
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// ── Einstein module mocks ─────────────────────────────────────────────────────
const mockAssertWithinBudget = vi.fn();
const mockStampCostBeforeSend = vi.fn();
const mockPlanQuery = vi.fn();
const mockRetrieveSemantic = vi.fn();
const mockRetrieveStructured = vi.fn();
const mockStreamAnswer = vi.fn();

// Track call order across modules (mark-before-send invariant).
const callOrder: string[] = [];

vi.mock('@/lib/einstein/budget', async () => {
  // Pull EinsteinBudgetError class from the real module so `instanceof` checks
  // pass when the route narrows on it.
  const actual = await vi.importActual<typeof import('@/lib/einstein/budget')>(
    '@/lib/einstein/budget',
  );
  return {
    ...actual,
    assertWithinBudget: (...args: unknown[]) => {
      callOrder.push('assertWithinBudget');
      return mockAssertWithinBudget(...args);
    },
    stampCostBeforeSend: (...args: unknown[]) => {
      callOrder.push('stampCostBeforeSend');
      return mockStampCostBeforeSend(...args);
    },
    EinsteinBudgetError: actual.EinsteinBudgetError,
  };
});

vi.mock('@/lib/einstein/query-planner', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/einstein/query-planner')
  >('@/lib/einstein/query-planner');
  return {
    ...actual,
    planQuery: (...args: unknown[]) => {
      callOrder.push('planQuery');
      return mockPlanQuery(...args);
    },
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
      semantic: (...args: unknown[]) => {
        callOrder.push('retrieve.semantic');
        return mockRetrieveSemantic(...args);
      },
      structured: (...args: unknown[]) => {
        callOrder.push('retrieve.structured');
        return mockRetrieveStructured(...args);
      },
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
    streamAnswer: (...args: unknown[]) => {
      callOrder.push('streamAnswer');
      return mockStreamAnswer(...args);
    },
    EinsteinAnswerError: actual.EinsteinAnswerError,
  };
});

// Import AFTER every vi.mock — so the handler picks up all doubles.
const { POST } = await import('@/app/api/einstein/ask/route');
const { EinsteinBudgetError } = await import('@/lib/einstein/budget');

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/einstein/ask', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
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
  for (const ev of events) {
    yield ev;
  }
}

const validSession = {
  user: {
    id: 'user-1',
    email: 'farmer@example.com',
    farms: [{ slug: 'trio-b-boerdery', role: 'farm_admin' }],
  },
};

const advancedCreds = {
  tursoUrl: 'libsql://x',
  tursoAuthToken: 'tkn',
  tier: 'advanced',
};

const basicCreds = { ...advancedCreds, tier: 'basic' };
const consultingCreds = { ...advancedCreds, tier: 'consulting' };

function resetAll() {
  callOrder.length = 0;
  mockGetServerSession.mockReset();
  mockGetFarmCreds.mockReset();
  mockGetPrismaForSlugWithAuth.mockReset();
  mockGetPrismaForFarm.mockReset();
  mockAssertWithinBudget.mockReset();
  mockStampCostBeforeSend.mockReset();
  mockPlanQuery.mockReset();
  mockRetrieveSemantic.mockReset();
  mockRetrieveStructured.mockReset();
  mockStreamAnswer.mockReset();
  mockFarmSettingsFindFirst.mockReset();
  mockRagQueryLogCreate.mockReset();
}

function happyPathDefaults() {
  mockGetServerSession.mockResolvedValue(validSession);
  mockGetFarmCreds.mockResolvedValue(advancedCreds);
  mockGetPrismaForSlugWithAuth.mockResolvedValue({
    prisma: mockPrisma,
    slug: 'trio-b-boerdery',
    role: 'farm_admin',
  });
  mockAssertWithinBudget.mockResolvedValue({
    tier: 'advanced',
    remainingZar: 80,
  });
  mockStampCostBeforeSend.mockResolvedValue(undefined);
  mockPlanQuery.mockResolvedValue({
    rewrittenQuery: 'q',
    isStructuredQuery: false,
  });
  mockRetrieveSemantic.mockResolvedValue({
    chunks: [
      {
        entityType: 'observation',
        entityId: 'obs-1',
        text: 'cow sick',
        score: 0.92,
        sourceUpdatedAt: new Date('2026-04-01'),
      },
    ],
    latencyMs: 24,
  });
  mockFarmSettingsFindFirst.mockResolvedValue({
    aiSettings: JSON.stringify({
      methodology: { feed: 'veld-first' },
      assistantName: 'Professor',
    }),
  });
  mockRagQueryLogCreate.mockResolvedValue({ id: 'log-1' });
}

beforeEach(() => resetAll());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/einstein/ask — auth + validation', () => {
  it('returns 401 EINSTEIN_UNAUTHENTICATED when session is missing', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const resp = await POST(createRequest({ question: 'q', farmSlug: 'trio-b-boerdery' }));
    expect(resp.status).toBe(401);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_UNAUTHENTICATED');
  });

  it('returns 400 EINSTEIN_BAD_REQUEST when body is not valid JSON', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    const resp = await POST(createRequest('{not valid json'));
    expect(resp.status).toBe(400);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_BAD_REQUEST');
  });

  it('returns 400 when question is missing', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    const resp = await POST(createRequest({ farmSlug: 'trio-b-boerdery' }));
    expect(resp.status).toBe(400);
  });

  it('returns 400 when farmSlug is missing', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    const resp = await POST(createRequest({ question: 'q' }));
    expect(resp.status).toBe(400);
  });
});

describe('POST /api/einstein/ask — tier gate', () => {
  it('returns 404 EINSTEIN_FARM_NOT_FOUND when meta DB has no creds', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(null);
    const resp = await POST(
      createRequest({ question: 'q', farmSlug: 'ghost' }),
    );
    expect(resp.status).toBe(404);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_FARM_NOT_FOUND');
  });

  it('returns 403 EINSTEIN_TIER_LOCKED for basic tier', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(basicCreds);
    const resp = await POST(
      createRequest({ question: 'q', farmSlug: 'trio-b-boerdery' }),
    );
    expect(resp.status).toBe(403);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_TIER_LOCKED');
  });

  it('returns 403 EINSTEIN_FORBIDDEN when slug not in session farms', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(advancedCreds);
    mockGetPrismaForSlugWithAuth.mockResolvedValue({
      error: 'Forbidden',
      status: 403,
    });
    const resp = await POST(
      createRequest({ question: 'q', farmSlug: 'trio-b-boerdery' }),
    );
    expect(resp.status).toBe(403);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_FORBIDDEN');
  });
});

describe('POST /api/einstein/ask — budget branch', () => {
  it('returns 429 EINSTEIN_BUDGET_EXHAUSTED with resetsAt when budget tripped', async () => {
    mockGetServerSession.mockResolvedValue(validSession);
    mockGetFarmCreds.mockResolvedValue(advancedCreds);
    mockGetPrismaForSlugWithAuth.mockResolvedValue({
      prisma: mockPrisma,
      slug: 'trio-b-boerdery',
      role: 'farm_admin',
    });
    const err = new EinsteinBudgetError(
      'EINSTEIN_BUDGET_EXHAUSTED',
      'cap hit',
      '2026-05-01T00:00:00.000Z',
    );
    mockAssertWithinBudget.mockRejectedValue(err);

    const resp = await POST(
      createRequest({ question: 'q', farmSlug: 'trio-b-boerdery' }),
    );
    expect(resp.status).toBe(429);
    const json = await resp.json();
    expect(json.code).toBe('EINSTEIN_BUDGET_EXHAUSTED');
    expect(json.resetsAt).toBe('2026-05-01T00:00:00.000Z');
    // Crucially: the stream side of the pipeline was never reached.
    expect(mockStampCostBeforeSend).not.toHaveBeenCalled();
    expect(mockStreamAnswer).not.toHaveBeenCalled();
  });
});

describe('POST /api/einstein/ask — happy path (advanced)', () => {
  it('returns 200 + text/event-stream; stamps cost BEFORE stream; writes RagQueryLog', async () => {
    happyPathDefaults();
    mockStreamAnswer.mockImplementation((params) => {
      return buildStreamEvents([
        { type: 'token', text: 'Hello ' },
        { type: 'token', text: 'world' },
        {
          type: 'final',
          payload: {
            answer: 'Hello world',
            citations: [
              {
                entityType: 'observation',
                entityId: 'obs-1',
                quote: 'x',
                relevance: 'direct',
              },
            ],
            confidence: 'high',
          },
        },
      ]);
    });

    const resp = await POST(
      createRequest({
        question: 'any sick cows?',
        farmSlug: 'trio-b-boerdery',
      }),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('text/event-stream');

    const body = await readSSE(resp);
    expect(body).toMatch(/event: token/);
    expect(body).toMatch(/event: final/);
    expect(body).toMatch(/Hello world/);

    // MARK-BEFORE-SEND ordering: stampCostBeforeSend MUST precede the first
    // streamAnswer invocation. callOrder records these in program order.
    const stampIdx = callOrder.indexOf('stampCostBeforeSend');
    const streamIdx = callOrder.indexOf('streamAnswer');
    expect(stampIdx).toBeGreaterThan(-1);
    expect(streamIdx).toBeGreaterThan(-1);
    expect(stampIdx).toBeLessThan(streamIdx);

    // Stamped cost must be non-zero (pessimistic pre-debit).
    expect(mockStampCostBeforeSend).toHaveBeenCalledTimes(1);
    const stampedCost = mockStampCostBeforeSend.mock.calls[0][1] as number;
    expect(stampedCost).toBeGreaterThan(0);

    // RagQueryLog persisted with matching cost + model id.
    expect(mockRagQueryLogCreate).toHaveBeenCalledTimes(1);
    const logArgs = mockRagQueryLogCreate.mock.calls[0][0] as {
      data: {
        userId: string;
        costZar: number;
        modelId: string;
        errorCode: string | null;
        answerText: string | null;
      };
    };
    expect(logArgs.data.userId).toBe('user-1');
    expect(logArgs.data.costZar).toBeGreaterThan(0);
    expect(logArgs.data.modelId).toBe('claude-sonnet-4-6');
    expect(logArgs.data.errorCode).toBeNull();
    expect(logArgs.data.answerText).toBe('Hello world');
  });

  it('runs HYBRID retrieval (both structured + semantic) when plan is structured + has entity filter', async () => {
    // Pre-2026-04-21: was exclusive OR — structured short-circuited past
    // semantic detail chunks, so "how many hectares is camp X" mis-classified
    // as structured returned only aggregate counts and refused answerable
    // field-value lookups. Post-fix: both run in parallel and the answer LLM
    // picks whichever evidence fits.
    happyPathDefaults();
    mockPlanQuery.mockResolvedValue({
      rewrittenQuery: 'count animals',
      isStructuredQuery: true,
      entityTypeFilter: ['animal'],
    });
    mockRetrieveStructured.mockResolvedValue({
      chunks: [
        {
          entityType: 'animal',
          entityId: 'aggregate:animals',
          text: 'Total animals: 103. Active: 100.',
          score: 1,
          sourceUpdatedAt: new Date(),
        },
      ],
      latencyMs: 11,
    });
    mockRetrieveSemantic.mockResolvedValue({
      chunks: [
        {
          entityType: 'animal',
          entityId: 'animal-001',
          text: "animal — 'Bella' (cattle, Brangus): currently camp I-1",
          score: 0.9,
          sourceUpdatedAt: new Date(),
        },
      ],
      latencyMs: 15,
    });
    mockStreamAnswer.mockImplementation(() =>
      buildStreamEvents([
        {
          type: 'final',
          payload: { answer: '103', citations: [], confidence: 'high' },
        },
      ]),
    );

    const resp = await POST(
      createRequest({ question: 'how many animals', farmSlug: 'trio-b-boerdery' }),
    );
    await readSSE(resp);
    // Both retrievers are called — hybrid mode.
    expect(mockRetrieveStructured).toHaveBeenCalledTimes(1);
    expect(mockRetrieveSemantic).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/einstein/ask — consulting tier', () => {
  it('consulting tier still calls assertWithinBudget (which internally short-circuits)', async () => {
    happyPathDefaults();
    mockGetFarmCreds.mockResolvedValue(consultingCreds);
    mockAssertWithinBudget.mockResolvedValue({
      tier: 'consulting',
      remainingZar: Number.POSITIVE_INFINITY,
    });
    mockStreamAnswer.mockImplementation(() =>
      buildStreamEvents([
        {
          type: 'final',
          payload: { answer: 'ok', citations: [], confidence: 'low' },
        },
      ]),
    );

    const resp = await POST(
      createRequest({ question: 'q', farmSlug: 'trio-b-boerdery' }),
    );
    expect(resp.status).toBe(200);
    await readSSE(resp);
    // Route always runs the check; consulting handling lives inside budget.ts.
    expect(mockAssertWithinBudget).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/einstein/ask — stream-time errors', () => {
  it('citation fabrication mid-stream → error SSE frame + RagQueryLog with errorCode', async () => {
    happyPathDefaults();
    mockStreamAnswer.mockImplementation(() =>
      buildStreamEvents([
        { type: 'token', text: 'narr' },
        {
          type: 'error',
          code: 'EINSTEIN_CITATION_FABRICATION',
          message: 'fake id cited',
        },
      ]),
    );

    const resp = await POST(
      createRequest({ question: 'q', farmSlug: 'trio-b-boerdery' }),
    );
    expect(resp.status).toBe(200);
    const body = await readSSE(resp);
    expect(body).toMatch(/event: error/);
    expect(body).toMatch(/EINSTEIN_CITATION_FABRICATION/);

    expect(mockRagQueryLogCreate).toHaveBeenCalledTimes(1);
    const logArgs = mockRagQueryLogCreate.mock.calls[0][0] as {
      data: { errorCode: string | null; answerText: string | null };
    };
    expect(logArgs.data.errorCode).toBe('EINSTEIN_CITATION_FABRICATION');
    expect(logArgs.data.answerText).toBeNull();
  });
});
