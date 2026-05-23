import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #256 — `/[farmSlug]/map` route.
 *
 * Locks in the v1 tenant map page acceptance criteria:
 *
 *   1. `GET /<slug>/map` returns 200 (no 404 fall-through).
 *   2. The page renders a map container element (`[data-testid="tenant-map"]`).
 *   3. Mapbox bootstraps — at least the canvas paint surface mounts.
 *   4. No hydration errors / unhandled page errors.
 *   5. Home tile click lands on a 200 response (per AC #6 in #256).
 *
 * Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset (local dev), so safe
 * to list unconditionally in `playwright.config.ts`. CI sets them from secrets.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const FARM_SLUG = process.env.E2E_BASSON_SLUG ?? 'basson-boerdery';

test.describe('Tenant map page (#256)', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping tenant-map spec',
  );

  test('GET /<slug>/map returns 200 with map container + zero hydration errors', async ({
    context,
    page,
  }) => {
    // Capture every page error / unhandled rejection. React hydration
    // mismatches surface as console errors AND as `pageerror` events for
    // the unhandled-error path. We assert both are zero.
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);

    // Direct deep-link must resolve, NOT 404.
    const response = await page.goto(`${BASE_URL}/${FARM_SLUG}/map`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'page.goto returned a response').not.toBeNull();
    expect(response!.status(), '/<slug>/map must not 404').toBe(200);

    // Map container should be present in the DOM.
    await expect(
      page.locator('[data-testid="tenant-map"]'),
      'tenant-map container renders',
    ).toBeVisible({ timeout: 15_000 });

    // Mapbox renders into a <canvas> inside the container. Wait for at least
    // one canvas to attach — proves the map shell mounted (token wired,
    // mapbox-gl bootstrapped) without asserting a specific layer style.
    await expect(
      page.locator('[data-testid="tenant-map"] canvas').first(),
      'mapbox canvas mounts',
    ).toBeVisible({ timeout: 20_000 });

    expect(
      pageErrors.map((e) => e.message),
      'no hydration / unhandled page errors',
    ).toEqual([]);
  });

  test('home tile click leads to a 200 map page', async ({ context, page }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);

    await page.goto(`${BASE_URL}/${FARM_SLUG}/home`);

    // Listen for the next navigation triggered by the tile click. The home
    // tiles are buttons (motion.button) that call router.push — so we wait
    // on a URL match rather than a click→response pair.
    const tile = page.getByRole('button', { name: /^Map\b/ });
    await expect(tile).toBeVisible({ timeout: 10_000 });

    await tile.click();

    await page.waitForURL(`**/${FARM_SLUG}/map`, { timeout: 10_000 });

    await expect(
      page.locator('[data-testid="tenant-map"]'),
      'tile click resolves to the map page',
    ).toBeVisible({ timeout: 15_000 });
  });
});
