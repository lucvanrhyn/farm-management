/**
 * @vitest-environment node
 *
 * __tests__/app/farms-page-auth.test.tsx
 *
 * Deep-link consistency (#544): app/farms/page.tsx must bounce unauthenticated
 * visitors to /login?next=/farms rather than dropping them at bare /login, so
 * they land back on the farm picker after sign-in.
 *
 * An authenticated session renders the picker (no redirect).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});

const requireSessionMock = vi.fn();
const getCachedMultiFarmOverviewMock = vi.fn();

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/auth', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/server/cached', () => ({
  getCachedMultiFarmOverview: getCachedMultiFarmOverviewMock,
}));
// FarmCard is a client component subtree we don't need to render to assert
// redirect behaviour.
vi.mock('@/app/farms/FarmCard', () => ({ FarmCard: () => null }));

function makeSession(farms: Array<{ slug: string; role: string }> = []) {
  return {
    user: { id: 'user-1', email: 'admin@farm.test', name: 'Admin', farms },
    expires: '2099',
  };
}

async function runPage(): Promise<{ redirected: string | null; rendered: boolean }> {
  const { default: FarmsPage } = await import('@/app/farms/page');
  try {
    const result = await FarmsPage();
    return { redirected: null, rendered: result !== null && result !== undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__REDIRECT__:(.+)$/);
    if (match) return { redirected: match[1], rendered: false };
    throw err;
  }
}

describe('FarmsPage — auth gate (#544)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    requireSessionMock.mockResolvedValue(makeSession([{ slug: 'acme-farm', role: 'ADMIN' }]));
    getCachedMultiFarmOverviewMock.mockResolvedValue([]);
  });

  it('redirects unauthenticated users to /login?next=/farms (deep-link)', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { redirected } = await runPage();
    expect(redirected).toBe('/login?next=%2Ffarms');
  });

  it('renders the picker for an authenticated user', async () => {
    const { redirected, rendered } = await runPage();
    expect(redirected).toBeNull();
    expect(rendered).toBe(true);
  });
});
