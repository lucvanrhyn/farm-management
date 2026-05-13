import { test, expect } from '@playwright/test';
import { applyAuth, loginViaApi } from './fixtures/auth';

/**
 * Issue #260 — TenantRouteGuard E2E lockdown.
 *
 * Asserts the routing matrix documented in
 * `__tests__/app/sheep-global-redirect.test.tsx` against a live preview deploy.
 * The unit tests cover proxy.ts behaviour in isolation; this spec proves the
 * matrix survives the real Edge runtime + next-auth session round-trip.
 *
 * Routing matrix (mirror of ADR-0003 leak-path table):
 *   | State                 | Path             | Expected location header                     |
 *   |-----------------------|------------------|----------------------------------------------|
 *   | Unauthenticated       | /sheep/animals   | /login?next=/sheep/animals                   |
 *   | Authed, multi-tenant  | /sheep/animals   | /farms?toast=pick-a-farm                     |
 *   | Authed, single tenant | /sheep/animals   | /{slug}/sheep/animals                        |
 *
 * Same applies to /sheep/camps and /sheep/observations.
 *
 * Skipping policy: the authed branches require the standard CI synthetic-user
 * creds (E2E_IDENTIFIER / E2E_PASSWORD). The unauthenticated row runs
 * unconditionally — no creds needed — so even local-dev `pnpm smoke` runs gain
 * regression coverage.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

const SHEEP_LEAK_PATHS = [
  '/sheep/animals',
  '/sheep/camps',
  '/sheep/observations',
] as const;

test.describe('Issue #260 — global /sheep/* TenantRouteGuard', () => {
  // ── Row 1: Unauthenticated → /login?next=… ─────────────────────────────────
  test.describe('unauthenticated visitor', () => {
    for (const path of SHEEP_LEAK_PATHS) {
      test(`${path} → /login?next=${path}`, async ({ request }) => {
        const res = await request.get(`${BASE_URL}${path}`, {
          maxRedirects: 0,
        });

        expect(res.status(), `expected 3xx redirect for ${path}, got ${res.status()}`).toBeGreaterThanOrEqual(300);
        expect(res.status()).toBeLessThan(400);

        const loc = res.headers()['location'];
        expect(loc, `Location header missing for ${path}`).toBeTruthy();

        const url = new URL(loc!, BASE_URL);
        expect(url.pathname).toBe('/login');
        expect(url.searchParams.get('next')).toBe(path);
      });
    }
  });

  // ── Row 2-3: Authenticated branches — require creds ────────────────────────
  test.describe('authenticated visitor', () => {
    test.skip(
      !IDENTIFIER || !PASSWORD,
      'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping authed /sheep/* redirect rows',
    );

    test.beforeEach(async ({ context }) => {
      await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
    });

    /**
     * Whichever authenticated tenant the synthetic user resolves to (single
     * vs multi), the redirect MUST land on either:
     *   • /farms?toast=pick-a-farm   (multi-tenant)
     *   • /{slug}/sheep/<leaf>       (single-tenant)
     *
     * The spec doesn't assume which — it asserts the disposition is one of
     * these two. The unit tests pin the per-branch behaviour exactly; this
     * spec proves "neither branch leaks to /not-found in production".
     */
    for (const path of SHEEP_LEAK_PATHS) {
      test(`${path} redirects to /farms or /{slug}${path} (never /not-found)`, async ({
        request,
        context,
      }) => {
        // Re-apply auth to this request context (the page-level applyAuth
        // touches the BrowserContext; APIRequestContext needs the cookie too).
        const { cookie } = await loginViaApi(BASE_URL, IDENTIFIER, PASSWORD);
        const res = await request.get(`${BASE_URL}${path}`, {
          maxRedirects: 0,
          headers: { cookie },
        });

        expect(res.status(), `expected 3xx for authed ${path}, got ${res.status()}`).toBeGreaterThanOrEqual(300);
        expect(res.status()).toBeLessThan(400);

        const loc = res.headers()['location'];
        expect(loc, 'Location header missing on authed redirect').toBeTruthy();

        const url = new URL(loc!, BASE_URL);

        // Must NOT bounce back to /login (would mean the session cookie
        // didn't take, separate failure mode).
        expect(url.pathname).not.toBe('/login');

        // Multi-tenant branch.
        const isMultiTenant =
          url.pathname === '/farms' && url.searchParams.get('toast') === 'pick-a-farm';

        // Single-tenant branch — /{slug}/sheep/<leaf>.
        const isSingleTenant = new RegExp(`^/[^/]+${path}$`).test(url.pathname);

        expect(
          isMultiTenant || isSingleTenant,
          `Expected /farms?toast=pick-a-farm or /{slug}${path}, got ${url.pathname}${url.search}`,
        ).toBe(true);

        void context; // keep the parameter used for type narrowing
      });
    }
  });
});
