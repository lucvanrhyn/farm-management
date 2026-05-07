import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';
import { CRITICAL_ROUTES, resolveCriticalRoutes } from '../lib/ops/critical-routes';

/**
 * PRD #128 (2026-05-06): authenticated journey through the admin routes
 * that crashed on prod after Phase A. Every gate the team had was static
 * and never logged in; this spec is the one that would have caught
 * "8 admin pages return the error boundary".
 *
 * Runs against the branch clone in CI (governance-gate.yml). The clone is
 * provisioned from `basson-boerdery-dub` which has the synthetic
 * `e2e-bench@farmtrack.app` user pre-seeded.
 *
 * Required env (CI sets these from secrets):
 *   E2E_BASE_URL — e.g. http://localhost:3000 in CI, prod URL for synthetic.
 *   E2E_IDENTIFIER — typically `e2e-bench@farmtrack.app`.
 *   E2E_PASSWORD — bench user password.
 *   E2E_TENANT_SLUG — typically `basson-boerdery` on the clone.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'basson-boerdery';

test.describe('PRD #128 admin journey — every critical route renders', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping authenticated journey',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  test('lands on home with the expected farm in scope', async ({ page }) => {
    await page.goto(`/${TENANT_SLUG}`);
    // Home renders three nav cards; just assert we're not bounced to /login.
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('every admin route returns 200 and does not render the error boundary', async ({
    page,
    request,
  }) => {
    // First, fetch the camps list via API so we have a real campId for the
    // camp-detail route (otherwise resolveCriticalRoutes throws).
    const campsRes = await request.get(`/api/camps`, {
      headers: { cookie: '' /* page.context() has cookies; request shares */ },
    });
    let firstCampId = 'unknown';
    if (campsRes.ok()) {
      const data = (await campsRes.json()) as Array<{ camp_id: string }>;
      if (Array.isArray(data) && data.length > 0) firstCampId = data[0].camp_id;
    }

    const routes = resolveCriticalRoutes({
      farmSlug: TENANT_SLUG,
      firstCampId,
      includeAdminOnly: true,
    });

    const failures: { url: string; reason: string }[] = [];

    for (const route of routes) {
      const consoleErrors: string[] = [];
      const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Browser-emitted advisory about the report-only CSP — not an app error.
          if (text.includes('upgrade-insecure-requests') && text.includes('report-only')) return;
          consoleErrors.push(text);
        }
      };
      page.on('console', onConsole);

      const response = await page.goto(route.url, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      const body = (await page.content()).slice(0, 50_000); // bounded to keep failure log small

      const errorBoundary =
        body.includes('Something went wrong') ||
        body.includes('data-error-boundary') ||
        body.includes('data-testid="error-boundary"');
      const reactCrash = body.includes('Application error') || body.includes('a server-side exception has occurred');

      if (status !== 200) failures.push({ url: route.url, reason: `HTTP ${status}` });
      else if (errorBoundary) failures.push({ url: route.url, reason: 'error boundary rendered' });
      else if (reactCrash) failures.push({ url: route.url, reason: 'React generic crash UI' });
      else if (consoleErrors.length > 0)
        failures.push({ url: route.url, reason: `console.error × ${consoleErrors.length}: ${consoleErrors[0]}` });

      page.off('console', onConsole);
    }

    expect.soft(failures, `Critical-route failures:\n${failures.map((f) => `  ${f.url} — ${f.reason}`).join('\n')}`).toEqual([]);
  });

  test('admin overview counts match home / camps API (no 0-vs-874 divergence)', async ({
    page,
    request,
  }) => {
    // /api/farm exposes farm-level counts; /api/camps exposes per-camp counts.
    // The PRD #128 invariant: farm.animalCount === sum(camps.animal_count).
    const [farmRes, campsRes] = await Promise.all([
      request.get('/api/farm'),
      request.get('/api/camps'),
    ]);
    expect(farmRes.ok(), 'GET /api/farm must return 2xx').toBeTruthy();
    expect(campsRes.ok(), 'GET /api/camps must return 2xx').toBeTruthy();

    const farm = (await farmRes.json()) as { animalCount: number; campCount: number };
    const camps = (await campsRes.json()) as Array<{ animal_count: number }>;
    const summed = camps.reduce((acc, c) => acc + (c.animal_count ?? 0), 0);

    expect(farm.animalCount).toBe(summed);
    expect(farm.campCount).toBe(camps.length);

    // Now visit /admin and assert the count card text matches farm.animalCount.
    await page.goto(`/${TENANT_SLUG}/admin`);
    const html = await page.content();
    // The overview renders "X Total Animals". Tolerant grep — survives copy tweaks.
    const m = html.match(/(\d[\d,]*)\s*(?:<\/[^>]+>\s*)*Total Animals/);
    expect(m, '/admin page must render "<N> Total Animals" matching /api/farm').not.toBeNull();
    if (m) {
      const adminAnimalCount = Number(m[1].replace(/,/g, ''));
      expect(adminAnimalCount).toBe(farm.animalCount);
    }
  });
});

// Re-export for visibility — anyone touching this spec should know the route
// list lives in lib/ops/critical-routes.ts.
export { CRITICAL_ROUTES };
