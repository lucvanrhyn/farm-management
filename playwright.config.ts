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
  testMatch: [
    'smoke.spec.ts',
    'wave-22-layout-shell.spec.ts',
    'wave-23-interactives.spec.ts',
    // PRD #128 (2026-05-06): authenticated journey through the 8 admin
    // routes that crashed on prod after Phase A. Skipped at runtime when
    // E2E_IDENTIFIER / E2E_PASSWORD are unset (local dev), so safe to list
    // here unconditionally — CI sets the env from secrets.
    'admin-journey.spec.ts',
  ],
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
