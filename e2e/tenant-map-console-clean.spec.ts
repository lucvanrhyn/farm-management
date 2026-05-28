import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #466 — the camp map must never emit a colour/style-expression error.
 *
 * Root cause: the camp identity colour flowed into the Mapbox paint
 * expression `["to-color", ["get", "borderColor"]]` on the camp-outline
 * layer through a nullish-coalescing-only guard (`camp.color ?? DEFAULT`).
 * `"" ?? x === ""`, so a legacy `color = ''` row reached `to-color`, firing
 * a "could not parse color" style-expression console error and mis-rendering
 * the affected camps. The Trio B tenant carries such legacy data; Basson is
 * clean.
 *
 * The fix routes both consumers (camp-GeoJSON builder + admin-map camp
 * mapper) through the pure `normaliseCampColor` guard. This spec loads the
 * Trio B admin camp map, captures the console, and asserts ZERO
 * borderColor / to-color / "could not parse color" errors, and that the
 * Mapbox canvas (a valid camp outline surface) renders.
 *
 * Self-skips when E2E_IDENTIFIER / E2E_PASSWORD are unset (local dev without
 * creds). CI sets them from secrets. Trio B slug defaults to
 * `trio-b-boerdery` and is overridable via E2E_TRIO_B_SLUG.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TRIO_B_SLUG = process.env.E2E_TRIO_B_SLUG ?? 'trio-b-boerdery';
const BASSON_SLUG = process.env.E2E_BASSON_SLUG ?? 'basson-boerdery';

/**
 * Matches the Mapbox style-expression failure produced by an unparseable
 * colour reaching `["to-color", ["get", "borderColor"]]`. Mapbox phrases it
 * as "Error: ... to-color ... could not parse color" — we match any of the
 * three load-bearing fragments to stay resilient to wording drift.
 */
const COLOR_ERROR_RE = /could not parse color|to-color|borderColor/i;

/**
 * Navigate to the admin camp map and collect every error-level console
 * message that matches the colour/style-expression failure pattern within
 * the paint window (Mapbox evaluates layer paint after the canvas mounts).
 */
async function collectColorErrors(
  context: import('@playwright/test').BrowserContext,
  page: import('@playwright/test').Page,
  slug: string,
): Promise<string[]> {
  const errors: string[] = [];

  const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (COLOR_ERROR_RE.test(text)) errors.push(text);
  };
  // Mapbox also surfaces style-expression failures via the `error` event,
  // which Playwright reports as a pageerror.
  const onPageError = (err: Error) => {
    if (COLOR_ERROR_RE.test(err.message)) errors.push(err.message);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);

  const response = await page.goto(`${BASE_URL}/${slug}/admin/map`, {
    waitUntil: 'domcontentloaded',
  });
  const status = response?.status() ?? 0;
  expect(status, `HTTP ${status} for /${slug}/admin/map`).toBeLessThan(500);

  // Mapbox renders camps into a <canvas>. Wait for it to attach — proves the
  // map shell mounted and the paint expressions (including the outline
  // borderColor) were evaluated against the camp GeoJSON.
  await expect(
    page.locator('canvas').first(),
    'mapbox canvas (camp outline surface) mounts',
  ).toBeVisible({ timeout: 20_000 });

  // Give Mapbox a beat to evaluate paint for every camp feature.
  await page.waitForTimeout(2000);

  page.off('console', onConsole);
  page.off('pageerror', onPageError);

  return errors;
}

test.describe('Camp map colour normalisation (#466)', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping camp-map console-clean spec',
  );

  test('Trio B admin camp map loads with zero colour/style-expression errors', async ({
    context,
    page,
  }) => {
    const colorErrors = await collectColorErrors(context, page, TRIO_B_SLUG);

    expect(
      colorErrors,
      `colour/style-expression console error(s) on /${TRIO_B_SLUG}/admin/map: ${colorErrors.join(' | ')}`,
    ).toHaveLength(0);
  });

  test('Basson admin camp map remains clean (regression control)', async ({
    context,
    page,
  }) => {
    const colorErrors = await collectColorErrors(context, page, BASSON_SLUG);

    expect(
      colorErrors,
      `colour/style-expression console error(s) on /${BASSON_SLUG}/admin/map: ${colorErrors.join(' | ')}`,
    ).toHaveLength(0);
  });
});
