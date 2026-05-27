import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #436 (parent PRD #434) — inline camp-condition submit must show a
 * visible toast when the server rejects a same-day duplicate with
 * 422 DUPLICATE_OBSERVATION. Before this slice, the inline submit handler
 * queued the row, fire-and-forget `syncNow()`, then `router.push` back to
 * the logger root — so any duplicate detected during the background sync
 * landed in the dead-letter bucket invisibly. This spec locks the toast
 * regression class.
 *
 * Probe shape:
 *  1. Open the first camp on the tenant.
 *  2. Submit a Good / Full / Intact camp-condition reading (first inspect).
 *  3. Re-open the form on the SAME camp / SAME day.
 *  4. Submit IDENTICAL values — server should reject with 422
 *     DUPLICATE_OBSERVATION (lib/domain/observations/errors.ts:158).
 *  5. Assert the toast `[data-testid="camp-condition-submit-toast"]` is
 *     visible carrying the classifier's "Already logged today" copy.
 *
 * Required env (self-skips when absent — same pattern as admin-journey.spec.ts):
 *   E2E_BASE_URL — http://localhost:3000 in CI / preview URL.
 *   E2E_IDENTIFIER — bench user identifier.
 *   E2E_PASSWORD — bench user password.
 *   E2E_TENANT_SLUG — typically `acme-cattle` on the clone.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'acme-cattle';

// Copy is owned by `lib/sync/failure-classifier.ts`. The substring "Already
// logged today" is the load-bearing slice the farmer reads; pinning the
// substring (not the full sentence) keeps the spec resilient to a future
// copy polish on the classifier side.
const DUPLICATE_TOAST_SUBSTRING = /Already logged today/i;

test.describe('Issue #436 — inline camp-condition duplicate toast', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping authenticated logger journey',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  test('same-day re-submit surfaces the classifier-sourced toast in-form', async ({
    page,
    request,
  }) => {
    // Resolve the first camp via /api/camps so the spec works on any tenant.
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

    // First inspection — establishes the canonical row the server will
    // dedupe against on the second submit.
    await page.goto(
      `/${TENANT_SLUG}/logger/${encodeURIComponent(camp.camp_id)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.getByRole('button', { name: /Report Camp Condition/i }).click();
    await page.getByText('Good', { exact: true }).click();
    await page.getByText('Full', { exact: true }).click();
    await page.getByText('Intact', { exact: true }).click();
    await page.getByRole('button', { name: /Submit Camp Report/i }).click();

    // The handler navigates back to /[slug]/logger on the happy path.
    await page.waitForURL(`**/${TENANT_SLUG}/logger`, { timeout: 15_000 });

    // Give the server a moment to commit the first observation so the
    // second POST has something to dedupe against. The dedup window is
    // the tenant's calendar day (per-tenant tz, see #378).
    await page.waitForTimeout(1500);

    // Second inspection — same camp, same day, same details. The server
    // emits 422 DUPLICATE_OBSERVATION with `details.existingId`; the
    // inline handler classifies via `classifySyncFailure` and surfaces
    // the toast.
    await page.goto(
      `/${TENANT_SLUG}/logger/${encodeURIComponent(camp.camp_id)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.getByRole('button', { name: /Report Camp Condition/i }).click();
    await page.getByText('Good', { exact: true }).click();
    await page.getByText('Full', { exact: true }).click();
    await page.getByText('Intact', { exact: true }).click();
    await page.getByRole('button', { name: /Submit Camp Report/i }).click();

    // Toast must be visible — sourced from `classifySyncFailure(422, body).toast`.
    const toast = page.getByTestId('camp-condition-submit-toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toHaveText(DUPLICATE_TOAST_SUBSTRING);
  });
});
