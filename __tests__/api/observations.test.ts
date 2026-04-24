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
const mockCampFindUnique = vi.fn().mockResolvedValue({ campId: 'A' });
// Phase I.3 — observations POST now looks up Animal.species at write time
// to keep the denormalised column fresh.
const mockAnimalFindUnique = vi.fn().mockResolvedValue({ species: 'cattle' });

const mockPrisma = {
  observation: {
    create: mockCreate,
  },
  camp: {
    findUnique: mockCampFindUnique,
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

    const res = await POST(req);
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

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when created_at is malformed', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'health_check', camp_id: 'A', created_at: 'not-a-date' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/observations/route');

    const req = new NextRequest('http://localhost/api/observations', {
      method: 'POST',
      body: JSON.stringify({ type: 'health_check', camp_id: 'A' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
