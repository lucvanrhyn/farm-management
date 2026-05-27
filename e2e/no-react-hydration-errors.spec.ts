import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #439 — No React #418 hydration errors on first paint.
 *
 * React error #418 (and siblings #419, #421) occur when the server-rendered
 * HTML does not match the client's first render output. The most common cause
 * is a `useState` initializer that calls browser-only APIs (navigator,
 * window, localStorage, Date) — the server evaluates it to one value, the
 * client evaluates it to another, and React bails out to a full remount.
 *
 * This spec walks 6 routes on BOTH Basson (single-species) and Trio B
 * (multi-species) tenants and asserts that zero React hydration errors appear
 * in the browser console on first paint.
 *
 * Routes tested per tenant:
 *   /                    — home / farm selector
 *   /<slug>              — farm home page
 *   /<slug>/admin        — admin hub
 *   /<slug>/admin/dashboard  — admin dashboard
 *   /<slug>/logger       — camp logger
 *   /<slug>/map          — farm map
 *
 * The spec self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset (local
 * dev without creds). CI sets these from secrets.
 *
 * Root-cause fix: WeatherWidget.tsx line 116-119 had a lazy useState
 * initializer reading `navigator.geolocation` — the server evaluates to
 * `false` (no navigator), the client may evaluate to `true` (navigator
 * present but no geolocation), causing #418. Fixed by useSsrSafeState.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const BASSON_SLUG = process.env.E2E_BASSON_SLUG ?? 'basson-boerdery';
const TRIO_B_SLUG = process.env.E2E_TRIO_B_SLUG ?? 'trio-b-boerdery';

/** Matches any React hydration / mismatch error message. */
const HYDRATION_ERROR_RE = /react\.dev\/(418|419|421)|Hydration|hydration|there was an error while hydrating/i;

function routesFor(slug: string): Array<{ label: string; path: string }> {
  return [
    { label: 'home',             path: '/' },
    { label: 'farm-home',        path: `/${slug}` },
    { label: 'admin',            path: `/${slug}/admin` },
    { label: 'admin-dashboard',  path: `/${slug}/admin/dashboard` },
    { label: 'logger',           path: `/${slug}/logger` },
    { label: 'map',              path: `/${slug}/map` },
  ];
}

/**
 * Navigate to a URL and collect all console errors that fire within 2 s.
 * Returns an array of error-level messages matching the hydration pattern.
 */
async function collectHydrationErrors(
  page: import('@playwright/test').Page,
  path: string
): Promise<string[]> {
  const errors: string[] = [];

  const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (HYDRATION_ERROR_RE.test(text)) {
      errors.push(text);
    }
  };

  page.on('console', onConsole);

  const response = await page.goto(`${BASE_URL}${path}`);
  // Accept 2xx and 3xx — auth redirects are fine.
  const status = response?.status() ?? 0;
  expect(status, `HTTP ${status} for ${path}`).toBeLessThan(500);

  // Wait for React to hydrate (typically < 500 ms; 2 s is generous for CI).
  await page.waitForTimeout(2000);

  page.off('console', onConsole);

  return errors;
}

test.describe('No React #418 hydration errors on first paint', () => {
  test.skip(!IDENTIFIER || !PASSWORD, 'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping authenticated hydration tests');

  for (const slug of [BASSON_SLUG, TRIO_B_SLUG]) {
    test.describe(`Tenant: ${slug}`, () => {
      for (const route of routesFor(slug)) {
        test(`${route.label} (${route.path}) has zero hydration errors`, async ({ context, page }) => {
          await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);

          const hydrationErrors = await collectHydrationErrors(page, route.path);

          expect(
            hydrationErrors,
            `React hydration error(s) on ${route.path}: ${hydrationErrors.join(' | ')}`
          ).toHaveLength(0);
        });
      }
    });
  }
});
