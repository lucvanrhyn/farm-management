/**
 * @vitest-environment node
 *
 * __tests__/app/ssr-gate-cluster2.test.tsx
 *
 * Regression guard for #105 Cluster 2 — the residual SSR pages that still
 * re-implemented the auth gate inline (`const s = await getSession(); if (!s)
 * redirect(`/${slug}/login`)`) instead of calling the lib/auth.ts helpers.
 *
 * After migration every one of these pages must:
 *   - redirect an unauthenticated visitor to `/login?next=<deep-link>` (via
 *     requireSession), NOT to the non-canonical `/${slug}/login` the inline
 *     gate produced; and
 *   - (admin/telemetry only) redirect a non-ADMIN to `/${slug}/home` via
 *     requireFarmAdmin, preserving its explicit page-level defense-in-depth.
 *
 * Pages covered:
 *   - app/[farmSlug]/admin/tasks/page.tsx              (requireSession)
 *   - app/[farmSlug]/admin/map/page.tsx                (requireSession)
 *   - app/[farmSlug]/admin/telemetry/page.tsx          (requireSession + requireFarmAdmin)
 *   - app/[farmSlug]/admin/map/route-today/page.tsx    (requireSession)
 *   - app/[farmSlug]/map/page.tsx                       (requireSession)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── redirect mock ─────────────────────────────────────────────────────────
const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

// ─── lib/auth mocks ────────────────────────────────────────────────────────
const requireSessionMock = vi.fn();
const requireFarmAdminMock = vi.fn();
const getSessionMock = vi.fn();
const getUserRoleForFarmMock = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireSession: requireSessionMock,
  requireFarmAdmin: requireFarmAdminMock,
  getSession: getSessionMock,
  getUserRoleForFarm: getUserRoleForFarmMock,
}));

// ─── Shared infrastructure mocks ──────────────────────────────────────────
const getFarmCredsMock = vi.fn();
const getPrismaForFarmMock = vi.fn();

vi.mock('@/lib/meta-db', () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));
vi.mock('@/lib/server/get-farm-mode', () => ({
  getFarmMode: vi.fn().mockResolvedValue('cattle'),
}));
// scoped() returns a fixed facade; crossSpecies() is a passthrough so the page's
// camp/animal reads land on whatever prisma mock the test provides.
vi.mock('@/lib/server/species-scoped-prisma', () => ({
  scoped: vi.fn(() => ({
    camp: { findMany: vi.fn().mockResolvedValue([]) },
    mob: { findMany: vi.fn().mockResolvedValue([]) },
  })),
  crossSpecies: vi.fn((p: unknown) => p),
}));
vi.mock('@/lib/server/camp-status', () => ({
  getLatestCampConditions: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('@/lib/tasks/route-today', () => ({
  buildRouteToday: vi.fn().mockResolvedValue({ pins: [], tour: [] }),
}));

// ─── Stub render-heavy / browser-only client components ────────────────────
// Importing the page modules pulls these in; the mapbox/maplibre ones throw at
// import time under the node test env, so they must be stubbed.
vi.mock('@/components/admin/UpgradePrompt', () => ({ default: () => null }));
vi.mock('@/app/_components/AdminPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/admin/TaskBoard', () => ({ TaskBoard: () => null }));
vi.mock('@/app/[farmSlug]/admin/map/AdminMapClient', () => ({ default: () => null }));
vi.mock('@/app/[farmSlug]/map/TenantMapClient', () => ({ default: () => null }));
vi.mock('@/components/map/RouteTodayMap', () => ({ default: () => null }));
vi.mock('@/components/camps/CampsEmptyState', () => ({ default: () => null }));

// ─── Helpers (mirror ssr-gate-migration.test.tsx) ──────────────────────────
function extractRedirect(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/^__REDIRECT__:(.+)$/);
  return match ? match[1] : null;
}

async function run<T>(
  fn: () => Promise<T>,
): Promise<{ redirected: string | null; result: T | null }> {
  try {
    const result = await fn();
    return { redirected: null, result };
  } catch (err) {
    const redirected = extractRedirect(err);
    if (redirected !== null) return { redirected, result: null };
    throw err;
  }
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'user-1',
      email: 'test@farm.test',
      name: 'Test User',
      username: 'testuser',
      farms: [
        { slug: 'acme', role: 'ADMIN', tier: 'advanced', displayName: 'Acme Farm', subscriptionStatus: 'active' },
      ],
      ...overrides,
    },
    expires: '2099-01-01',
  };
}

/** All five pages take only `{ params }` (telemetry/map/route-today) or also a
 * `searchParams` that is fine to leave undefined for these gate tests. */
