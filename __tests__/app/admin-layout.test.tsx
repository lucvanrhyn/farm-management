/**
 * @vitest-environment jsdom
 *
 * __tests__/app/admin-layout.test.tsx
 *
 * Focused coverage of the I7 onboarding-gate logic in
 * app/[farmSlug]/admin/layout.tsx.
 *
 * We test the layout's control flow by mocking every module it imports and
 * observing `redirect()` calls — no real Next.js runtime is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});
const headersMock = vi.fn();

const getFarmCredsMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const requireSessionMock = vi.fn();
const getUserRoleForFarmMock = vi.fn();

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('@/lib/meta-db', () => ({ getFarmCreds: getFarmCredsMock }));

vi.mock('@/lib/farm-prisma', () => ({ getPrismaForFarm: getPrismaForFarmMock, wrapPrismaWithRetry: (_slug: string, client: unknown) => client }));
// #544: layout migrated from getSession() bare-/login redirect to the
// requireSession(currentPath) guard. We mock requireSession to either return
// the session (authenticated) or invoke redirect() with the deep-link target
// (unauthenticated) — mirroring lib/auth.ts behaviour.
vi.mock('@/lib/auth', () => ({
  requireSession: requireSessionMock,
  getUserRoleForFarm: getUserRoleForFarmMock,
}));

// Silence the AdminNav + TierProvider subtree — we only care about the
// redirect logic. These modules pull in client components that jsdom can't
// fully render, so stub them to no-op elements.
vi.mock('@/components/admin/AdminNav', () => ({
  default: () => null,
}));
vi.mock('@/components/tier-provider', () => ({
  TierProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function makePrismaMock({
  onboardingComplete,
  settingsFails = false,
}: {
  onboardingComplete: boolean | null;
  settingsFails?: boolean;
}) {
  return {
    farmSpeciesSettings: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    farmSettings: {
      findFirst: vi.fn().mockImplementation(async () => {
        if (settingsFails) throw new Error('db blip');
        if (onboardingComplete === null) return null;
        return { onboardingComplete };
      }),
    },
  };
}

function setHeader(pathname: string | null) {
  headersMock.mockResolvedValue({
    get: (name: string) => {
      if (name === 'next-url' && pathname) return pathname;
      return null;
    },
  });
}

async function runLayout(farmSlug: string): Promise<{ redirected: string | null }> {
  const { default: AdminLayout } = await import('@/app/[farmSlug]/admin/layout');
  try {
    await AdminLayout({
      children: null,
      params: Promise.resolve({ farmSlug }),
    });
    return { redirected: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__REDIRECT__:(.+)$/);
    if (match) return { redirected: match[1] };
    throw err;
  }
}

describe('AdminLayout — onboarding gate (I7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: valid ADMIN session (requireSession resolves with the session)
    requireSessionMock.mockResolvedValue({ user: { email: 'admin@farm.test', farms: [] } });
    getUserRoleForFarmMock.mockReturnValue('ADMIN');
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
    setHeader(null);
  });

  it('redirects fresh farms (onboardingComplete=false) to /onboarding', async () => {
    getPrismaForFarmMock.mockResolvedValue(
      makePrismaMock({ onboardingComplete: false }),
    );
    setHeader('/big-farm/admin');

    const { redirected } = await runLayout('big-farm');
    expect(redirected).toBe('/big-farm/onboarding');
  });

  it('redirects when FarmSettings row is missing (brand-new tenant)', async () => {
    getPrismaForFarmMock.mockResolvedValue(
      makePrismaMock({ onboardingComplete: null }),
    );
    setHeader('/new-farm/admin');

    const { redirected } = await runLayout('new-farm');
    expect(redirected).toBe('/new-farm/onboarding');
  });

  it('does NOT redirect when onboardingComplete=true', async () => {
    getPrismaForFarmMock.mockResolvedValue(
      makePrismaMock({ onboardingComplete: true }),
    );
    setHeader('/real-farm/admin');

    const { redirected } = await runLayout('real-farm');
    expect(redirected).toBeNull();
  });

  it('whitelists /admin/settings/subscription during onboarding', async () => {
    getPrismaForFarmMock.mockResolvedValue(
      makePrismaMock({ onboardingComplete: false }),
    );
    setHeader('/fresh-farm/admin/settings/subscription');

    const { redirected } = await runLayout('fresh-farm');
    expect(redirected).toBeNull();
  });

  it('rejects a crafted path-traversal attempt to bypass the onboarding gate', async () => {
    // Regression for the code-review HIGH — `pathname.includes("/admin/settings/subscription")`
    // would have matched this attacker-controlled header, letting a fresh
    // farm admin bypass the wizard by visiting /admin/animals with a
    // spoofed next-url. Normalisation via URL() resolves the `..` and
    // puts the actual target (`/admin/animals`) outside the whitelist.
    getPrismaForFarmMock.mockResolvedValue(
      makePrismaMock({ onboardingComplete: false }),
    );
    setHeader('/fresh-farm/admin/settings/subscription/../animals');

    const { redirected } = await runLayout('fresh-farm');
    expect(redirected).toBe('/fresh-farm/onboarding');
  });

  it('ignores query strings on the whitelisted path', async () => {
    getPrismaForFarmMock.mockResolvedValue(
      makePrismaMock({ onboardingComplete: false }),
    );
    setHeader('/fresh-farm/admin/settings/subscription?tier=advanced');

    const { redirected } = await runLayout('fresh-farm');
    expect(redirected).toBeNull();
  });

  it('fails-open when farmSettings.findFirst throws (no bounce on DB blip)', async () => {
    getPrismaForFarmMock.mockResolvedValue(
      makePrismaMock({ onboardingComplete: null, settingsFails: true }),
    );
    setHeader('/flaky-farm/admin');

    const { redirected } = await runLayout('flaky-farm');
    // fail-open: better to render /admin than trap the farmer in /onboarding
    // because of a transient DB error
    expect(redirected).toBeNull();
  });

  it('redirects unauthenticated users to /login?next=/<slug>/admin (deep-link, #544)', async () => {
    // requireSession redirects to the deep-link target when there is no session.
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { redirected } = await runLayout('any-farm');
    expect(redirected).toBe('/login?next=%2Fany-farm%2Fadmin');
  });

  it('still redirects non-ADMIN users to /home (ordering preserved)', async () => {
    getUserRoleForFarmMock.mockReturnValue('MEMBER');

    const { redirected } = await runLayout('any-farm');
    expect(redirected).toBe('/any-farm/home');
  });
});
