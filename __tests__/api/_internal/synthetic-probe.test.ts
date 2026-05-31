import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/_internal/synthetic-probe — PRD #128 gap #4 (issue #135).
 *
 * The probe is a PLATFORM-ADMIN-only, read-only health check that opens an
 * arbitrary tenant's DB and runs the shared count-reconciliation invariant
 * (`reconcileFromArrays` from `lib/reconcile/counts.ts`) against the real
 * dashboard read path (`getCachedFarmSummary` + `getCachedCampList`). It is
 * the runtime counterpart of the `count-reconciliation` integration test:
 * the same arithmetic that pins the bug at PR-time now answers "does this
 * live tenant still reconcile?".
 *
 * Auth is platform-admin (NOT mere farm-admin) because the endpoint reads
 * across tenant boundaries by `farmSlug` — a cross-tenant operation.
 */

// --- Mocks --------------------------------------------------------------

const mockGetServerSession = vi.fn();
vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// next-auth credentials provider is pulled in transitively by
// lib/auth-options; stub it so the real module chain never loads.
vi.mock('next-auth/providers/credentials', () => ({
  default: () => ({ id: 'credentials' }),
}));

const mockIsPlatformAdmin = vi.fn();
const mockGetFarmBySlug = vi.fn();
vi.mock('@/lib/meta-db', () => ({
  isPlatformAdmin: (...args: unknown[]) => mockIsPlatformAdmin(...args),
  getFarmBySlug: (...args: unknown[]) => mockGetFarmBySlug(...args),
}));

const mockGetCachedFarmSummary = vi.fn();
const mockGetCachedCampList = vi.fn();
vi.mock('@/lib/server/cached', () => ({
  getCachedFarmSummary: (...args: unknown[]) => mockGetCachedFarmSummary(...args),
  getCachedCampList: (...args: unknown[]) => mockGetCachedCampList(...args),
}));

// --- Helpers ------------------------------------------------------------

function makeReq(slug?: string): NextRequest {
  const url = slug
    ? `http://localhost/api/_internal/synthetic-probe?farmSlug=${encodeURIComponent(slug)}`
    : 'http://localhost/api/_internal/synthetic-probe';
  return new NextRequest(url, { method: 'GET' });
}

async function importGET() {
  const mod = await import('@/app/api/_internal/synthetic-probe/route');
  return mod.GET;
}

const ADMIN_SESSION = { user: { email: 'admin@example.com' } };

// A healthy tenant: summary.animalCount === sum(camps.animal_count).
function healthyFarmSummary() {
  return {
    farmName: 'Basson Boerdery',
    breed: 'Bonsmara',
    heroImageUrl: '/farm-hero.jpg',
    animalCount: 136,
    campCount: 2,
  };
}
function healthyCamps() {
  return [
    { camp_id: 'A', camp_name: 'Camp A', size_hectares: 10, water_source: null, geojson: null, color: null, animal_count: 71 },
    { camp_id: 'B', camp_name: 'Camp B', size_hectares: 12, water_source: null, geojson: null, color: null, animal_count: 65 },
  ];
}

// --- Tests --------------------------------------------------------------

