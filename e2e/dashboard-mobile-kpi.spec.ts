import { test, expect, type Page } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #467 — Mobile dashboard KPI strip fits the screen (no clipping).
 *
 * Root cause (verified live at 390px on prod via DOM measurement): the
 * dashboard top bar (`components/dashboard/DashboardClient.tsx`, the height-60
 * `/<slug>/dashboard` header) is a single non-wrapping flex row whose
 * logotype, weather widget (`maxWidth: 380`) and controls siblings are all
 * `flexShrink: 0`. The centered KPI/stats strip
 * (`components/dashboard/DashboardStatsStrip.tsx`) had `flex: 1` but no
 * `minWidth: 0` and no overflow affordance, so its min-content width (chips are
 * `whiteSpace: nowrap`) pinned it open and the overflow was *clipped* off the
 * right edge — the rightmost "Active Alerts" chip disappeared at ≤390px with
 * no way to scroll to it.
 *
 * The fix (PR for #467, purely presentational — KPI values + data contract
 * unchanged): the strip gets `minWidth: 0` (so it shrinks below its content
 * width inside the flex row instead of pushing the siblings off-screen) plus
 * `overflowX: auto` (so the overflow becomes an *intentional* horizontal
 * scroll region rather than a silent clip), and each chip gets
 * `flexShrink: 0` (so the labels stay readable). On desktop the chips fit, so
 * no scrollbar shows and `justifyContent: center` still centers them — the
 * desktop top-bar layout is unchanged (locked by the desktop guard below).
 *
 * This spec is the live regression lock: it drives the real `/<slug>/dashboard`
 * route at 390px on BOTH a single-species tenant (basson-boerdery) and a
 * multi-species tenant (trio-b-boerdery) and asserts (a) the "Active Alerts"
 * chip is fully visible (its bounding box right edge ≤ viewport width), and
 * (b) no top-bar element overflows the viewport's right edge while the document
 * is clamped to viewport width — any overflow must be inside the intentional
 * scroll container. The desktop guard at 1440px proves the strip is NOT a
 * scrolling container there (content fits) so desktop layout is untouched.
 *
 * The component-contract layer is locked separately and runs locally without
 * a server: `components/dashboard/__tests__/stats-strip-overflow.test.tsx`.
 *
 * Required env (self-skips when absent — same pattern as the rest of the
 * authenticated specs, e.g. dashboard-counter-stability.spec.ts):
 *   E2E_BASE_URL   — http://localhost:3000 in CI / preview URL for synthetic.
 *   E2E_IDENTIFIER — bench user identifier.
 *   E2E_PASSWORD   — bench user password.
 *   E2E_BASSON_SLUG — single-species tenant slug (default `basson-boerdery`).
 *   E2E_TRIO_B_SLUG — multi-species tenant slug (default `trio-b-boerdery`).
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const BASSON_SLUG = process.env.E2E_BASSON_SLUG ?? 'basson-boerdery';
const TRIO_B_SLUG = process.env.E2E_TRIO_B_SLUG ?? 'trio-b-boerdery';

/** iPhone 12/13/14 logical width — the prod-reproduced clipping viewport. */
const MOBILE_VIEWPORT = { width: 390, height: 844 };
/** A roomy desktop width where the chips comfortably fit. */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

/**
 * Navigate to /<slug>/dashboard and wait for the KPI strip to hydrate. The
 * strip is rendered by DashboardStatsStrip via `next/dynamic({ ssr: false })`,
 * so we wait on the "Active Alerts" chip label appearing rather than on a
 * fixed timeout. Returns false (skip signal) if the page bounced to /login or
 * /farms (bench user lacks access to the tenant on this clone).
 */
async function gotoDashboard(page: Page, slug: string): Promise<boolean> {
  await page.goto(`${BASE_URL}/${slug}/dashboard`, {
    waitUntil: 'domcontentloaded',
  });
  if (page.url().includes('/login') || page.url().includes('/farms')) {
    return false;
  }
  // The "Active Alerts" chip label is the rightmost chip — its presence proves
  // the strip mounted. framer-motion animates opacity from 0, so we wait on
  // attachment + the label text, not visibility-while-animating.
  await expect(
    page.getByText('Active Alerts', { exact: true }).first(),
  ).toBeAttached({ timeout: 15_000 });
  return true;
}

