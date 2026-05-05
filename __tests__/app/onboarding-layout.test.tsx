/**
 * @vitest-environment node
 *
 * __tests__/app/onboarding-layout.test.tsx
 *
 * Regression guard for issue #103: `/<slug>/onboarding` must redirect
 * unauthenticated visitors to `/login?next=/<slug>/onboarding` — it must
 * NOT render the `UnauthenticatedPanel` (HTTP 200) for visitors with no
 * session.
 *
 * Also verifies that the "logged-in but non-ADMIN" branch still renders an
 * inline panel (not a hard redirect) and that a valid ADMIN session with an
 * empty farm renders the wizard shell.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────
const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});

const getServerSessionMock = vi.fn();
const getPrismaForSlugWithAuthMock = vi.fn();

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/farm-prisma', () => ({
  getPrismaForSlugWithAuth: getPrismaForSlugWithAuthMock,
}));

// Silence client-component subtrees that jsdom/node can't render
vi.mock('@/components/onboarding/OnboardingProvider', () => ({
  OnboardingProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/onboarding/Stepper', () => ({
  StepperFromPathname: () => null,
}));
vi.mock('@/components/onboarding/theme', () => ({
  ONBOARDING_GLOW: 'test-glow',
}));

// ── Helpers ───────────────────────────────────────────────────────────────
function makePrismaMock(animalCount = 0) {
  return {
    animal: {
      count: vi.fn().mockResolvedValue(animalCount),
    },
  };
}

async function runLayout(
  farmSlug: string,
): Promise<{ redirected: string | null; rendered: boolean }> {
  // Reset module registry so mocks propagate correctly between tests.
  const { default: OnboardingLayout } = await import(
    '@/app/[farmSlug]/onboarding/layout'
  );
  try {
    const result = await OnboardingLayout({
      children: null,
      params: Promise.resolve({ farmSlug }),
    });
    // If we get here without throwing, the layout returned JSX (rendered inline).
    return { redirected: null, rendered: result !== null && result !== undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__REDIRECT__:(.+)$/);
    if (match) return { redirected: match[1], rendered: false };
    throw err;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('OnboardingLayout — auth gate (#103)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('redirects to /login?next=/<slug>/onboarding when there is no session', async () => {
    getServerSessionMock.mockResolvedValue(null);

    const { redirected } = await runLayout('acme-farm');

    expect(redirected).toBe('/login?next=%2Facme-farm%2Fonboarding');
  });

  it('renders NotAdminPanel (not a redirect) when session exists but user lacks ADMIN role', async () => {
    getServerSessionMock.mockResolvedValue({ user: { email: 'member@farm.test' } });
    getPrismaForSlugWithAuthMock.mockResolvedValue({
      prisma: makePrismaMock(),
      role: 'MEMBER',
      slug: 'acme-farm',
    });

    const { redirected, rendered } = await runLayout('acme-farm');

    expect(redirected).toBeNull();
    expect(rendered).toBe(true);
  });

  it('redirects to /<slug>/admin when ADMIN session + farm already has animals', async () => {
    getServerSessionMock.mockResolvedValue({ user: { email: 'admin@farm.test' } });
    getPrismaForSlugWithAuthMock.mockResolvedValue({
      prisma: makePrismaMock(5),
      role: 'ADMIN',
      slug: 'acme-farm',
    });

    const { redirected } = await runLayout('acme-farm');

    expect(redirected).toBe('/acme-farm/admin');
  });

  it('renders the wizard shell for a valid ADMIN session with an empty farm', async () => {
    getServerSessionMock.mockResolvedValue({ user: { email: 'admin@farm.test' } });
    getPrismaForSlugWithAuthMock.mockResolvedValue({
      prisma: makePrismaMock(0),
      role: 'ADMIN',
      slug: 'acme-farm',
    });

    const { redirected, rendered } = await runLayout('acme-farm');

    expect(redirected).toBeNull();
    expect(rendered).toBe(true);
  });

  it('redirects to /login when tenant auth lookup returns a non-403 error', async () => {
    getServerSessionMock.mockResolvedValue({ user: { email: 'admin@farm.test' } });
    getPrismaForSlugWithAuthMock.mockResolvedValue({
      error: 'Farm not found',
      status: 404,
    });

    const { redirected } = await runLayout('ghost-farm');

    expect(redirected).toBe('/login');
  });
});