function callPage(Page: (args: { params: Promise<{ farmSlug: string }> }) => Promise<unknown>) {
  return run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));
}

// ─── admin/tasks ───────────────────────────────────────────────────────────
describe('admin/tasks — requireSession gate (#105 cluster 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });
    const { default: Page } = await import('@/app/[farmSlug]/admin/tasks/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBe('/login?next=%2Facme%2Fadmin%2Ftasks');
  });

  it('renders for an authenticated session', async () => {
    requireSessionMock.mockResolvedValue(makeSession());
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
    getPrismaForFarmMock.mockResolvedValue({
      task: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const { default: Page } = await import('@/app/[farmSlug]/admin/tasks/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBeNull();
  });
});

// ─── admin/map ───────────────────────────────────────────────────────────
describe('admin/map — requireSession gate (#105 cluster 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });
    const { default: Page } = await import('@/app/[farmSlug]/admin/map/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBe('/login?next=%2Facme%2Fadmin%2Fmap');
  });

  it('renders for an authenticated session', async () => {
    requireSessionMock.mockResolvedValue(makeSession());
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
    getPrismaForFarmMock.mockResolvedValue({
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      camp: { findMany: vi.fn().mockResolvedValue([]) },
      animal: { groupBy: vi.fn().mockResolvedValue([]) },
    });
    const { default: Page } = await import('@/app/[farmSlug]/admin/map/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBeNull();
  });
});

// ─── admin/telemetry (requireSession + requireFarmAdmin) ───────────────────
describe('admin/telemetry — requireSession + requireFarmAdmin gate (#105 cluster 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });
    const { default: Page } = await import('@/app/[farmSlug]/admin/telemetry/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBe('/login?next=%2Facme%2Fadmin%2Ftelemetry');
  });

  it('redirects to /<farmSlug>/home when authenticated but not farm ADMIN', async () => {
    const session = makeSession();
    requireSessionMock.mockResolvedValue(session);
    requireFarmAdminMock.mockImplementation(() => { redirectMock('/acme/home'); });
    const { default: Page } = await import('@/app/[farmSlug]/admin/telemetry/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBe('/acme/home');
    expect(requireFarmAdminMock).toHaveBeenCalledWith(session, 'acme');
  });

  it('renders for a farm ADMIN', async () => {
    requireSessionMock.mockResolvedValue(makeSession());
    requireFarmAdminMock.mockResolvedValue(undefined);
    getPrismaForFarmMock.mockResolvedValue({
      importJob: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: {}, _avg: {} }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    const { default: Page } = await import('@/app/[farmSlug]/admin/telemetry/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBeNull();
  });
});

// ─── admin/map/route-today ─────────────────────────────────────────────────
describe('admin/map/route-today — requireSession gate (#105 cluster 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });
    const { default: Page } = await import('@/app/[farmSlug]/admin/map/route-today/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBe('/login?next=%2Facme%2Fadmin%2Fmap%2Froute-today');
  });

  it('renders for an authenticated session', async () => {
    requireSessionMock.mockResolvedValue(makeSession());
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
    getPrismaForFarmMock.mockResolvedValue({
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const { default: Page } = await import('@/app/[farmSlug]/admin/map/route-today/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBeNull();
  });
});

// ─── tenant map (/[farmSlug]/map) ──────────────────────────────────────────
describe('tenant map — requireSession gate (#105 cluster 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });
    const { default: Page } = await import('@/app/[farmSlug]/map/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBe('/login?next=%2Facme%2Fmap');
  });

  it('renders for an authenticated session', async () => {
    requireSessionMock.mockResolvedValue(makeSession());
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
    getPrismaForFarmMock.mockResolvedValue({
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      camp: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const { default: Page } = await import('@/app/[farmSlug]/map/page');
    const { redirected } = await callPage(Page);
    expect(redirected).toBeNull();
  });
});
