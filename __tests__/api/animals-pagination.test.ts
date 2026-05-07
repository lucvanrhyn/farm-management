import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: {
      id: 'user-1',
      email: 'user-1@example.com',
      role: 'admin',
      farms: [{ slug: 'test-farm-slug', role: 'admin' }],
    },
  }),
}));

const mockFindMany = vi.fn();
const mockPrisma = {
  animal: { findMany: mockFindMany },
};

vi.mock('@/lib/farm-prisma', () => ({
  getPrismaWithAuth: vi.fn().mockResolvedValue({
    prisma: mockPrisma,
    slug: 'test-farm-slug',
    role: 'admin',
  }),

  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

function makeAnimals(ids: string[]) {
  return ids.map((id) => ({
    animalId: id,
    name: `Animal ${id}`,
    sex: 'Female',
    dateOfBirth: null,
    breed: 'Brangus',
    category: 'Cow',
    currentCamp: 'A',
    status: 'Active',
    motherId: null,
    fatherId: null,
    species: 'cattle',
    dateAdded: '2026-01-01',
  }));
}

describe('GET /api/animals — backward-compatible unpaginated mode', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('returns a bare array when no limit/cursor params are present', async () => {
    mockFindMany.mockResolvedValueOnce(makeAnimals(['001', '002', '003']));
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest('http://localhost/api/animals');
    const res = await GET(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(3);
    // Legacy ordering by [category, animalId] preserved.
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { status: 'Active' },
      orderBy: [{ category: 'asc' }, { animalId: 'asc' }],
    });
  });

  it('filters by camp/category/species/status without opting into pagination', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest(
      'http://localhost/api/animals?camp=A&category=Cow&species=cattle&status=all',
    );
    await GET(req, { params: Promise.resolve({}) });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        currentCamp: 'A',
        category: 'Cow',
        species: 'cattle',
      },
      orderBy: [{ category: 'asc' }, { animalId: 'asc' }],
    });
  });
});

describe('GET /api/animals — cursor pagination mode', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('returns { items, nextCursor, hasMore:false } on a single-batch result', async () => {
    mockFindMany.mockResolvedValueOnce(makeAnimals(['001', '002']));
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest('http://localhost/api/animals?limit=500');
    const res = await GET(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.items).toHaveLength(2);
    expect(data.hasMore).toBe(false);
    expect(data.nextCursor).toBeNull();

    // Paginated mode: take = limit + 1, order by animalId only.
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { status: 'Active' },
      orderBy: { animalId: 'asc' },
      take: 501,
    });
  });

  it('returns hasMore:true + nextCursor when server has a next batch', async () => {
    // take=3 (limit+1), so 3 rows means "there is a 3rd row beyond the limit-2 batch"
    mockFindMany.mockResolvedValueOnce(makeAnimals(['A', 'B', 'C']));
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest('http://localhost/api/animals?limit=2');
    const res = await GET(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(data.items).toHaveLength(2);
    expect(data.items.map((a: { animalId: string }) => a.animalId)).toEqual(['A', 'B']);
    expect(data.hasMore).toBe(true);
    expect(data.nextCursor).toBe('B');
  });

  it('applies cursor as a strict-gt filter on animalId', async () => {
    mockFindMany.mockResolvedValueOnce(makeAnimals(['D', 'E']));
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest('http://localhost/api/animals?limit=10&cursor=C');
    await GET(req, { params: Promise.resolve({}) });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { status: 'Active', animalId: { gt: 'C' } },
      orderBy: { animalId: 'asc' },
      take: 11,
    });
  });

  it('clamps limit to MAX_LIMIT (2000) when caller requests more', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest('http://localhost/api/animals?limit=99999');
    await GET(req, { params: Promise.resolve({}) });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2001 }),
    );
  });

  it('rejects a non-numeric limit with 400', async () => {
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest('http://localhost/api/animals?limit=abc');
    const res = await GET(req, { params: Promise.resolve({}) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/invalid limit/i);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('rejects a zero/negative limit with 400', async () => {
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest('http://localhost/api/animals?limit=0');
    const res = await GET(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('triggers pagination when only `cursor` is provided (no explicit limit)', async () => {
    mockFindMany.mockResolvedValueOnce(makeAnimals(['X']));
    const { GET } = await import('@/app/api/animals/route');

    const req = new NextRequest('http://localhost/api/animals?cursor=W');
    const res = await GET(req, { params: Promise.resolve({}) });
    const data = await res.json();

    // Paginated response shape, not an array.
    expect(Array.isArray(data)).toBe(false);
    expect(data).toHaveProperty('items');
    expect(data).toHaveProperty('nextCursor');
    expect(data).toHaveProperty('hasMore');
  });
});
