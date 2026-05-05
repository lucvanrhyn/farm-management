/**
 * @vitest-environment jsdom
 *
 * __tests__/app/farm-slug-root-page.test.tsx
 *
 * Visual audit P0 (2026-05-04): `/[farmSlug]` (the tenant root) returns
 * the global 404 page because no `app/[farmSlug]/page.tsx` exists. Real
 * customers who bookmark `https://app.example/<their-slug>` see a broken
 * page. This test pins the tenant-root contract: 302 to the admin layout,
 * which already handles auth + role + onboarding routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`__REDIRECT__:${url}`);
});

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

async function runPage(farmSlug: string): Promise<{ redirected: string | null }> {
  const { default: FarmSlugRootPage } = await import(
    '@/app/[farmSlug]/page'
  );
  try {
    await FarmSlugRootPage({
      params: Promise.resolve({ farmSlug }),
    } as unknown as Parameters<typeof FarmSlugRootPage>[0]);
    return { redirected: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/^__REDIRECT__:(.+)$/);
    if (match) return { redirected: match[1] };
    throw err;
  }
}

describe('FarmSlugRootPage — tenant root redirect (visual audit P0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('redirects /[farmSlug] to /[farmSlug]/admin', async () => {
    const { redirected } = await runPage('basson-boerdery');
    expect(redirected).toBe('/basson-boerdery/admin');
  });

  it('preserves the slug verbatim (no normalisation)', async () => {
    const { redirected } = await runPage('Some-Slug-123');
    expect(redirected).toBe('/Some-Slug-123/admin');
  });
});
