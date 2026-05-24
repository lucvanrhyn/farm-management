import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #406 — TB1: done-button caption visibility.
 *
 * The Logger camp page renders a "complete visit" done-button whose copy
 * branches by grazing quality:
 *  - Good (or unknown) → "All Normal — Camp Good"
 *  - Fair / Poor / Overgrazed → "Done — no animals flagged"
 *
 * Without a caption the divergence reads as an app inconsistency. This
 * spec covers the in-place explanation: immediately under the done-button
 * we render `campConditionDoneCaption(grazingQuality)` (see sibling
 * `_lib/camp-condition-done-caption.ts`). The caption is visually
 * subordinate (smaller text, lower contrast) and hides entirely when
 * grazing quality is null / unrecognised.
 *
 * Two scenarios required by the acceptance criteria:
 *  - Good camp shows the Good caption alongside "All Normal — Camp Good".
 *  - A Fair / Poor / Overgrazed camp shows the corresponding caption
 *    alongside "Done — no animals flagged".
 *
 * Parameterised across all four branches so any future regression on any
 * branch surfaces immediately (same shape as logger-last-visit-refresh).
 *
 * Required env (self-skips when absent — same pattern as
 * logger-last-visit-refresh.spec.ts):
 *   E2E_BASE_URL — http://localhost:3000 in CI / preview URL.
 *   E2E_IDENTIFIER — bench user identifier.
 *   E2E_PASSWORD — bench user password.
 *   E2E_TENANT_SLUG — typically `acme-cattle` on the clone.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'acme-cattle';

type GrazingQuality = 'Good' | 'Fair' | 'Poor' | 'Overgrazed';

const CASES: Array<{
  grazing: GrazingQuality;
  expectedButton: RegExp;
  expectedCaptionSubstring: string;
}> = [
  {
    grazing: 'Good',
    expectedButton: /All Normal — Camp Good/i,
    expectedCaptionSubstring: 'Veld is in good shape',
  },
  {
    grazing: 'Fair',
    expectedButton: /Done — no animals flagged/i,
    expectedCaptionSubstring: 'Veld is fair',
  },
  {
    grazing: 'Poor',
    expectedButton: /Done — no animals flagged/i,
    expectedCaptionSubstring: 'Veld is poor',
  },
  {
    grazing: 'Overgrazed',
    expectedButton: /Done — no animals flagged/i,
    expectedCaptionSubstring: 'Veld is overgrazed',
  },
];

test.describe('Issue #406 — done-button caption explains grazing-quality variance', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping authenticated logger journey',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  for (const { grazing, expectedButton, expectedCaptionSubstring } of CASES) {
    test(`caption matches button copy for grazing=${grazing}`, async ({
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

      // Land on the camp's logger surface so the condition form is mounted.
      await page.goto(
        `/${TENANT_SLUG}/logger/${encodeURIComponent(camp.camp_id)}`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('button', { timeout: 15_000 });

      // Open the condition sheet, pick the grazing branch under test plus
      // Water=Full + Fence=Intact (the form requires all three before
      // Submit is enabled — issue #321), submit. The submit handler calls
      // router.push back to the logger root, so we navigate back to the
      // same camp page to observe the now-set grazing quality.
      await page.getByRole('button', { name: /Report Camp Condition/i }).click();
      await page.getByRole('button', { name: new RegExp(`^${grazing}$`) }).click();
      await page.getByRole('button', { name: /^Full$/ }).click();
      await page.getByRole('button', { name: /^Intact$/ }).click();
      await page.getByRole('button', { name: /Submit Camp Report/i }).click();
      await page.waitForURL(`**/${TENANT_SLUG}/logger`, { timeout: 10_000 });

      // Return to the camp page; the grazing_quality is now persisted in
      // IDB so the done-button + caption render against the recorded tier.
      await page.goto(
        `/${TENANT_SLUG}/logger/${encodeURIComponent(camp.camp_id)}`,
        { waitUntil: 'domcontentloaded' },
      );

      // The done-button renders the branched label.
      const doneButton = page.getByRole('button', { name: expectedButton });
      await expect(doneButton).toBeVisible({ timeout: 10_000 });

      // The caption renders the matching explanation.
      const caption = page.getByTestId('camp-condition-done-caption');
      await expect(caption).toBeVisible({ timeout: 5_000 });
      await expect(caption).toContainText(expectedCaptionSubstring);
    });
  }
});