describe('GET /api/_internal/synthetic-probe', () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockIsPlatformAdmin.mockReset();
    mockGetFarmBySlug.mockReset();
    mockGetCachedFarmSummary.mockReset();
    mockGetCachedCampList.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const GET = await importGET();

    const res = await GET(makeReq('basson'));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_REQUIRED');
    // No tenant DB was touched.
    expect(mockGetCachedFarmSummary).not.toHaveBeenCalled();
  });

  it('returns 403 when the user is not a platform admin', async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: 'farmer@example.com' } });
    mockIsPlatformAdmin.mockResolvedValueOnce(false);
    const GET = await importGET();

    const res = await GET(makeReq('basson'));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FORBIDDEN');
    expect(mockGetCachedFarmSummary).not.toHaveBeenCalled();
  });

  it('fails closed (403) when the platform-admin check throws', async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockIsPlatformAdmin.mockRejectedValueOnce(new Error('meta-db down'));
    const GET = await importGET();

    const res = await GET(makeReq('basson'));

    expect(res.status).toBe(403);
    expect(mockGetCachedFarmSummary).not.toHaveBeenCalled();
  });

  it('returns 400 when farmSlug is missing', async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    const GET = await importGET();

    const res = await GET(makeReq());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 when the tenant slug is not found', async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    mockGetFarmBySlug.mockResolvedValueOnce(null);
    const GET = await importGET();

    const res = await GET(makeReq('ghost-farm'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('TENANT_NOT_FOUND');
    // Never opened a tenant DB for a non-existent slug.
    expect(mockGetCachedFarmSummary).not.toHaveBeenCalled();
  });

  it('returns 200 ok:true for a healthy tenant (happy path)', async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    mockGetFarmBySlug.mockResolvedValueOnce({ id: 'farm-1', slug: 'basson' });
    mockGetCachedFarmSummary.mockResolvedValueOnce(healthyFarmSummary());
    mockGetCachedCampList.mockResolvedValueOnce(healthyCamps());
    const GET = await importGET();

    const res = await GET(makeReq('basson'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(body.tenant).toEqual({ farmSlug: 'basson', farmName: 'Basson Boerdery' });
    expect(body.reconciliation).toMatchObject({
      farmCount: 136,
      summedCount: 136,
      divergence: 0,
      ok: true,
      campCount: 2,
    });
    // No divergence detail on a healthy tenant.
    expect(body.reconciliation.divergenceDetail).toBeUndefined();
    // Read path was the real dashboard path, keyed by slug.
    expect(mockGetCachedFarmSummary).toHaveBeenCalledWith('basson');
    expect(mockGetCachedCampList).toHaveBeenCalledWith('basson');
  });

  it('returns 200 ok:false with divergenceDetail when counts disagree (PRD #128 pathology)', async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    mockGetFarmBySlug.mockResolvedValueOnce({ id: 'farm-1', slug: 'basson' });
    // Farm-level source of truth says 0, but camps sum to 136 — the exact
    // PRD #128 shape (admin overview .catch(()=>0) hides a thrown error).
    mockGetCachedFarmSummary.mockResolvedValueOnce({ ...healthyFarmSummary(), animalCount: 0 });
    mockGetCachedCampList.mockResolvedValueOnce(healthyCamps());
    const GET = await importGET();

    const res = await GET(makeReq('basson'));

    // Divergence is DATA, not an HTTP error — still 200.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.reconciliation.farmCount).toBe(0);
    expect(body.reconciliation.summedCount).toBe(136);
    expect(body.reconciliation.divergence).toBe(136);
    expect(body.reconciliation.ok).toBe(false);
    expect(body.reconciliation.divergenceDetail).toBeTruthy();
  });

  it('returns 200 ok:true for an empty tenant (0 animals / 0 camps)', async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    mockGetFarmBySlug.mockResolvedValueOnce({ id: 'farm-1', slug: 'fresh' });
    mockGetCachedFarmSummary.mockResolvedValueOnce({
      farmName: 'Fresh Farm',
      breed: 'Mixed',
      heroImageUrl: '/farm-hero.jpg',
      animalCount: 0,
      campCount: 0,
    });
    mockGetCachedCampList.mockResolvedValueOnce([]);
    const GET = await importGET();

    const res = await GET(makeReq('fresh'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconciliation).toMatchObject({
      farmCount: 0,
      summedCount: 0,
      divergence: 0,
      ok: true,
      campCount: 0,
    });
    expect(body.reconciliation.divergenceDetail).toBeUndefined();
  });

  it('returns 5xx with a typed error when the tenant DB is unreachable', async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockIsPlatformAdmin.mockResolvedValueOnce(true);
    mockGetFarmBySlug.mockResolvedValueOnce({ id: 'farm-1', slug: 'basson' });
    mockGetCachedFarmSummary.mockRejectedValueOnce(new Error('libsql: 401 unauthorized'));
    mockGetCachedCampList.mockResolvedValueOnce(healthyCamps());
    const GET = await importGET();

    const res = await GET(makeReq('basson'));

    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.json();
    expect(body.code).toBe('PROBE_FAILED');
    expect(typeof body.message).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });
});
