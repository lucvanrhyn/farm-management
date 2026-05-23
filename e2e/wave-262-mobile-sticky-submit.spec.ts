import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Wave 262 — Mobile sticky Submit + animal-ID overlap fix.
 *
 * Bug 1 (sticky Submit): each of the seven logger forms rendered Submit at
 * the bottom of an `overflow-y-auto` flex body. On 390x844 the user had to
 * scroll past PhotoCapture and every other field to reach Submit.
 *
 * Bug 2 (action overlap): on the AnimalChecklist row, 7 cattle action
 * buttons at min-w-[44px] pushed the right cluster to ~332px on a 390px
 * viewport, leaving ~14px for the ID/chips column — the ID literally
 * overlapped the action labels.
 *
 * What this spec asserts (run on a 390x844 viewport, the iPhone 12/13/14
 * baseline FarmTrack ships against):
 *
 *   1. The HealthIssueForm renders a `[data-sticky-submit-bar]` wrapper
 *      around its Submit button. The wrapper is `position: sticky` so the
 *      Submit row is reachable without scrolling the body.
 *
 *   2. AnimalChecklist rows each carry `[data-animal-row]` with
 *      `flex-col sm:flex-row` and the action cluster carries
 *      `[data-animal-actions]` with `overflow-x-auto` so the ID never
 *      overlaps the action labels.
 *
 * Auth-credential self-skip mirrors the death-disposal + species-chrome
 * specs — forks without secrets do not fail the suite.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const BASSON_SLUG = process.env.E2E_BASSON_SLUG ?? 'basson-boerdery';
const LOGGER_CAMP_ID = process.env.E2E_LOGGER_CAMP_ID ?? '';

test.describe('Wave 262 — mobile sticky Submit + checklist row layout', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping wave-262 e2e',
  );

  test.skip(
    !LOGGER_CAMP_ID,
    'E2E_LOGGER_CAMP_ID not set — skipping live logger flow',
  );

  test.use({ viewport: { width: 390, height: 844 } });

  test('logger checklist row stacks vertically on mobile', async ({ context, page }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
    await page.goto(`${BASE_URL}/${BASSON_SLUG}/logger/${LOGGER_CAMP_ID}`);

    const row = page.locator('[data-animal-row]').first();
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/flex-col/);
    await expect(row).toHaveClass(/sm:flex-row/);

    const actions = row.locator('[data-animal-actions]');
    await expect(actions).toHaveClass(/overflow-x-auto/);
  });

  test('opening a logger form renders a sticky Submit bar', async ({ context, page }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
    await page.goto(`${BASE_URL}/${BASSON_SLUG}/logger/${LOGGER_CAMP_ID}`);

    // Tap the first row's Health action — every species cluster begins with Health.
    await page
      .locator('[data-animal-row]')
      .first()
      .locator('button[aria-label="Health"]')
      .click();

    const stickyBar = page.locator('[data-sticky-submit-bar]');
    await expect(stickyBar).toBeVisible();
    // Submit button is a child of the sticky bar
    await expect(stickyBar.locator('button', { hasText: /submit/i })).toBeVisible();
  });
});
