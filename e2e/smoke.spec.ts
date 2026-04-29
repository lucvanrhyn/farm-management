import { test, expect } from '@playwright/test';

/**
 * Governance gate smoke spec.
 *
 * These two checks MUST NOT be skipped — they run in CI against the built app.
 * For the full reasoning see .github/workflows/governance-gate.yml.
 *
 * Check 1 — /login renders the login form (email input, password input, submit).
 * Check 2 — / returns HTTP 200 and emits zero console.error events while settling.
 */

test('login page renders the auth form', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('home page returns 200 with no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  // Give the page a moment to settle (hydration, deferred fetches).
  await page.waitForTimeout(1000);

  expect(consoleErrors).toHaveLength(0);
});
