import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Wave 3b / #254 (PRD #250) — Death modal: single-cause radio + required
 * carcassDisposal <select>.
 *
 * Locks the UX-layer half of the defense-in-depth fix. The server-side
 * validator (`lib/server/validators/death.ts`) is exercised by the
 * Vitest suite at `__tests__/api/observations/death-validator.test.ts` —
 * this spec asserts the rendered DeathModal:
 *
 *   1. Renders a `role="radiogroup"` with one `role="radio"` per cause —
 *      the structural single-select invariant. Multi-cause silent-data-
 *      loss cannot be re-introduced at the UX layer.
 *
 *   2. Renders a required `<select>` for carcass disposal whose options
 *      are EXACTLY the four maintainer-locked enum values
 *      (BURIED, BURNED, RENDERED, OTHER) — the same enum that
 *      CARCASS_DISPOSAL_VALUES exports from the validator and the
 *      migration `migrations/0021_death_carcass_disposal.sql` mirrors.
 *
 *   3. The "Record Death" submit button is disabled until BOTH cause and
 *      disposal have been chosen — the joint-validity gate.
 *
 * Required CI environment variables (shared with admin-journey,
 * multi-species-toggle, species-chrome-absence):
 *   E2E_IDENTIFIER       — synthetic-user email
 *   E2E_PASSWORD         — synthetic-user password
 *   E2E_BASSON_SLUG      — single-species (cattle-only) tenant slug
 *                          default: "basson-boerdery"
 *   E2E_DEATH_CAMP_ID    — id of a camp on the tenant that has at least
 *                          one active animal — required for the modal to
 *                          actually mount through the logger flow.
 *                          When unset, the spec falls back to a direct
 *                          modal-mount harness (TODO once the wave's
 *                          test-mount route lands; currently auth-skipped).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

const BASSON_SLUG = process.env.E2E_BASSON_SLUG ?? 'basson-boerdery';
const DEATH_CAMP_ID = process.env.E2E_DEATH_CAMP_ID ?? '';

test.describe('Wave 3b / #254 — DeathModal single-cause + required disposal', () => {
  // Auth-credential self-skip — same pattern as species-chrome-absence and
  // admin-journey. Forks without secrets do not fail the suite.
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping death-disposal',
  );

  // Camp-id self-skip — without a camp that has at least one active animal,
  // the logger flow cannot reach the DeathModal. We skip the rendered-modal
  // assertions in that case rather than papering over with a brittle stub.
  test.skip(
    !DEATH_CAMP_ID,
    'E2E_DEATH_CAMP_ID not set — skipping live DeathModal flow',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  test('cause picker is a radiogroup with single-select invariant', async ({ page }) => {
    await page.goto(`${BASE_URL}/${BASSON_SLUG}/logger/${DEATH_CAMP_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    // Open the first animal's action menu and pick "Death".
    const firstAnimalMenu = page
      .getByRole('button', { name: /open actions for/i })
      .first();
    await firstAnimalMenu.click({ timeout: 10_000 });

    await page.getByRole('button', { name: /^Death$/ }).click();

    // The modal must mount with a radiogroup (not a list of click-to-submit
    // buttons — that was the pre-#254 shape).
    const radiogroup = page.getByRole('radiogroup', { name: /cause of death/i });
    await expect(radiogroup).toBeVisible({ timeout: 5_000 });

    const radios = page.getByRole('radio');
    expect(await radios.count(), 'at least one cause radio must render').toBeGreaterThan(0);

    // Single-select invariant: clicking the second radio unchecks the first.
    await radios.nth(0).click();
    await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
    await radios.nth(1).click();
    await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'false');
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
  });

  test('carcass disposal is a required select with the four enum values', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/${BASSON_SLUG}/logger/${DEATH_CAMP_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    await page
      .getByRole('button', { name: /open actions for/i })
      .first()
      .click({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Death$/ }).click();

    const select = page.getByLabel(/carcass disposal/i);
    await expect(select).toBeVisible({ timeout: 5_000 });
    await expect(select).toHaveAttribute('required', '');

    // Options must be exactly {BURIED, BURNED, RENDERED, OTHER} (plus the
    // empty "Select disposal method…" placeholder).
    const optionValues = await select.locator('option').evaluateAll((opts) =>
      (opts as HTMLOptionElement[]).map((o) => o.value).filter((v) => v !== ''),
    );
    expect(optionValues.sort()).toEqual(['BURIED', 'BURNED', 'OTHER', 'RENDERED']);
  });

  test('"Record Death" submit is disabled until both cause and disposal chosen', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/${BASSON_SLUG}/logger/${DEATH_CAMP_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    await page
      .getByRole('button', { name: /open actions for/i })
      .first()
      .click({ timeout: 10_000 });
    await page.getByRole('button', { name: /^Death$/ }).click();

    const submit = page.getByRole('button', { name: /record death/i });
    await expect(submit).toBeDisabled();

    // Pick a cause only — still blocked.
    await page.getByRole('radio').first().click();
    await expect(submit).toBeDisabled();

    // Pick disposal too — now enabled.
    await page.getByLabel(/carcass disposal/i).selectOption('BURIED');
    await expect(submit).toBeEnabled();
  });
});
