import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #407 — Logger last-visit badge must move off "Yesterday" / "Never"
 * after the farmer submits a fresh camp_condition observation.
 *
 * Production 2026-05-24 (Basson Boerdery): 3 of 9 camps stayed at
 * "Yesterday" after the user submitted a fresh inspection. Root cause was
 * the IDB merge in `seedCamps`: nullish-coalescing made the stale server
 * payload (60s `unstable_cache` window on `getCachedCampConditions`) win
 * over the fresh local optimistic write. Fix:
 *  - Hoisted `CAMP_INSPECTION_OBSERVATION_TYPES` constant shared between
 *    producer (logger submit) and consumer (`getLatestCampConditions`).
 *  - Pure `mergeCampWithLocalOverlay` with latest-timestamp-wins semantics.
 *
 * This spec is parameterised across the four grazing-quality branches so
 * any future regression in any branch surfaces immediately.
 *
 * Required env (self-skips when absent — same pattern as admin-journey.spec.ts):
 *   E2E_BASE_URL — http://localhost:3000 in CI / preview URL for synthetic.
 *   E2E_IDENTIFIER — bench user identifier.
 *   E2E_PASSWORD — bench user password.
 *   E2E_TENANT_SLUG — typically `acme-cattle` on the clone.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'acme-cattle';

type GrazingQuality = 'Good' | 'Fair' | 'Poor' | 'Overgrazed';
const BRANCHES: GrazingQuality[] = ['Good', 'Fair', 'Poor', 'Overgrazed'];

test.describe('Issue #407 — last-visit badge refreshes after submit', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping authenticated logger journey',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  for (const grazing of BRANCHES) {
    test(`tile shows fresh timestamp after submitting condition with grazing=${grazing}`, async ({
      page,
      request,
    }) => {
      // Resolve the first camp via /api/camps so the test works on any tenant.
      const campsRes = await request.get(`/api/camps`);
      test.skip(
        !campsRes.ok(),
        'GET /api/camps did not return 2xx — preview clone not ready',
      );
      const camps = (await campsRes.json()) as Array<{
        camp_id: string;
        camp_name: string;
      }>;
      test.skip(camps.length === 0, 'tenant has no camps to inspect');
      const camp = camps[0];

      await page.goto(`/${TENANT_SLUG}/logger`, { waitUntil: 'domcontentloaded' });
      // Wait for the camp selector to hydrate from IDB.
      await page.waitForSelector('button', { timeout: 15_000 });

      // Open this camp's logger surface.
      await page.goto(
        `/${TENANT_SLUG}/logger/${encodeURIComponent(camp.camp_id)}`,
        { waitUntil: 'domcontentloaded' },
      );

      // Open the "Report Camp Condition" bottom sheet.
      await page.getByRole('button', { name: /Report Camp Condition/i }).click();

      // Pick the grazing branch under test, plus Water=Full + Fence=Intact
      // (the form requires all three before Submit is enabled — issue #321).
      await page.getByRole('button', { name: new RegExp(`^${grazing}$`) }).click();
      await page.getByRole('button', { name: /^Full$/ }).click();
      await page.getByRole('button', { name: /^Intact$/ }).click();
      await page.getByRole('button', { name: /Submit Camp Report/i }).click();

      // The submit handler calls router.push back to the logger root.
      await page.waitForURL(`**/${TENANT_SLUG}/logger`, { timeout: 10_000 });

      // Find the camp's tile by its accessible name.
      const tile = page.getByRole('button', {
        name: new RegExp(camp.camp_name, 'i'),
      });
      await expect(tile).toBeVisible({ timeout: 10_000 });

      // The "last visit" relative timestamp is rendered inside the tile. After a
      // fresh submit it MUST be a "just now" / "moments ago" / minute-level
      // string — NOT "Yesterday" and NOT "Never".
      const tileText = (await tile.innerText()).trim();
      expect(tileText, `tile text should not be "Yesterday" after submit`).not.toMatch(
        /Yesterday/i,
      );
      expect(tileText, `tile text should not be "Never" after submit`).not.toMatch(
        /Never/i,
      );
    });
  }
});
