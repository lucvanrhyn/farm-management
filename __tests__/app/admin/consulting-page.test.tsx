/**
 * @vitest-environment jsdom
 *
 * __tests__/app/admin/consulting-page.test.tsx
 *
 * Codex deep-audit P1 (2026-05-03): the Consulting CRM page at
 * `app/[farmSlug]/admin/consulting/page.tsx` is platform-wide data — the
 * leads list and engagement totals reach across every tenant. The matching
 * PATCH endpoint at `app/api/admin/consulting/[id]/route.ts` correctly
 * gates on `isPlatformAdmin(email)`, but the SSR page only checks
 * `getUserRoleForFarm(session, farmSlug) === "ADMIN"`.
 *
 * That means any farm-level ADMIN — including a single-farm tenant who
 * happens to share farmSlug with no involvement in our consulting program
 * — can read every other tenant's consulting lead pipeline by visiting
 * `/<their-slug>/admin/consulting`.
 *
 * These tests pin the contract: the page redirects unless the session
 * email is in `PLATFORM_ADMIN_EMAILS` (or whatever `isPlatformAdmin`
 * resolves to true for).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// --- mocks ---------------------------------------------------------------

const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});

const getSessionMock = vi.fn();
const getUserRoleForFarmMock = vi.fn();
const isPlatformAdminMock = vi.fn();
const getConsultingLeadsMock = vi.fn();
const getConsultingEngagementsMock = vi.fn();

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

vi.mock('@/lib/auth', () => ({
  getSession: getSessionMock,
  getUserRoleForFarm: getUserRoleForFarmMock,
}));

vi.mock('@/lib/meta-db', () => ({
  isPlatformAdmin: isPlatformAdminMock,
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

describe('ConsultingAdminPage — platform-admin gate (codex P1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getConsultingLeadsMock.mockResolvedValue([]);
    getConsultingEngagementsMock.mockResolvedValue([]);
  });

  it('redirects unauthenticated users to /login', async () => {
    getSessionMock.mockResolvedValue(null);
    isPlatformAdminMock.mockResolvedValue(false);

    const { redirected } = await runPage('any-farm');
    expect(redirected).toBe('/login');
  });

  it('redirects a farm-level ADMIN who is NOT a platform admin', async () => {
    // This is the codex-P1 scenario: a farm-level ADMIN of `basson-boerdery`
    // visits /basson-boerdery/admin/consulting. Without this gate they would
    // see every tenant's consulting leads and revenue totals.
    getSessionMock.mockResolvedValue({ user: { email: 'farm-admin@example.com' } });
    getUserRoleForFarmMock.mockReturnValue('ADMIN');
    isPlatformAdminMock.mockResolvedValue(false);

    const { redirected } = await runPage('basson-boerdery');
    expect(redirected).toBe('/basson-boerdery/admin');
  });

  it('redirects a non-ADMIN even if isPlatformAdmin would resolve true (defence-in-depth)', async () => {
    getSessionMock.mockResolvedValue({ user: { email: 'platform@farmtrack.app' } });
    getUserRoleForFarmMock.mockReturnValue('LOGGER');
    isPlatformAdminMock.mockResolvedValue(true);

    const { redirected } = await runPage('any-farm');
    // Either the farm-role redirect or the platform-admin redirect is
    // acceptable — what matters is the page does not render.
    expect(redirected).not.toBeNull();
  });

  it('renders for a platform admin', async () => {
    getSessionMock.mockResolvedValue({ user: { email: 'platform@farmtrack.app' } });
    getUserRoleForFarmMock.mockReturnValue('ADMIN');
    isPlatformAdminMock.mockResolvedValue(true);

    const { redirected } = await runPage('any-farm');
    expect(redirected).toBeNull();
  });

  it('does NOT call meta-db data fetchers when the gate fails', async () => {
    // Defence: the cross-tenant data leak isn't just visual — it's that
    // the page even queries the meta DB before checking platform-admin
    // status. Verify the data fetchers don't run for an unauthorised user.
    getSessionMock.mockResolvedValue({ user: { email: 'farm-admin@example.com' } });
    getUserRoleForFarmMock.mockReturnValue('ADMIN');
    isPlatformAdminMock.mockResolvedValue(false);

    await runPage('basson-boerdery');

    expect(getConsultingLeadsMock).not.toHaveBeenCalled();
    expect(getConsultingEngagementsMock).not.toHaveBeenCalled();
  });
});