/** The rightmost KPI chip — the one that was clipped at 390px before #467. */
function activeAlertsChip(page: Page) {
  // The chip label span; `.locator('..')` climbs to the chip container so the
  // bounding box covers the whole chip (value + label), not just the label.
  return page
    .getByText('Active Alerts', { exact: true })
    .first()
    .locator('..');
}

test.describe('Issue #467 — mobile dashboard KPI strip (390px, no clipping)', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping authenticated mobile-KPI journey',
  );

  test.use({ viewport: MOBILE_VIEWPORT });

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  for (const { label, slug } of [
    { label: 'single-species (basson-boerdery)', slug: BASSON_SLUG },
    { label: 'multi-species (trio-b-boerdery)', slug: TRIO_B_SLUG },
  ]) {
    test(`${label}: Active Alerts chip is fully visible at 390px`, async ({
      page,
    }) => {
      const reached = await gotoDashboard(page, slug);
      test.skip(
        !reached,
        `${slug} not accessible to the bench user on this clone — leg skipped`,
      );

      const chip = activeAlertsChip(page);
      const box = await chip.boundingBox();
      expect(
        box,
        'Active Alerts chip must have a layout box (strip mounted)',
      ).not.toBeNull();

      // The chip's right edge must sit within the 390px viewport. Before #467
      // it overflowed (clipped) past 390 with no scroll. A small sub-pixel
      // tolerance absorbs rounding.
      expect(
        box!.x + box!.width,
        `Active Alerts chip right edge (${(box!.x + box!.width).toFixed(
          1,
        )}px) overflows the ${MOBILE_VIEWPORT.width}px viewport — KPI strip is being clipped (issue #467 regressed)`,
      ).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 0.5);

      // And its left edge must be >= 0 (not clipped off the left either).
      expect(box!.x, 'Active Alerts chip left edge must be on-screen').toBeGreaterThanOrEqual(
        -0.5,
      );
    });

    test(`${label}: no top-bar element silently overflows the viewport at 390px`, async ({
      page,
    }) => {
      const reached = await gotoDashboard(page, slug);
      test.skip(!reached, `${slug} not accessible to the bench user — leg skipped`);

      // The document itself must be clamped to the viewport width — no silent
      // horizontal clipping of the page. (The KPI strip's own overflow is an
      // *intentional* `overflow-x: auto` scroll region nested inside, which
      // does NOT widen the document, so this stays true even when the chips
      // are wider than the viewport.)
      const docScrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(
        docScrollWidth,
        `document scrollWidth (${docScrollWidth}px) exceeds the ${MOBILE_VIEWPORT.width}px viewport — something in the top bar pushes the page wider than the screen (silent clipping, not an intentional scroll container)`,
      ).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 0.5);
    });
  }
});

test.describe('Issue #467 — desktop guard (1440px, strip not a scroll container)', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping desktop-guard journey',
  );

  test.use({ viewport: DESKTOP_VIEWPORT });

  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  test('chips fit on desktop with no horizontal scroll in the KPI strip', async ({
    page,
  }) => {
    const reached = await gotoDashboard(page, BASSON_SLUG);
    test.skip(
      !reached,
      `${BASSON_SLUG} not accessible to the bench user — desktop guard skipped`,
    );

    const chip = activeAlertsChip(page);
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    expect(
      box!.x + box!.width,
      'Active Alerts chip must be fully visible on desktop',
    ).toBeLessThanOrEqual(DESKTOP_VIEWPORT.width + 0.5);

    // Desktop layout unchanged: the strip is wide enough that its content fits,
    // so it is NOT actually scrolling (scrollWidth ~= clientWidth). This proves
    // the `overflow-x: auto` affordance is dormant on desktop — i.e. the fix is
    // mobile-only in effect.
    const stripScroll = await chip.evaluate((el) => {
      // Climb from the chip to the strip container (the chip's flex parent).
      const strip = el.parentElement;
      if (!strip) return null;
      return {
        scrollWidth: strip.scrollWidth,
        clientWidth: strip.clientWidth,
      };
    });
    expect(stripScroll, 'strip container must be resolvable from the chip').not.toBeNull();
    expect(
      stripScroll!.scrollWidth,
      `KPI strip is horizontally scrolling on desktop (scrollWidth ${stripScroll!.scrollWidth} > clientWidth ${stripScroll!.clientWidth}) — desktop top-bar layout changed, which #467 must not do`,
    ).toBeLessThanOrEqual(stripScroll!.clientWidth + 1);
  });
});
