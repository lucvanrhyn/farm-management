import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock getServerSession to return a valid session by default
vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: 'user-1', role: 'field_logger' } }),
}));

// Mock prisma before importing the route
const mockCreate = vi.fn().mockResolvedValue({ id: 'test-obs-id' });

vi.mock('@/lib/prisma', () => ({
  prisma: {
    observation: {
      create: mockCreate,
    },
  },
}));

describe('POST /api/observations', () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it('writes observation to database with correct fields', async () => {
    const { POST } = await import('@/app/api/observations/route');

    const body = {
      type: 'health_check',
      camp_id: 'A',
      animal_id: 'brangus-001',
      details: JSON.stringify({ status: 'healthy', notes: 'looks good' }),
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
        type: 'health_check',
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
