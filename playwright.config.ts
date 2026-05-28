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
    // Issue #415 (2026-05-25): PRD #412 regression guard — `totalCamps` /
    // `inspectedToday` stability across FarmMode flips (#411) AND
    // `camp_condition` write busts the camps cache tag (#409). Negative
    // control: a `general` write must NOT touch the camps tiles. Self-skips
    // when E2E_IDENTIFIER / E2E_PASSWORD are unset.
    'dashboard-counter-stability.spec.ts',
    // Issue #439 (2026-05-27): React #418 hydration regression guard — walks
    // 6 routes on both Basson and Trio B tenants and asserts zero hydration
    // error console events on first paint. Root cause: WeatherWidget.tsx lazy
    // useState initializer reading navigator.geolocation (SSR=false, client
    // may=true). Fixed via useSsrSafeState. Self-skips when E2E_IDENTIFIER /
    // E2E_PASSWORD are unset.
    'no-react-hydration-errors.spec.ts',
    // Issue #438 (2026-05-27): PRD #434 — server-rendered farm hero regression
    // guard. Branded farm name must be in the initial HTML on every screenshot
    // in the first 1.5s after navigation. Locks the fix against the 3-state
    // loading flicker. Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset.
    'farm-home-no-flicker.spec.ts',
    // Issue #437 (2026-05-27): PRD #434 — species cache isolation regression
    // guard. Locks (a) `/api/camps?species=sheep` returns species-scoped
    // `last_inspected_at` (no cattle leak), (b) cattle→sheep→cattle
    // round-trip preserves cattle's `animal_count` (IDB mode partition),
    // (c) Sheep Logger on a cattle-only tenant renders the empty-state
    // banner instead of 19 misleading "0 animals · Just now" cards.
    // Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset.
    'species-cache-isolation.spec.ts',
    // Issue #436 (2026-05-27): PRD #434 — inline camp-condition submit must
    // surface a visible toast when the server rejects a same-day duplicate
    // with 422 DUPLICATE_OBSERVATION. Toast copy is sourced from the
    // shared `classifySyncFailure` classifier (one source of truth with
    // the background-sync path in `lib/sync-manager.ts`). Locks the
    // regression class where the inline handler used to silently close
    // the form after a duplicate. Self-skips when E2E_IDENTIFIER /
    // E2E_PASSWORD are unset.
    'camp-condition-duplicate-toast.spec.ts',
    // Issue #466 (2026-05-28): camp identity colours must never reach the
    // Mapbox `["to-color", ["get", "borderColor"]]` paint expression
    // unparseable. Root cause: a nullish-coalescing-only guard let a legacy
    // `color = ''` row slip through ("" ?? x === ""), firing a "could not
    // parse color" style-expression error on the Trio B admin camp map.
    // Fixed via the pure `normaliseCampColor` guard on both consumers. Loads
    // the Trio B + Basson admin camp maps and asserts zero colour-error
    // console events. Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset.
    'tenant-map-console-clean.spec.ts',
    // Issue #465 (2026-05-28): an offline camp-condition submit must NOT be
    // navigated away to the Serwist `/offline` fallback (that navigation
    // unmounts OfflineProvider — the queue owner — and breaks the
    // `online → syncNow` reconnect auto-drain). Asserts the user stays in the
    // logger offline and the queued report auto-drains on reconnect. Self-skips
    // when E2E_IDENTIFIER / E2E_PASSWORD are unset.
    'logger-offline-submit.spec.ts',
    // Issue #468 (2026-05-28): bounding-box regression guard — on a 390px
    // admin camp map the open Layers panel and the bottom-left action
    // cluster (Draw Camp Boundary) must NOT intersect, and the Draw button
    // must be fully visible (the reported truncation was spatial occlusion).
    // A desktop guard at 1440px proves the bottom-right anchor is unchanged.
    // Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset.
    'map-mobile-controls.spec.ts',
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
