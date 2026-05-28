import { test, expect, type Locator } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #468 — Layers panel must not occlude the mobile map action cluster.
 *
 * Root cause (verified live): on a 390px-wide admin camp map, the open
 * **Layers** panel (bottom-right) and the bottom-left action cluster — which
 * holds the *Draw Camp Boundary* button — share the bottom band and meet in
 * the middle. The panel paints over the Draw button. The button label is
 * intact in the DOM ("Draw Camp Bou…" was occlusion, NOT CSS truncation), so
 * the fix is purely spatial.
 *
 * This spec is the bounding-box regression guard:
 *
 *   1. Mobile (390px): the *Draw Camp Boundary* action and the Layers panel
 *      bounding boxes DO NOT intersect, and the Draw button is fully visible
 *      inside the viewport (not clipped, not painted over).
 *
 *   2. Desktop (1440px): the Layers panel keeps its bottom-right anchor — the
 *      desktop control layout is unchanged. This guards against the mobile fix
 *      leaking into the desktop breakpoint.
 *
 * Auth-credential self-skip mirrors admin-journey / death-disposal: forks
 * without secrets do not fail the suite. CI sets the env from secrets.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
// Admin camp map lives at /<slug>/admin/map. Default to the multi-species
// trio-b tenant the reproducer used; overridable for the branch clone.
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'trio-b-boerdery';

/** Two axis-aligned rectangles intersect iff they overlap on BOTH axes. */
function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function bbox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'locator must have a bounding box (is it rendered & visible?)').not.toBeNull();
  return box!;
}

/**
 * Load the admin camp map and wait for the Mapbox canvas + overlay controls
 * to settle. Mapbox GL paints into a <canvas> asynchronously after the React
 * tree mounts; the overlay buttons are absolutely-positioned siblings that
 * appear once FarmMap renders. We wait on the canvas and the Draw button.
 */
async function gotoAdminMap(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/${TENANT_SLUG}/admin/map`, {
    waitUntil: 'domcontentloaded',
  });
  // Mapbox canvas mounts — proves the FarmMap shell bootstrapped.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
  // The Draw Camp Boundary button is part of the always-on action cluster.
  await expect(page.getByTestId('map-action-cluster')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('map-layer-toggle')).toBeVisible({ timeout: 15_000 });
  // Let the flyTo animation + control layout settle so bounding boxes are stable.
  await page.waitForTimeout(1_500);
}

test.describe('Issue #468 — map controls do not overlap on mobile', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping map-mobile-controls',
  );

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  test('390px: Layers panel does not occlude the Draw Camp Boundary button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAdminMap(page);

    const drawButton = page.getByRole('button', { name: /Draw Camp Boundary/ });
    const layerPanel = page.getByTestId('map-layer-toggle');

    await expect(drawButton, 'Draw Camp Boundary button renders').toBeVisible();
    await expect(layerPanel, 'Layers panel renders').toBeVisible();

    const drawBox = await bbox(drawButton);
    const panelBox = await bbox(layerPanel);

    // Core acceptance: the two overlays must NOT intersect at 390px.
    expect(
      rectsIntersect(drawBox, panelBox),
      `Draw button ${JSON.stringify(drawBox)} must not intersect Layers panel ${JSON.stringify(panelBox)}`,
    ).toBe(false);

    // The full Draw button must be inside the viewport (not clipped off-screen
    // and not painted over — its right edge stays within 390px).
    expect(drawBox.x, 'Draw button left edge >= 0').toBeGreaterThanOrEqual(0);
    expect(drawBox.x + drawBox.width, 'Draw button right edge within 390px').toBeLessThanOrEqual(390);
    expect(drawBox.y + drawBox.height, 'Draw button bottom within 844px').toBeLessThanOrEqual(844);
  });

  test('1440px: Layers panel keeps its bottom-right anchor (desktop unchanged)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAdminMap(page);

    const layerPanel = page.getByTestId('map-layer-toggle');
    const actionCluster = page.getByTestId('map-action-cluster');

    const panelBox = await bbox(layerPanel);
    const clusterBox = await bbox(actionCluster);

    // Measure the panel's right-edge gap against the layout viewport width
    // (`document.documentElement.clientWidth`), NOT the raw 1440 device width.
    // The panel is anchored to the content edge; a vertical scrollbar (~16px on
    // prod) narrows the content area below 1440, so measuring against 1440
    // folds the scrollbar width into the gap and falsely trips the 32px anchor
    // threshold. clientWidth is the true edge the panel docks to — this
    // subtracts the scrollbar at the root rather than relaxing the tolerance.
    const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);

    // Desktop: panel stays docked to the bottom-right quadrant.
    expect(panelBox.x, 'panel left edge sits in the right half on desktop').toBeGreaterThan(layoutWidth / 2);
    expect(
      layoutWidth - (panelBox.x + panelBox.width),
      'panel right edge stays within ~32px of the content viewport edge (bottom-right anchor)',
    ).toBeLessThanOrEqual(32);
    expect(
      900 - (panelBox.y + panelBox.height),
      'panel bottom edge stays within ~40px of the viewport bottom (bottom anchor)',
    ).toBeLessThanOrEqual(40);

    // Action cluster stays bottom-left on desktop.
    expect(clusterBox.x, 'action cluster sits in the left half on desktop').toBeLessThan(layoutWidth / 2);

    // And they still don't intersect on desktop (regression: must remain true).
    expect(rectsIntersect(panelBox, clusterBox), 'no overlap on desktop either').toBe(false);
  });
});
