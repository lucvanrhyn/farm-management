import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for governance-gate smoke tests.
 *
 * - testDir: 'e2e' — all specs live there.
 * - Only chromium is installed in CI (npx playwright install --with-deps chromium).
 * - webServer block is intentionally absent: CI starts the server explicitly
 *   via `pnpm start` + `wait-on`. For local runs, start the server manually
 *   (`pnpm start`) before running `pnpm smoke`.
 */
export default defineConfig({
  testDir: 'e2e',
  // Only run gate-blocking specs. The other e2e/*.spec.ts files use the
  // pre-Playwright `test.skip` placeholder pattern (no import of `test`)
  // and would fail to load. New gate-blocking specs are explicitly listed here.
  testMatch: ['smoke.spec.ts', 'wave-22-layout-shell.spec.ts'],
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
