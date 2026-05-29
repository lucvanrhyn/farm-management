import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock getServerSession to return a valid session by default
vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: {
      id: 'user-1',
      email: 'user-1@example.com',
      role: 'field_logger',
      farms: [{ slug: 'test-farm-slug', role: 'field_logger' }],
    },
  }),
}));

// Mock prisma client methods used by the route
const mockCreate = vi.fn().mockResolvedValue({ id: 'test-obs-id' });
// Issue #491 — GET path: the `listObservations` domain op reads through the
// `crossSpecies()` door, which passes straight to `observation.findMany`.
const mockFindMany = vi.fn().mockResolvedValue([]);
// Phase A of #28: observations route now uses findFirst (campId is no longer
// globally unique under the composite UNIQUE on species+campId).
const mockCampFindFirst = vi.fn().mockResolvedValue({ campId: 'A' });
// Phase I.3 — observations POST now looks up Animal.species at write time
// to keep the denormalised column fresh.
const mockAnimalFindUnique = vi.fn().mockResolvedValue({ species: 'cattle' });

const mockPrisma = {
  observation: {
    create: mockCreate,
    findMany: mockFindMany,
  },
  camp: {
    findFirst: mockCampFindFirst,
  },
  animal: {
    findUnique: mockAnimalFindUnique,
  },
};

// Mock @/lib/prisma in case anything imports it directly
vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}));

// Mock farm-prisma so cookie/header resolution is bypassed in tests.
// Next 16 made cookies() async and request-scoped, which throws outside a
// request scope. Stubbing getPrismaWithAuth avoids that entirely.
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaWithAuth: vi.fn().mockResolvedValue({
    prisma: mockPrisma,
    slug: 'test-farm-slug',
    role: 'field_logger',
  }),
  getPrismaForRequest: vi.fn().mockResolvedValue({
    prisma: mockPrisma,
    slug: 'test-farm-slug',
  }),
  getPrismaForFarm: vi.fn().mockResolvedValue(mockPrisma),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// revalidatePath throws outside a request scope in Next 16. No-op it here.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Rate limit: always allow in tests (the real impl uses an in-memory map that
// could carry state between tests if we didn't stub it).
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 100 }),
}));

describe('POST /api/observations', () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it('writes observation to database with correct fields', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const body = {
      type: 'camp_check',
      camp_id: 'A',
      animal_id: 'brangus-001',
      details: JSON.stringify({ status: 'healthy' }),
      created_at: '2026-03-13T21:00:00.000Z',
    };

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'camp_check',
        campId: 'A',
        animalId: 'brangus-001',
      }),
    });
  });

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ details: 'incomplete' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when created_at is malformed', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      // Wave C (#156): use a valid `type` so the timestamp-parse error
      // is what surfaces. Pre-Wave-C this test passed by coincidence —
      // `health_check` is not in the allowlist so the old route returned
      // 400 "Invalid observation type" instead of 400 timestamp.
      body: JSON.stringify({ type: 'camp_check', camp_id: 'A', created_at: 'not-a-date' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });

  it('returns 422 when observation type is not in the allowlist', async () => {
    // Wave C (#156): the type allowlist is enforced in the domain op as a
    // typed business-rule error (`INVALID_TYPE`, 422). Pre-Wave-C this
    // returned 400 with a free-text message; the typed code lets offline
    // sync clients react deterministically.
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'not_a_real_type', camp_id: 'A' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ error: 'INVALID_TYPE' });
  });

  // Issue #484 — `details` lands in a NON-NULLABLE `String` Prisma column.
  // A non-string `details` previously flowed through `details ?? ""` into
  // Prisma and threw PrismaClientValidationError → 500. The create schema
  // must reject it at the boundary as a typed 400 (VALIDATION_FAILED).
  it.each([
    ['an object', { foo: 'bar' }],
    ['a number', 42],
    ['an array', ['a', 'b']],
    ['a boolean', true],
  ])('returns a typed 400 when details is %s (not a string)', async (_label, badDetails) => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'camp_check', camp_id: 'A', details: badDetails }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('VALIDATION_FAILED');
    expect(data.details?.fieldErrors?.details).toBeTruthy();
    // Critical: the bad value must NEVER have reached Prisma.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('accepts a valid string details (JSON-encoded payload)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({
        type: 'camp_check',
        camp_id: 'A',
        details: JSON.stringify({ status: 'healthy' }),
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('accepts an omitted details (undefined → empty string default)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'camp_check', camp_id: 'A' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('accepts an explicit null details (back-compat, → empty string default)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'camp_check', camp_id: 'A', details: null }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('returns 401 when unauthenticated', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'camp_check', camp_id: 'A' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  // Issue #492 (PRD #479 backlog) — first-class free-text `notes` (Path A).
  // The wire schema accepts an OPTIONAL `notes` string (independent of the
  // #484 `details` string contract) and forwards it into the create input,
  // which threads it onto the persisted row.
  it('forwards an optional notes string onto the created row', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({
        type: 'camp_check',
        camp_id: 'A',
        notes: 'coughing in camp 3',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ notes: 'coughing in camp 3' }),
    });
  });

  it('accepts an omitted notes (undefined → null on the row)', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'camp_check', camp_id: 'A' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ notes: null }),
    });
  });

  it.each([
    ['an object', { foo: 'bar' }],
    ['a number', 42],
    ['a boolean', true],
  ])('returns a typed 400 when notes is %s (not a string)', async (_label, badNotes) => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'camp_check', camp_id: 'A', notes: badNotes }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('VALIDATION_FAILED');
    expect(data.details?.fieldErrors?.notes).toBeTruthy();
    // The bad value must NEVER have reached Prisma.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns a typed 400 (NOTE_TOO_LONG) when notes exceeds the cap', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      // 2001 chars — one over the 2000-char cap.
      body: JSON.stringify({
        type: 'camp_check',
        camp_id: 'A',
        notes: 'x'.repeat(2001),
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('NOTE_TOO_LONG');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('GET /api/observations — opt-in ?species filter (#491)', () => {
  beforeEach(() => {
    mockFindMany.mockClear();
  });

  it('narrows the query to { species } when ?species=sheep is present', async () => {
    const { GET } = await import('@/app/api/observations/route');

    const req = new NextRequest(
      'http://localhost/api/observations?species=sheep',
      { method: 'GET' },
    );

    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledOnce();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { species: 'sheep' } }),
    );
  });

  // Issue #356 invariant — omitting ?species MUST stay the cross-species
  // rollup: the where has NO `species` key.
  it('preserves the cross-species default (no species key) when ?species is omitted', async () => {
    const { GET } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'GET',
    });

    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledOnce();
    const [call] = mockFindMany.mock.calls;
    expect(call[0].where).not.toHaveProperty('species');
  });
});
