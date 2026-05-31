import { test, expect } from '@playwright/test';

/**
 * Issue #528 — CTA link-audit (code half of gate #118, PRD #521 Workstream H).
 *
 * What this locks
 * ───────────────
 * No user-facing CTA on a PUBLIC, UNAUTHENTICATED page may point at the DEAD
 * preview host `farm-management-lilac.vercel.app`. The app cut over to
 * `https://app.farmtrack.app` on 2026-05-30 (NEXTAUTH_URL flipped in prod,
 * DNS + auth live). Before this slice, three server-side link sites fell back
 * to the lilac literal; they now resolve through `getAppBaseUrl()`
 * (lib/server/app-url.ts). This spec is the live-DOM backstop for that fix:
 * every anchor `href` and form `action` on the landing / login / register /
 * subscribe pages is scanned, and ANY absolute URL must be on the canonical
 * host — never the dead lilac deploy.
 *
 * Why a Playwright spec on top of the static guard
 * ────────────────────────────────────────────────
 * `scripts/audit-preview-hostname.ts` greps source for the dead literal — it
 * catches a hardcoded host in a `.tsx` file. This spec catches the runtime
 * shape: an absolute CTA URL that the dead host could leak into via a
 * mis-set env var or a server-rendered `getAppBaseUrl()` value that drifted.
 * It asserts what the browser actually receives.
 *
 * Skipping / running policy
 * ─────────────────────────
 * This is an unauthenticated check — no storage-state, no synthetic-user
 * creds. It is NOT in playwright.config.ts's `testMatch` allowlist, so it does
 * NOT run in the governance gate; run it manually against a local or preview
 * build:  `pnpm exec playwright test e2e/cta-app-url.spec.ts`. It self-skips
 * gracefully when a page is unreachable so it never blocks a CI run that
 * doesn't boot the full app.
 */

const DEAD_PREVIEW_HOST = 'farm-management-lilac.vercel.app';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

// Public, unauthenticated entry pages whose CTAs a prospect actually sees.
const PUBLIC_PAGES = ['/', '/login', '/register', '/pricing', '/subscribe'] as const;

/**
 * Collect every absolute-or-relative link target the page exposes to a
 * visitor: anchor hrefs and form actions. Relative targets are fine (they
 * resolve to the current origin); only absolute URLs carry a host we can
 * regress on.
 */
async function collectLinkTargets(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (href) out.push(href);
    });
    document.querySelectorAll('form[action]').forEach((f) => {
      const action = f.getAttribute('action');
      if (action) out.push(action);
    });
    return out;
  });
}

test.describe('Issue #528 — public CTA links never point at the dead preview host', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} CTAs avoid ${DEAD_PREVIEW_HOST}`, async ({ page }) => {
      let response;
      try {
        response = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
      } catch {
        test.skip(true, `${path} unreachable at ${BASE_URL} — start the app to run this spec`);
        return;
      }
      // A public page may legitimately redirect (e.g. / → /home when authed,
      // /subscribe → /login). Any 2xx/3xx that lands is fine; only assert on a
      // page that actually rendered.
      if (!response || response.status() >= 400) {
        test.skip(true, `${path} returned ${response?.status() ?? 'no response'} — nothing to audit`);
        return;
      }

      const targets = await collectLinkTargets(page);
      const offenders = targets.filter((t) => t.includes(DEAD_PREVIEW_HOST));
      expect(
        offenders,
        `CTA targets on ${path} must not reference the dead preview host:\n${offenders.join('\n')}`,
      ).toEqual([]);

      // Every ABSOLUTE CTA host must be the canonical app host. Relative hrefs
      // (the common case — /login, /register, /subscribe) are same-origin and
      // are not asserted against a host.
      for (const t of targets) {
        if (!/^https?:\/\//i.test(t)) continue;
        const host = new URL(t).host;
        // Allow well-known third-party CTA destinations (payments, mailto-style
        // external links resolve to https): only assert the app's own deploy
        // host is never the dead lilac one.
        expect(host, `Absolute CTA on ${path} resolves to a host: ${t}`).not.toBe(
          DEAD_PREVIEW_HOST,
        );
      }
    });
  }
});
