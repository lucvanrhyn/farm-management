import { test, expect, type Locator } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #469 (2026-05-28): Admin navigation tap targets meet the 44px minimum
 * on mobile.
 *
 * Root cause: in `components/admin/AdminNav.tsx`, the icon-only mobile NavLink
 * was `flex items-center justify-center ... px-2 ... py-2` with a `w-4 h-4`
 * icon and a `hidden md:inline` label. With no minimum hit-area floor the
 * link collapsed to roughly the icon + padding (~31×32px at 390px) — below
 * the 40px target threshold and WCAG 2.5.5 (44×44px). The rail is shared
 * across every admin route (`/admin/*`, `/tools/*`, `/sheep/*`, `/game/*`)
 * so the defect was global, not map-specific.
 *
 * What this spec locks:
 *   1. At 390px (iPhone 12/13/14 baseline), every interactive admin nav icon
 *      link presents a ≥44×44px bounding box.
 *   2. At 1440px the labelled desktop layout is intact: labels are visible and
 *      the links are left-aligned (md:justify-start, not centred).
 *
 * Auth-credential self-skip mirrors admin-journey + wave-262: forks without
 * secrets do not fail the suite. Reuses the shared `applyAuth` cookie fixture;
 * no credentials are echoed here.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'acme-cattle';

const MIN_TAP = 44;
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

// The nav rail is shared. Sample one route from each layout family that mounts
// AdminNav so we prove the floor holds everywhere, not just on /admin.
const ADMIN_ROUTES = ['/admin', '/admin/camps', '/admin/observations'] as const;

/**
 * Interactive admin nav icon links inside the rail. Every navigation target
 * (NavLink `<a>`, locked-premium `<button>`, and the multi-farm "Switch farm"
 * `<a>`) carries `data-nav-link`. The bottom-utility NotificationBell / Sign
 * out controls are deliberately NOT nav links and are out of scope for #469.
 * All `data-nav-link` elements are icon-only on mobile, so all must satisfy
 * the 44px floor.
 *
 * We scope to `:visible` because the multi-species admin nav is a collapsible
 * accordion: links inside collapsed sections are present in the DOM but
 * `display:none`, so they have no layout box and are not tappable. The 44px
 * tap-target floor only applies to links the user can actually reach. The
 * floor itself is enforced structurally by the shared `min-w-11 min-h-11`
 * NavLink classes (applied to every link regardless of accordion state), so a
 * visible sample is representative. Filtering to `:visible` makes the spec
 * robust across the single-species (flat, all visible) and multi-species
 * (accordion) nav shapes without misreading a collapsed-section link as an
 * undersized one.
 */
function navTargets(nav: Locator): Locator {
  return nav.locator('[data-nav-link]:visible');
}

test.describe('Issue #469 — admin nav tap targets ≥44px on mobile', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping admin-nav-tap-targets e2e',
  );

  test.describe('mobile (390px)', () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    for (const route of ADMIN_ROUTES) {
      test(`every nav icon link is ≥44×44px on ${route}`, async ({ context, page }) => {
        await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
        await page.goto(`${BASE_URL}/${TENANT_SLUG}${route}`, {
          waitUntil: 'domcontentloaded',
        });

        const nav = page.locator('[data-testid="admin-nav"]');
        await expect(nav).toBeVisible();

        const targets = navTargets(nav);
        const count = await targets.count();
        expect(count, 'admin nav should render at least one icon link').toBeGreaterThan(0);

        const undersized: string[] = [];
        for (let i = 0; i < count; i++) {
          const target = targets.nth(i);
          const box = await target.boundingBox();
          const title = (await target.getAttribute('title')) ?? `link ${i}`;
          if (!box) {
            undersized.push(`${title}: no bounding box`);
            continue;
          }
          if (box.width < MIN_TAP || box.height < MIN_TAP) {
            undersized.push(`${title}: ${box.width.toFixed(1)}×${box.height.toFixed(1)}`);
          }
        }

        expect(
          undersized,
          `Undersized tap targets (<${MIN_TAP}px) on ${route}:\n  ${undersized.join('\n  ')}`,
        ).toEqual([]);
      });
    }
  });

  test.describe('desktop (1440px)', () => {
    test.use({ viewport: DESKTOP_VIEWPORT });

    test('labelled layout is intact (labels visible, left-aligned)', async ({
      context,
      page,
    }) => {
      await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
      await page.goto(`${BASE_URL}/${TENANT_SLUG}/admin`, {
        waitUntil: 'domcontentloaded',
      });

      const nav = page.locator('[data-testid="admin-nav"]');
      await expect(nav).toBeVisible();

      // The Overview link is always rendered for every mode/tier. Its label
      // text must be visible (proves `hidden md:inline` reveals at md+).
      // `.first()`-qualified: on the multi-species nav an "Overview" section
      // header anchor and the Overview link can both carry the title, which
      // would otherwise trip Playwright strict mode.
      const overview = nav.locator('a[data-nav-link][title="Overview"]').first();
      await expect(overview).toBeVisible();
      await expect(overview).toContainText('Overview');

      // Left-aligned, not centred: the link's content starts near its left
      // edge rather than being horizontally centred. The icon sits within the
      // first third of the link width when md:justify-start is active.
      const linkBox = await overview.boundingBox();
      const icon = overview.locator('svg').first();
      const iconBox = await icon.boundingBox();
      expect(linkBox).not.toBeNull();
      expect(iconBox).not.toBeNull();
      if (linkBox && iconBox) {
        const iconOffset = iconBox.x - linkBox.x;
        expect(
          iconOffset,
          'desktop nav icon should be left-aligned, not centred',
        ).toBeLessThan(linkBox.width / 3);
      }
    });
  });
});
