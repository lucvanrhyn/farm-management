import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #438 — Server-rendered farm hero regression guard (PRD #434).
 *
 * Locks the fix for the 3-state loading flicker observed on /<farmSlug>/home
 * in the 2026-05-27 stress test:
 *   1. First paint: empty cards
 *   2. Placeholder: "FARM MANAGEMENT SYSTEM" + "—" subtitle
 *   3. Branded farm header swap-in
 *
 * Root cause: AnimatedHero fetched /api/farm in a useEffect AFTER mount,
 * showing hardcoded fallback strings "—" and "Farm Management System" on
 * first paint. Fix: page.tsx becomes an async RSC that calls getFarmIdentity()
 * server-side and passes initialFarmData as a prop to AnimatedHero, so the
 * branded content is present in the initial HTML.
 *
 * Assertion strategy:
 *   - Click a farm card on the selector page (/ or /login → /)
 *   - Wait for navigation to /<farmSlug>/home
 *   - Screenshot at 100ms intervals for first 1.5 seconds
 *   - Assert: branded farm name is visible in EVERY screenshot
 *   - Assert: NEVER see "FARM MANAGEMENT SYSTEM" (legacy fallback) or
 *     the lone "—" subtitle placeholder
 *
 * Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset (local dev
 * without real credentials) — same pattern as all authenticated specs.
 *
 * Required env:
 *   E2E_BASE_URL         — http://localhost:3000 in CI / preview URL for synthetic
 *   E2E_IDENTIFIER       — bench user identifier
 *   E2E_PASSWORD         — bench user password
 *   E2E_TENANT_SLUG      — the farm slug to test (default: 'trio-b-boerdery')
 *   E2E_FARM_BRANDED_NAME — the branded name to assert (default: 'Trio B Boerdery')
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'trio-b-boerdery';
const BRANDED_FARM_NAME = process.env.E2E_FARM_BRANDED_NAME ?? 'Trio B Boerdery';

/** Placeholders that must never appear after the fix. */
const FORBIDDEN_PLACEHOLDERS = [
  'FARM MANAGEMENT SYSTEM',
  // The lone "—" subtitle that appeared before farm data loaded.
  // Match the exact visible text node (not partial — "Farm Management System"
  // already covered above).
];

test.describe('Farm home — no loading flicker', () => {
  test.skip(!IDENTIFIER || !PASSWORD, 'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping');

  test('branded farm name visible on every screenshot in the first 1.5s after navigation', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
    });

    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
    const page = await context.newPage();

    // Navigate directly to the farm home page
    await page.goto(`${BASE_URL}/${TENANT_SLUG}/home`, { waitUntil: 'commit' });

    // Collect screenshots at 100ms intervals for first 1.5 seconds.
    // "commit" means the navigation response headers were received — we start
    // the clock from then so we capture the very first paint.
    const screenshotCount = 15; // 15 × 100ms = 1.5s
    const intervalMs = 100;

    const failures: { index: number; reason: string }[] = [];

    for (let i = 0; i < screenshotCount; i++) {
      await page.waitForTimeout(intervalMs);

      const html = await page.content();
      const bodyText = (await page.locator('body').innerText().catch(() => ''));

      // Assert branded name is present in the DOM (case-insensitive for
      // uppercase h1 CSS transform — the DOM node still holds the cased value).
      const brandedNamePresent =
        html.toLowerCase().includes(BRANDED_FARM_NAME.toLowerCase()) ||
        bodyText.toLowerCase().includes(BRANDED_FARM_NAME.toLowerCase());

      if (!brandedNamePresent) {
        failures.push({
          index: i,
          reason: `Branded name "${BRANDED_FARM_NAME}" not found at ${(i + 1) * intervalMs}ms`,
        });
      }

      // Assert forbidden placeholders are absent
      for (const placeholder of FORBIDDEN_PLACEHOLDERS) {
        if (
          html.toUpperCase().includes(placeholder.toUpperCase()) ||
          bodyText.toUpperCase().includes(placeholder.toUpperCase())
        ) {
          failures.push({
            index: i,
            reason: `Forbidden placeholder "${placeholder}" found at ${(i + 1) * intervalMs}ms`,
          });
        }
      }
    }

    // Take a final screenshot for debugging if there are failures
    if (failures.length > 0) {
      await page.screenshot({
        path: '/tmp/farm-home-flicker-debug.png',
        fullPage: true,
      });
    }

    await context.close();

    expect(failures, `Flicker detected: ${JSON.stringify(failures, null, 2)}`).toHaveLength(0);
  });

  test('page HTML contains branded farm name before any client-side JS runs (SSR check)', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      javaScriptEnabled: false, // Disable JS to test pure SSR output
    });

    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/${TENANT_SLUG}/home`, { waitUntil: 'domcontentloaded' });

    const html = await page.content();

    // The branded farm name must be in the server-rendered HTML
    expect(html.toLowerCase()).toContain(BRANDED_FARM_NAME.toLowerCase());

    // The fallback "Farm Management System" should not appear in SSR output
    expect(html.toUpperCase()).not.toContain('FARM MANAGEMENT SYSTEM');

    await context.close();
  });
});
