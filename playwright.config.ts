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
    // Issue #236 (2026-05-12): multi-species toggle — locks the cattle→sheep
    // dashboard flip, cookie persistence, per-tenant isolation, and the sheep
    // namespace routes against regression. Self-skips when auth creds are unset.
    'multi-species-toggle.spec.ts',
    // Issue #256 (2026-05-13): tenant map page — locks `/<slug>/map` against
    // regression. Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset.
    'tenant-map.spec.ts',
    // Issue #260 (2026-05-13): TenantRouteGuard for the global /sheep/* leak
    // paths (animals, camps, observations). The unauthenticated row runs
    // unconditionally; the authed rows self-skip without E2E_IDENTIFIER /
    // E2E_PASSWORD. ADR-0003 motivates the asymmetric route shape this guard
    // backstops.
    'sheep-global-redirect.spec.ts',
    // Issue #397 (2026-05-23): Serwist navigation cache cannot leak another
    // tenant's shell. Verifies NetworkOnly routes the `[farmSlug]` hard-nav
    // to network every time, and asserts static-asset caches still warm.
    // Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset, or when
    // E2E_SW_FARM_A_SLUG === E2E_SW_FARM_B_SLUG (CI must point at two
    // distinct tenants the synthetic user can access).
    'sw-tenant-isolation.spec.ts',
    // Issue #407 (2026-05-24): Logger last-visit badge must move off
    // "Yesterday" after the farmer submits a fresh camp_condition observation.
    // Parameterised across all four grazing-quality branches (Good / Fair /
    // Poor / Overgrazed). Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are
    // unset.
    'logger-last-visit-refresh.spec.ts',
    // Issue #406 (2026-05-24): TB1 — Logger done-button caption explains
    // why the button copy varies between "All Normal — Camp Good" and
    // "Done — no animals flagged". Parameterised across all four
    // grazing-quality branches. Self-skips when E2E_IDENTIFIER /
    // E2E_PASSWORD are unset.
    'logger-caption-visibility.spec.ts',
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
