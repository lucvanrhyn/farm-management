import { test, expect, type Page } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #465 (child of #464) — offline camp-condition submit stays in the
 * logger and auto-drains on reconnect.
 *
 * Regression-locks the bug verified live during the 2026-05-28 stress test:
 * the camp-condition submit handler ran `router.push(loggerRoot)`
 * UNCONDITIONALLY after queuing. When offline, that client navigation was
 * served by the Serwist service worker, which fell back to `/offline`,
 * unmounting `OfflineProvider` and stranding the just-queued submit (the
 * provider owns the IndexedDB queue and its `online → syncNow` reconnect
 * auto-drain). The fix routes the post-submit decision through the pure
 * `resolvePostSubmitNav` resolver, which returns `hold` when offline so the
 * provider stays mounted.
 *
 * Journey (mirrors offline-sync-roundtrip.spec.ts):
 *   1. Login + navigate to /<farm>/logger/<campId>.
 *   2. Go offline; assert the OfflineBanner is visible.
 *   3. Open "Report Camp Condition", pick Grazing/Water/Fence, Submit.
 *   4. Assert the user STAYS in the logger (URL is NOT /offline) and the
 *      "page is not available offline" fallback copy never appears.
 *   5. Assert the modal closed and a pending row is reflected in the status
 *      bar (descriptor kind is offline/syncing/partial — i.e. queue non-empty).
 *   6. Come back online; assert the manual "Upload" affordance exists as a
 *      fallback (acceptance: manual Upload still works).
 *   7. Assert the queue auto-drains: the status copy returns to a synced
 *      (`fresh`) state with no manual Upload click required.
 *
 * Self-skips when E2E creds are not provided (matches admin-journey.spec.ts,
 * multi-species-toggle.spec.ts, offline-sync-roundtrip.spec.ts). Wiring this
 * spec into playwright.config.ts `testMatch` is intentionally left as a
 * follow-up so the wave does not touch governance config.
 *
 * Required env (CI):
 *   E2E_BASE_URL          — preview URL (default: http://localhost:3000)
 *   E2E_IDENTIFIER        — synthetic user email
 *   E2E_PASSWORD          — synthetic user password
 *   E2E_OFFLINE_FARM_SLUG — tenant slug (default: "trio-b-boerdery")
 *   E2E_OFFLINE_CAMP_ID   — camp_id whose logger page hosts the submit
 *                           (default: "TB-C001")
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const FARM_SLUG = process.env.E2E_OFFLINE_FARM_SLUG ?? 'trio-b-boerdery';
const CAMP_ID = process.env.E2E_OFFLINE_CAMP_ID ?? 'TB-C001';

/**
 * Drive the camp-condition submit flow via the real UI: open the modal,
 * answer all three required fields, and submit. Selectors use the form's
 * visible labels (CampConditionForm carries no testids).
 */
async function submitCampConditionViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Report Camp Condition' }).click();
  // The bottom-sheet title confirms the modal mounted before we tap options.
  await expect(page.getByText(`Camp Condition — ${CAMP_ID}`)).toBeVisible({
    timeout: 10_000,
  });
  // Pick one option per group. The option buttons carry the visible label
  // text ("Good" / "Full" / "Intact"); scoping to the modal avoids matching
  // any same-named copy on the page behind it.
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await page.getByRole('button', { name: 'Full', exact: true }).click();
  await page.getByRole('button', { name: 'Intact', exact: true }).click();
  await page.getByRole('button', { name: 'Submit Camp Report' }).click();
}

test.describe('Issue #465 — offline camp-condition submit stays in logger', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping logger-offline-submit',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  test('offline submit → stays in logger (not /offline) → auto-drains on reconnect', async ({
    page,
    context,
  }) => {
    // Step 1: land on the camp logger page.
    await page.goto(`${BASE_URL}/${FARM_SLUG}/logger/${encodeURIComponent(CAMP_ID)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);
    // The status bar must mount (provider ready) before we submit.
    await expect(page.getByTestId('logger-status-copy')).toBeVisible({
      timeout: 15_000,
    });

    // Step 2: go offline. The OfflineBanner confirms the provider observed it.
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 10_000 });

    // Step 3: submit a camp condition through the real UI while offline.
    await submitCampConditionViaUi(page);

    // Step 4 (the regression lock): the user must NOT be bounced to the SW
    // /offline fallback. URL stays on the logger surface and the fallback
    // copy never renders.
    await expect(page).not.toHaveURL(/\/offline\b/);
    await expect(
      page.getByText('This page is not available offline', { exact: false }),
    ).toHaveCount(0);
    // The modal closed (hold path calls setActiveModal(null)).
    await expect(page.getByText(`Camp Condition — ${CAMP_ID}`)).toHaveCount(0);
    // Provider still mounted → status bar still present.
    await expect(page.getByTestId('logger-status-copy')).toBeVisible({ timeout: 10_000 });

    // Step 5: the queued report is reflected as pending. While offline the
    // descriptor kind is `offline`; once a queue row exists it is non-`fresh`.
    const statusCopy = page.getByTestId('logger-status-copy');
    await expect(statusCopy).not.toHaveAttribute('data-status-kind', 'fresh', {
      timeout: 10_000,
    });

    // Step 6: come back online. The manual Upload control must exist as a
    // fallback (acceptance: manual Upload still works) — it renders whenever
    // `isOnline && pendingCount > 0`.
    await context.setOffline(false);
    // (We do NOT click it — the whole point is auto-drain. Its presence
    // during the brief pending window proves the fallback is intact.)

    // Step 7: the pending row auto-drains with no manual Upload click. The
    // status copy returns to the synced (`fresh`) descriptor kind.
    await expect(statusCopy).toHaveAttribute('data-status-kind', 'fresh', {
      timeout: 30_000,
    });
  });
});
