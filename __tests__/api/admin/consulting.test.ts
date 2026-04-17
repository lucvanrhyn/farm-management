import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks --------------------------------------------------------------

const mockGetServerSession = vi.fn();
vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// next-auth providers live under next-auth/providers/credentials and are
// imported by lib/auth-options. Mock to avoid loading the real module chain.
vi.mock('next-auth/providers/credentials', () => ({
  default: () => ({ id: 'credentials' }),
}));

const mockIsPlatformAdmin = vi.fn();
const mockUpdateStatus = vi.fn();

vi.mock('@/lib/meta-db', () => ({
  isPlatformAdmin: (...args: unknown[]) => mockIsPlatformAdmin(...args),
  updateConsultingLeadStatus: (...args: unknown[]) => mockUpdateStatus(...args),
  VALID_LEAD_STATUSES: ['new', 'scoped', 'quoted', 'active', 'complete'],
}));

// --- Helpers ------------------------------------------------------------

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/consulting/lead-1', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = Promise.resolve({ id: 'lead-1' });

// --- Tests --------------------------------------------------------------

describe('PATCH /api/admin/consulting/[id]', () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockIsPlatformAdmin.mockReset();
    mockUpdateStatus.mockReset();
  });

  it('returns 401 when no session', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const { PATCH } = await import(
      '@/app/api/admin/consulting/[id]/route'
    );

    const res = await PATCH(makeReq({ status: 'scoped' }), { params });

    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not a platform admin', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'viewer@example.com' },
    });
    mockIsPlatformAdmin.mockResolvedValueOnce(false);
    const { PATCH } = await import(
      '@/app/api/admin/consulting/[id]/route'
    );

    const res = await PATCH(makeReq({ status: 'scoped' }), { params });

    expect(res.status).toBe(403);
  });

  it('returns 400 when status is missing or invalid', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'admin@example.com' },
    });
    mockIsPlatformAdmin.mockResolvedValue(true);
    const { PATCH } = await import(
      '@/app/api/admin/consulting/[id]/route'
    );

    const resMissing = await PATCH(makeReq({}), { params });
    expect(resMissing.status).toBe(400);

    const resBogus = await PATCH(
      makeReq({ status: 'banana' }),
      { params: Promise.resolve({ id: 'lead-1' }) },
    );
    expect(resBogus.status).toBe(400);
  });

  it('returns 404 when lead is not found', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'admin@example.com' },
    });
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    mockUpdateStatus.mockResolvedValueOnce({ ok: false, error: 'not found' });
    const { PATCH } = await import(
      '@/app/api/admin/consulting/[id]/route'
    );

    const res = await PATCH(makeReq({ status: 'scoped' }), { params });

    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid transition', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'admin@example.com' },
    });
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    mockUpdateStatus.mockResolvedValueOnce({
      ok: false,
      error: 'invalid transition',
    });
    const { PATCH } = await import(
      '@/app/api/admin/consulting/[id]/route'
    );

    const res = await PATCH(makeReq({ status: 'active' }), { params });

    expect(res.status).toBe(400);
  });

  it('returns 200 on a valid transition', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'admin@example.com' },
    });
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    mockUpdateStatus.mockResolvedValueOnce({ ok: true });
    const { PATCH } = await import(
      '@/app/api/admin/consulting/[id]/route'
    );

    const res = await PATCH(makeReq({ status: 'scoped' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(mockUpdateStatus).toHaveBeenCalledWith('lead-1', 'scoped');
  });
});
