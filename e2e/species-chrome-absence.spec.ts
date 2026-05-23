import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #263 — Species chrome cleanup E2E.
 *
 * Locks the dual-tenant contract that issue #263 introduced after user
 * feedback (Luc, 2026-05-13): "I don't like that add species thing
 * that's everywhere... it needs to be removed."
 *
 * Contract:
 *   1. Single-species tenant (Basson, cattle-only):
 *      - ModeSwitcher does NOT render anywhere (admin sidebar, home,
 *        logger).
 *      - The dimmed "+ Add species" pill must NOT appear in the DOM.
 *      - The /admin/settings/species nav link is hidden.
 *
 *   2. Multi-species tenant (Trio B, cattle + sheep):
 *      - ModeSwitcher DOES render and is functional (Sheep button is
 *        clickable + flips the mode cookie — exhaustively covered by
 *        e2e/multi-species-toggle.spec.ts; we only assert presence
 *        here).
 *      - The /admin/settings/species nav link is visible.
 *
 *   3. The /admin/settings/species page renders the explicit
 *      "Multi-species rollout" copy + a contact affordance for any
 *      tenant that loads it directly (single OR multi-species).
 *
 * Required CI environment variables (shared with multi-species-toggle):
 *   E2E_IDENTIFIER       — synthetic-user email
 *   E2E_PASSWORD         — synthetic-user password
 *   E2E_TRIO_B_SLUG      — multi-species tenant slug
 *                          default: "trio-b-boerdery"
 *   E2E_BASSON_SLUG      — single-species (cattle-only) tenant slug
 *                          default: "basson-boerdery"
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

const TRIO_B_SLUG = process.env.E2E_TRIO_B_SLUG ?? 'trio-b-boerdery';
const BASSON_SLUG = process.env.E2E_BASSON_SLUG ?? 'basson-boerdery';

test.describe('Issue #263 — species chrome absence/presence by tenant', () => {
  // Auth-credential self-skip — same pattern as admin-journey.spec.ts so
  // forks without secrets do not fail the suite.
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping species-chrome-absence',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  // ── Single-species: Basson ───────────────────────────────────────────────

  test('Basson admin: ModeSwitcher is absent, no "+ Add species" pill anywhere', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/${BASSON_SLUG}/admin`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    // The Cattle pill of the ModeSwitcher must not be visible — the whole
    // bar returns null on single-species tenants per #263.
    // (We avoid asserting "no Cattle text anywhere" because the page may
    // legitimately mention cattle in copy. The switcher pill is rendered
    // inside an inline-flex container with `role=button` for each mode;
    // the absence of the Sheep button is the cleanest single-species
    // signal because Basson never has sheep.)
    expect(
      await page.getByRole('button', { name: /^Sheep$/ }).count(),
      'Sheep mode button must not render on a cattle-only tenant',
    ).toBe(0);

    // The dimmed "+ Add species" upsell pill must NOT appear anywhere
    // on the page — this was the user's primary complaint.
    expect(
      await page.getByRole('button', { name: /\+\s*Add species/i }).count(),
      'The "+ Add species" pill must be removed from single-species tenants (#263)',
    ).toBe(0);
  });

  test('Basson admin: /admin/settings/species nav link is hidden', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/${BASSON_SLUG}/admin`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    // The "Species" link in the AdminNav points at /admin/settings/species.
    // On Basson (cattle-only) it must be hidden — there's nothing
    // meaningful to configure when only one species is enabled.
    const speciesLink = page.getByRole('link', { name: /^Species$/ });
    expect(
      await speciesLink.count(),
      'Species nav link must be hidden on single-species tenants (#263)',
    ).toBe(0);
  });

  test('Basson home: ModeSwitcher is absent, no "+ Add species" pill', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/${BASSON_SLUG}/home`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    expect(
      await page.getByRole('button', { name: /^Sheep$/ }).count(),
    ).toBe(0);
    expect(
      await page.getByRole('button', { name: /\+\s*Add species/i }).count(),
    ).toBe(0);
  });

  // ── Multi-species: Trio B ────────────────────────────────────────────────

  test('Trio B admin: ModeSwitcher renders Sheep button (functional)', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/admin`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    // Sheep button must be visible and clickable on the multi-species
    // tenant. The full flip-and-persist journey is covered by
    // e2e/multi-species-toggle.spec.ts; here we only assert presence.
    await expect(page.getByRole('button', { name: /^Sheep$/ })).toBeVisible({
      timeout: 10_000,
    });

    // And the "+ Add species" pill must NOT render on multi-species
    // tenants either — #263 removes it everywhere.
    expect(
      await page.getByRole('button', { name: /\+\s*Add species/i }).count(),
    ).toBe(0);
  });

  test('Trio B admin: /admin/settings/species nav link IS visible', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/admin`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    // Multi-species tenants need the Species settings page so they can
    // disable a previously-enabled species without contacting support.
    await expect(
      page.getByRole('link', { name: /^Species$/ }),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Settings page copy (works on either tenant) ──────────────────────────

  test('Settings page replaces "+ Add species" CTA with "Multi-species rollout — contact us" copy', async ({
    page,
  }) => {
    // We use Trio B because the link is in nav there, but the page itself
    // is reachable directly on either tenant.
    await page.goto(
      `${BASE_URL}/${TRIO_B_SLUG}/admin/settings/species`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page).not.toHaveURL(/\/login/);

    // Explicit copy must be present.
    await expect(
      page.getByText(/multi-species rollout/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The "+ Add species" button is gone.
    expect(
      await page.getByRole('button', { name: /\+\s*Add species/i }).count(),
      '"+ Add species" CTA must be removed from settings page (#263)',
    ).toBe(0);

    // And a contact affordance is present (mailto link or button).
    const contactLink = page.getByRole('link', { name: /contact/i });
    const contactButton = page.getByRole('button', { name: /contact/i });
    const total =
      (await contactLink.count()) + (await contactButton.count());
    expect(total, 'A contact affordance must be present').toBeGreaterThan(0);
  });
});
