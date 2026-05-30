/**
 * @vitest-environment node
 *
 * __tests__/app/ssr-gate-migration.test.tsx
 *
 * Regression guard for #523: every SSR page/layout migrated from raw
 * getServerSession → requireSession/requireFarmAdmin/requirePlatformAdmin
 * must redirect unauthenticated visitors to `/login?next=<deep-link>`.
 *
 * Pages covered:
 *   - app/[farmSlug]/tools/rotation-planner/page.tsx
 *   - app/[farmSlug]/tools/tax/page.tsx
 *   - app/[farmSlug]/tools/break-even/page.tsx
 *   - app/[farmSlug]/tools/nvd/page.tsx
 *   - app/[farmSlug]/admin/finansies/page.tsx
 *   - app/[farmSlug]/admin/settings/tasks/page.tsx  (requireFarmAdmin)
 *   - app/[farmSlug]/admin/settings/alerts/page.tsx
 *   - app/[farmSlug]/admin/settings/map/page.tsx   (requireFarmAdmin)
 *   - app/[farmSlug]/subscribe/upgrade/page.tsx
 *   - app/subscribe/page.tsx                       (renders PublicPlanPicker; no redirect)
 *
 * Note: onboarding/layout.tsx has its own test in onboarding-layout.test.tsx.
 *       consulting/page.tsx has its own test in admin/consulting-page.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── redirect mock ─────────────────────────────────────────────────────────
const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});

// ─── requireSession / requireFarmAdmin / requirePlatformAdmin mocks ────────
const requireSessionMock = vi.fn();
const requireFarmAdminMock = vi.fn();
const requirePlatformAdminMock = vi.fn();
const getUserRoleForFarmMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

vi.mock('@/lib/auth', () => ({
  requireSession: requireSessionMock,
  requireFarmAdmin: requireFarmAdminMock,
  requirePlatformAdmin: requirePlatformAdminMock,
  getUserRoleForFarm: getUserRoleForFarmMock,
  getSession: getSessionMock,
}));

// ─── Shared infrastructure mocks ──────────────────────────────────────────
const getFarmCredsMock = vi.fn();
const getPrismaForFarmMock = vi.fn();

vi.mock('@/lib/meta-db', () => ({ getFarmCreds: getFarmCredsMock }));
vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForFarm: getPrismaForFarmMock,
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

// ─── Stub render-heavy client components ──────────────────────────────────
vi.mock('@/components/admin/UpgradePrompt', () => ({ default: () => null }));
vi.mock('@/components/rotation/RotationPlannerClient', () => ({ default: () => null }));
vi.mock('@/lib/server/rotation-engine', () => ({ getRotationStatusByCamp: vi.fn().mockResolvedValue({ camps: [] }) }));
vi.mock('@/lib/server/get-farm-mode', () => ({ getFarmMode: vi.fn().mockResolvedValue('cattle') }));
vi.mock('@/lib/server/species-scoped-prisma', () => ({
  scoped: vi.fn(() => ({
    camp: { findMany: vi.fn().mockResolvedValue([]) },
    mob: { findMany: vi.fn().mockResolvedValue([]) },
  })),
}));
vi.mock('@/components/tools/BreakEvenCalculator', () => ({ default: () => null }));
vi.mock('./It3PageClient', () => ({ default: () => null }));
vi.mock('@/components/admin/FinansiesClient', () => ({ default: () => null }));
vi.mock('@/components/admin/FinancialAnalyticsPanelLazy', () => ({ default: () => null }));
vi.mock('@/components/admin/FinancialChartsSection', () => ({ default: () => null }));
vi.mock('@/components/admin/FinancialKPISection', () => ({ default: () => null }));
vi.mock('@/components/admin/BudgetVsActualSection', () => ({ default: () => null }));
vi.mock('@/components/admin/CostOfGainSection', () => ({ default: () => null }));
vi.mock('@/components/admin/ClearSectionButton', () => ({ default: () => null }));
vi.mock('@/components/admin/ExportButton', () => ({ default: () => null }));
vi.mock('@/components/admin/DateRangePicker', () => ({ default: () => null }));
vi.mock('@/lib/constants/default-categories', () => ({ DEFAULT_CATEGORIES: [] }));
vi.mock('@/app/_components/AdminPage', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/admin/tasks/TaskSettingsClient', () => ({ default: () => null }));
vi.mock('@/lib/farm-settings/defaults', () => ({
  DEFAULT_TASK_SETTINGS: { defaultReminderOffset: 1, autoObservation: false, horizonDays: 30 },
}));
vi.mock('@/components/admin/AlertSettingsForm', () => ({ default: () => null }));
vi.mock('@/components/admin/map/MapSettingsClient', () => ({ default: () => null }));
vi.mock('@/lib/farm-settings/defaults', () => ({
  DEFAULT_MAP_SETTINGS: { eskomAreaId: null },
  DEFAULT_TASK_SETTINGS: { defaultReminderOffset: 1, autoObservation: false, horizonDays: 30 },
}));
vi.mock('@/lib/map/fmd-zones', () => ({
  computeFarmCentroid: vi.fn().mockReturnValue(null),
  pointInFmdZone: vi.fn().mockReturnValue(null),
}));
vi.mock('@/lib/tier', () => ({}));
// Subscribe/upgrade mocks
vi.mock('@/lib/pricing/farm-lsu', () => ({ computeFarmLsu: vi.fn().mockResolvedValue(100) }));
vi.mock('@/lib/pricing/calculator', () => ({
  quoteTier: vi.fn().mockReturnValue({
    annualZar: 1200, monthlyZar: 120,
    annualFormatted: 'R1,200', monthlyFormatted: 'R120',
  }),
}));
vi.mock('@/lib/payfast', () => ({
  buildSubscriptionParams: vi.fn().mockReturnValue({}),
  generateSignature: vi.fn().mockReturnValue('sig'),
  PAYFAST_URL: 'https://sandbox.payfast.co.za/eng/process',
}));
// Subscribe page mocks
vi.mock('./PublicPlanPicker', () => ({ default: () => null }));
vi.mock('@/lib/meta-db', () => ({
  getFarmCreds: getFarmCredsMock,
  getFarmSubscription: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/pricing/compute-total-lsu', () => ({
  BASIC_DISPLAY_MONTHLY_ZAR: 100,
  ADVANCED_DISPLAY_MONTHLY_ZAR: 250,
}));
// NVD client
vi.mock('./NvdPageClient', () => ({ default: () => null }));

// ─── Helper ────────────────────────────────────────────────────────────────

function extractRedirect(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/^__REDIRECT__:(.+)$/);
  return match ? match[1] : null;
}

async function run<T>(fn: () => Promise<T>): Promise<{ redirected: string | null; result: T | null }> {
  try {
    const result = await fn();
    return { redirected: null, result };
  } catch (err) {
    const redirected = extractRedirect(err);
    if (redirected !== null) return { redirected, result: null };
    throw err;
  }
}

// ─── Fake sessions ─────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'user-1',
      email: 'test@farm.test',
      name: 'Test User',
      username: 'testuser',
      farms: [{ slug: 'acme', role: 'ADMIN', tier: 'basic', displayName: 'Acme Farm', subscriptionStatus: 'active' }],
      ...overrides,
    },
    expires: '2099-01-01',
  };
}

// ─── Tools pages ──────────────────────────────────────────────────────────

describe('tools/rotation-planner — requireSession gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { default: Page } = await import('@/app/[farmSlug]/tools/rotation-planner/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login?next=%2Facme%2Ftools%2Frotation-planner');
  });

  it('renders for an authenticated session', async () => {
    requireSessionMock.mockResolvedValue(makeSession());
    getPrismaForFarmMock.mockResolvedValue({
      rotationPlan: { findMany: vi.fn().mockResolvedValue([]) },
    });
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });

    const { default: Page } = await import('@/app/[farmSlug]/tools/rotation-planner/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBeNull();
  });
});

describe('tools/tax — requireSession gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });
    getUserRoleForFarmMock.mockReturnValue(null);

    const { default: Page } = await import('@/app/[farmSlug]/tools/tax/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login?next=%2Facme%2Ftools%2Ftax');
  });
});

describe('tools/break-even — requireSession gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { default: Page } = await import('@/app/[farmSlug]/tools/break-even/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login?next=%2Facme%2Ftools%2Fbreak-even');
  });

  it('renders for an authenticated session', async () => {
    requireSessionMock.mockResolvedValue(makeSession());
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });

    const { default: Page } = await import('@/app/[farmSlug]/tools/break-even/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBeNull();
  });
});

describe('tools/nvd — requireSession gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });
    getUserRoleForFarmMock.mockReturnValue(null);

    const { default: Page } = await import('@/app/[farmSlug]/tools/nvd/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login?next=%2Facme%2Ftools%2Fnvd');
  });
});

// ─── Admin pages ──────────────────────────────────────────────────────────

describe('admin/finansies — requireSession gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { default: Page } = await import('@/app/[farmSlug]/admin/finansies/page');
    const { redirected } = await run(() =>
      Page({ params: Promise.resolve({ farmSlug: 'acme' }), searchParams: undefined })
    );

    expect(redirected).toBe('/login?next=%2Facme%2Fadmin%2Ffinansies');
  });

  it('renders for an authenticated session', async () => {
    requireSessionMock.mockResolvedValue(makeSession());
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
    const mockPrisma = {
      transactionCategory: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
      transaction: { findMany: vi.fn().mockResolvedValue([]) },
    };
    getPrismaForFarmMock.mockResolvedValue(mockPrisma);

    const { default: Page } = await import('@/app/[farmSlug]/admin/finansies/page');
    const { redirected } = await run(() =>
      Page({ params: Promise.resolve({ farmSlug: 'acme' }), searchParams: undefined })
    );

    expect(redirected).toBeNull();
  });
});

describe('admin/settings/tasks — requireSession + requireFarmAdmin gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { default: Page } = await import('@/app/[farmSlug]/admin/settings/tasks/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login?next=%2Facme%2Fadmin%2Fsettings%2Ftasks');
  });

  it('redirects to /login when authenticated but not ADMIN', async () => {
    const session = makeSession();
    requireSessionMock.mockResolvedValue(session);
    requireFarmAdminMock.mockImplementation(() => {
      redirectMock('/login');
    });

    const { default: Page } = await import('@/app/[farmSlug]/admin/settings/tasks/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login');
    expect(requireFarmAdminMock).toHaveBeenCalledWith(session, 'acme');
  });

  it('renders for a farm ADMIN', async () => {
    const session = makeSession();
    requireSessionMock.mockResolvedValue(session);
    requireFarmAdminMock.mockResolvedValue(undefined);
    const mockPrisma = {
      taskTemplate: { findMany: vi.fn().mockResolvedValue([]) },
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    getPrismaForFarmMock.mockResolvedValue(mockPrisma);

    const { default: Page } = await import('@/app/[farmSlug]/admin/settings/tasks/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBeNull();
  });
});

describe('admin/settings/alerts — requireSession gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { default: Page } = await import('@/app/[farmSlug]/admin/settings/alerts/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login?next=%2Facme%2Fadmin%2Fsettings%2Falerts');
  });

  it('renders for an authenticated session', async () => {
    const session = makeSession();
    requireSessionMock.mockResolvedValue(session);
    getUserRoleForFarmMock.mockReturnValue('ADMIN');
    const mockPrisma = {
      alertPreference: { findMany: vi.fn().mockResolvedValue([]) },
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    getPrismaForFarmMock.mockResolvedValue(mockPrisma);

    const { default: Page } = await import('@/app/[farmSlug]/admin/settings/alerts/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBeNull();
  });
});

describe('admin/settings/map — requireSession + requireFarmAdmin gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { default: Page } = await import('@/app/[farmSlug]/admin/settings/map/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login?next=%2Facme%2Fadmin%2Fsettings%2Fmap');
  });

  it('redirects to /login when authenticated but not ADMIN', async () => {
    const session = makeSession();
    requireSessionMock.mockResolvedValue(session);
    requireFarmAdminMock.mockImplementation(() => {
      redirectMock('/login');
    });

    const { default: Page } = await import('@/app/[farmSlug]/admin/settings/map/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBe('/login');
    expect(requireFarmAdminMock).toHaveBeenCalledWith(session, 'acme');
  });

  it('renders for a farm ADMIN', async () => {
    const session = makeSession();
    requireSessionMock.mockResolvedValue(session);
    requireFarmAdminMock.mockResolvedValue(undefined);
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
    const mockPrisma = {
      farmSettings: { findFirst: vi.fn().mockResolvedValue(null) },
      camp: { findMany: vi.fn().mockResolvedValue([]) },
    };
    getPrismaForFarmMock.mockResolvedValue(mockPrisma);

    const { default: Page } = await import('@/app/[farmSlug]/admin/settings/map/page');
    const { redirected } = await run(() => Page({ params: Promise.resolve({ farmSlug: 'acme' }) }));

    expect(redirected).toBeNull();
  });
});

// ─── Subscribe/upgrade ────────────────────────────────────────────────────

describe('subscribe/upgrade — requireSession gate (#523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('redirects to /login?next= when unauthenticated', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { default: Page } = await import('@/app/[farmSlug]/subscribe/upgrade/page');
    const { redirected } = await run(() =>
      Page({
        params: Promise.resolve({ farmSlug: 'acme' }),
        searchParams: Promise.resolve({ frequency: 'monthly' }),
      })
    );

    expect(redirected).toBe('/login?next=%2Facme%2Fsubscribe%2Fupgrade');
  });

  it('renders for an authenticated session with a basic farm', async () => {
    const session = makeSession({ farms: [{ slug: 'acme', role: 'ADMIN', tier: 'basic', displayName: 'Acme Farm', subscriptionStatus: 'active' }] });
    requireSessionMock.mockResolvedValue(session);

    const { default: Page } = await import('@/app/[farmSlug]/subscribe/upgrade/page');
    const { redirected } = await run(() =>
      Page({
        params: Promise.resolve({ farmSlug: 'acme' }),
        searchParams: Promise.resolve({ frequency: 'monthly' }),
      })
    );

    expect(redirected).toBeNull();
  });
});

// ─── subscribe/page.tsx (anon → render, not redirect) ──────────────────────

describe('subscribe/page — getSession (renders PublicPlanPicker when anon, #523)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

  it('renders PublicPlanPicker for unauthenticated visitors (no redirect)', async () => {
    // subscribe/page uses getSession() directly — anon renders PublicPlanPicker
    getSessionMock.mockResolvedValue(null);

    const { default: Page } = await import('@/app/subscribe/page');
    const { redirected, result } = await run(() =>
      Page({ searchParams: Promise.resolve({ farm: undefined, cancelled: undefined }) })
    );

    // No redirect — anonymous visitors should see the public plan picker
    expect(redirected).toBeNull();
    // Page returned JSX (not null/undefined)
    expect(result).not.toBeNull();
  });

  it('redirects to /farms when authenticated but no farm slug is resolvable', async () => {
    const session = makeSession({ farms: [] });
    getSessionMock.mockResolvedValue(session);

    const { default: Page } = await import('@/app/subscribe/page');
    const { redirected } = await run(() =>
      Page({ searchParams: Promise.resolve({ farm: undefined, cancelled: undefined }) })
    );

    expect(redirected).toBe('/farms');
  });
});
