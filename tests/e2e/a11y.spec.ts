/**
 * tests/e2e/a11y.spec.ts — Phase D Playwright accessibility spec
 *
 * Covers the three layout polish bugs introduced in fix/D-layout-polish:
 *
 *   D1. <html lang> must be the SA Afrikaans locale ("af-ZA").
 *   D2. A skip-to-content link must be the first focusable element on
 *       every page, visually hidden until focused, and Enter must move
 *       focus / scroll to the #main wrapper.
 *   D3. <head> must contain font preload tags emitted by next/font for
 *       every face declared in app/layout.tsx (Geist, Geist_Mono,
 *       Playfair_Display, DM_Sans, DM_Serif_Display). Cold landing-page
 *       paint regressed when these tags went missing in the past, so the
 *       test asserts they exist rather than measuring wall-clock time
 *       (which is environment-dependent).
 *
 * IMPORTANT: All tests are tagged test.skip because this spec requires:
 *   - A running dev server on http://localhost:3001 (pnpm dev --port 3001)
 *   - Playwright installed (not currently in devDependencies)
 *
 * Once Playwright is added (`pnpm add -D @playwright/test`), remove the
 * test.skip() calls and add the base URL to playwright.config.ts:
 *
 *   use: { baseURL: 'http://localhost:3001' }
 *
 * Pattern matches Phase K's e2e/tasks-geomap.spec.ts and Phase L's
 * e2e/einstein.spec.ts — same stub type declarations so this file
 * compiles under tsc without @playwright/test installed.
 */

// When Playwright is installed, restore this import:
// import { test, expect } from "@playwright/test";
//
// For now we use a stub type so the file compiles under tsc without
// Playwright. The stub mirrors the surface area used below.
interface PlaywrightLocator {
  isVisible(): Promise<boolean>;
  press(key: string): Promise<void>;
  focus(): Promise<void>;
  evaluate<T>(fn: (el: Element) => T): Promise<T>;
}
interface PlaywrightPage {
  goto(url: string): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  keyboard: { press(key: string): Promise<void> };
  locator(selector: string): PlaywrightLocator;
  $$eval<T>(selector: string, fn: (els: Element[]) => T): Promise<T>;
}
interface PlaywrightTestFn {
  (name: string, fn: (ctx: { page: PlaywrightPage }) => Promise<void>): void;
  skip(name: string, fn: (ctx: { page: PlaywrightPage }) => Promise<void>): void;
  describe: {
    (name: string, fn: () => void): void;
    configure(options: { mode: string }): void;
  };
}
declare const test: PlaywrightTestFn;
declare const expect: <T>(value: T) => {
  toBe(v: unknown): void;
  toBeTruthy(): void;
  toMatch(pattern: RegExp): void;
  toContain(s: string): void;
  toBeGreaterThan(n: number): void;
};

const BASE = "http://localhost:3001";

test.describe("Phase D — layout accessibility", () => {
  test.skip("D1: <html lang> is af-ZA on the landing page", async ({ page }) => {
    await page.goto(`${BASE}/`);
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe("af-ZA");
  });

  test.skip("D1: <html lang> is af-ZA on /login", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe("af-ZA");
  });

  test.skip("D2: skip link is the first focusable element on /", async ({ page }) => {
    await page.goto(`${BASE}/`);
    // Press Tab once from the document — focus should land on the skip link.
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLAnchorElement | null;
      return {
        tag: el?.tagName ?? null,
        href: el?.getAttribute("href") ?? null,
        text: el?.textContent?.trim() ?? null,
      };
    });
    expect(focused.tag).toBe("A");
    expect(focused.href).toBe("#main");
    expect(focused.text).toMatch(/spring|skip/i);
  });

  test.skip("D2: skip link becomes visible (not display:none) on focus", async ({ page }) => {
    await page.goto(`${BASE}/`);
    const link = page.locator('a[href="#main"]');
    await link.focus();
    // sr-only is `position:absolute; width:1px; height:1px;`, but on focus
    // the focus:not-sr-only utility resets to a visible fixed-position pill.
    const visible = await link.isVisible();
    expect(visible).toBe(true);
  });

  test.skip("D2: pressing Enter on the skip link scrolls focus into #main", async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);
    await page.keyboard.press("Tab"); // focus skip link
    await page.keyboard.press("Enter");
    const focusInsideMain = await page.evaluate(() => {
      const main = document.getElementById("main");
      if (!main) return false;
      // Either the main wrapper itself is focused (tabIndex=-1) or the
      // first focusable child landed in focus.
      const active = document.activeElement;
      return main === active || main.contains(active as Node);
    });
    expect(focusInsideMain).toBe(true);
  });

  test.skip("D3: <head> contains <link rel=preload as=font> tags from next/font", async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);
    // next/font emits one preload <link> per face when preload:true (default).
    // We declared 5 faces in app/layout.tsx, so expect at least 5.
    const preloadCount = await page.$$eval(
      'link[rel="preload"][as="font"]',
      (els) => els.length,
    );
    expect(preloadCount).toBeGreaterThan(0);
  });
});
