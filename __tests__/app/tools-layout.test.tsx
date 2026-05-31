/**
 * @vitest-environment node
 *
 * __tests__/app/tools-layout.test.tsx
 *
 * Deep-link consistency (#544): app/[farmSlug]/tools/layout.tsx must bounce
 * unauthenticated visitors to /login?next=/<slug>/tools (preserving the
 * intended destination) rather than dropping them at bare /login.
 *
 * The role-failure branch (authenticated but no access to this farm) must
 * stay unchanged: redirect to /farms.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});

const requireSessionMock = vi.fn();
const getUserRoleForFarmMock = vi.fn();
const getFarmCredsMock = vi.fn();

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/auth', () => ({
  requireSession: requireSessionMock,
  getUserRoleForFarm: getUserRoleForFarmMock,
}));
vi.mock('@/lib/meta-db', () => ({ getFarmCreds: getFarmCredsMock }));

// Silence the AdminNav + TierProvider subtree — we only care about redirects.
vi.mock('@/components/admin/AdminNav', () => ({ default: () => null }));
vi.mock('@/components/tier-provider', () => ({
  TierProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function makeSession() {
  return { user: { id: 'user-1', email: 'logger@farm.test', farms: [] }, expires: '2099' };
}

async function runLayout(
  farmSlug: string,
): Promise<{ redirected: string | null; rendered: boolean }> {
  const { default: ToolsLayout } = await import('@/app/[farmSlug]/tools/layout');
  try {
    const result = await ToolsLayout({
      children: null,
      params: Promise.resolve({ farmSlug }),
    });
    return { redirected: null, rendered: result !== null && result !== undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__REDIRECT__:(.+)$/);
    if (match) return { redirected: match[1], rendered: false };
    throw err;
  }
}

describe('ToolsLayout — auth gate (#544)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: authenticated user with a role on this farm.
    requireSessionMock.mockResolvedValue(makeSession());
    getUserRoleForFarmMock.mockReturnValue('LOGGER');
    getFarmCredsMock.mockResolvedValue({ tier: 'advanced' });
  });

  it('redirects unauthenticated users to /login?next=/<slug>/tools (deep-link)', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { redirected } = await runLayout('acme-farm');
    expect(redirected).toBe('/login?next=%2Facme-farm%2Ftools');
  });

  it('redirects authenticated users with no farm access to /farms (unchanged)', async () => {
    getUserRoleForFarmMock.mockReturnValue(null);

    const { redirected } = await runLayout('acme-farm');
    expect(redirected).toBe('/farms');
  });

  it('renders for an authenticated user with farm access', async () => {
    const { redirected, rendered } = await runLayout('acme-farm');
    expect(redirected).toBeNull();
    expect(rendered).toBe(true);
  });
});
