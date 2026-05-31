/**
 * @vitest-environment jsdom
 *
 * __tests__/app/admin/consulting-page.test.tsx
 *
 * Codex deep-audit P1 (2026-05-03): the Consulting CRM page at
 * `app/[farmSlug]/admin/consulting/page.tsx` is platform-wide data — the
 * leads list and engagement totals reach across every tenant.
 *
 * #523: migrated to requireSession() → requireFarmAdmin() → requirePlatformAdmin()
 * guard chain.  The existing tests remain semantically identical; only the
 * mocked entry points change to the new guards.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks ---------------------------------------------------------------

const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});

const requireSessionMock = vi.fn();
const requireFarmAdminMock = vi.fn();
const requirePlatformAdminMock = vi.fn();
const getConsultingLeadsMock = vi.fn();
const getConsultingEngagementsMock = vi.fn();

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

vi.mock('@/lib/auth', () => ({
  requireSession: requireSessionMock,
  requireFarmAdmin: requireFarmAdminMock,
  requirePlatformAdmin: requirePlatformAdminMock,
}));

vi.mock('@/lib/meta-db', () => ({
  getConsultingLeads: getConsultingLeadsMock,
  getConsultingEngagements: getConsultingEngagementsMock,
}));

// --- helper --------------------------------------------------------------

async function runPage(farmSlug: string): Promise<{ redirected: string | null }> {
  const { default: ConsultingAdminPage } = await import(
    '@/app/[farmSlug]/admin/consulting/page'
  );
  try {
    await ConsultingAdminPage({
      params: Promise.resolve({ farmSlug }),
    } as unknown as Parameters<typeof ConsultingAdminPage>[0]);
    return { redirected: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__REDIRECT__:(.+)$/);
    if (match) return { redirected: match[1] };
    throw err;
  }
}

function makeSession(email = 'platform@farmtrack.app') {
  return { user: { id: 'user-1', email, farms: [{ slug: 'any-farm', role: 'ADMIN' }] }, expires: '2099' };
}

describe('ConsultingAdminPage — platform-admin guard chain (codex P1, #523)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getConsultingLeadsMock.mockResolvedValue([]);
    getConsultingEngagementsMock.mockResolvedValue([]);
  });

  it('redirects unauthenticated users to /login?next= (requireSession)', async () => {
    requireSessionMock.mockImplementation((path: string) => {
      redirectMock(`/login?next=${encodeURIComponent(path)}`);
    });

    const { redirected } = await runPage('any-farm');
    expect(redirected).toBe('/login?next=%2Fany-farm%2Fadmin%2Fconsulting');
  });

  it('redirects a farm-level non-ADMIN to /<slug>/home via requireFarmAdmin (not /login)', async () => {
    // Session resolves OK; requireFarmAdmin fires the redirect to /<slug>/home
    requireSessionMock.mockResolvedValue(makeSession());
    requireFarmAdminMock.mockImplementation(() => {
      redirectMock('/acme-cattle/home');
    });

    const { redirected } = await runPage('acme-cattle');
    expect(redirected).toBe('/acme-cattle/home');
    expect(requireFarmAdminMock).toHaveBeenCalled();
  });

  it('redirects a farm-ADMIN who is NOT a platform admin to /<slug>/admin (not /login)', async () => {
    // The page calls requirePlatformAdmin(session, `/${farmSlug}/admin`), so
    // the guard redirects to /<farmSlug>/admin rather than /login.
    const session = makeSession('farm-admin@example.com');
    requireSessionMock.mockResolvedValue(session);
    requireFarmAdminMock.mockResolvedValue(undefined); // farm-ADMIN passes
    requirePlatformAdminMock.mockImplementation(() => {
      // Not a platform admin — redirect to farm admin home, not /login
      redirectMock('/acme-cattle/admin');
    });

    const { redirected } = await runPage('acme-cattle');
    expect(redirected).toBe('/acme-cattle/admin');
    expect(requirePlatformAdminMock).toHaveBeenCalledWith(session, '/acme-cattle/admin');
  });

  it('renders for a platform admin (all three guards pass)', async () => {
    const session = makeSession('platform@farmtrack.app');
    requireSessionMock.mockResolvedValue(session);
    requireFarmAdminMock.mockResolvedValue(undefined);
    requirePlatformAdminMock.mockResolvedValue(undefined);

    const { redirected } = await runPage('any-farm');
    expect(redirected).toBeNull();
  });

  it('does NOT call meta-db data fetchers when requireSession fires', async () => {
    requireSessionMock.mockImplementation(() => {
      redirectMock('/login?next=%2Fany-farm%2Fadmin%2Fconsulting');
    });

    await runPage('any-farm');

    expect(getConsultingLeadsMock).not.toHaveBeenCalled();
    expect(getConsultingEngagementsMock).not.toHaveBeenCalled();
  });

  it('does NOT call meta-db data fetchers when requirePlatformAdmin fires', async () => {
    requireSessionMock.mockResolvedValue(makeSession('farm-admin@example.com'));
    requireFarmAdminMock.mockResolvedValue(undefined);
    requirePlatformAdminMock.mockImplementation(() => {
      redirectMock('/acme-cattle/admin');
    });

    await runPage('acme-cattle');

    expect(getConsultingLeadsMock).not.toHaveBeenCalled();
    expect(getConsultingEngagementsMock).not.toHaveBeenCalled();
  });
});
