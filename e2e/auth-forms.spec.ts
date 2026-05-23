/**
 * e2e/auth-forms.spec.ts — Phase A working-condition repair.
 *
 * Tests the four user-visible bugs fixed in fix/A-auth-forms:
 *   A1. /login form must use method="post" (no GET credential leak).
 *   A2. /register form must use method="post" (no GET PII leak).
 *   A3. /register submit button must be disabled+aria-busy while in flight.
 *   A4. Bad-creds login emits zero console.error events.
 *   A5. Verify-email resend with invalid token emits zero console.error
 *       events.
 *
 * IMPORTANT: All tests are tagged test.skip because this spec requires
 * Playwright to be installed (pnpm add -D @playwright/test) and a running
 * dev server. Pattern matches e2e/einstein.spec.ts and e2e/tasks-geomap.spec.ts.
 *
 * Vitest covers the same invariants in __tests__/auth/. The Playwright
 * specs add the live-browser console-error assertion that jsdom can't —
 * see `page.on('console')` collector below.
 */

// When Playwright is installed, restore this import:
// import { test, expect } from "@playwright/test";
//
// For now we use a stub type so the file compiles under tsc without Playwright.
interface PlaywrightTestFn {
  (name: string, fn: () => Promise<void>): void;
  skip(name: string, fn: () => Promise<void>): void;
  describe: {
    configure(options: { mode: string }): void;
    (name: string, fn: () => void): void;
  };
}
declare const test: PlaywrightTestFn;
declare const expect: (value: unknown) => {
  toBe(v: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeVisible(): void;
  toContain(s: string): void;
  toHaveLength(n: number): void;
  toHaveURL(pattern: string | RegExp): void;
  toHaveAttribute(attr: string, value: string): void;
  not: {
    toBeVisible(): void;
    toBeEnabled(): void;
  };
};

const BASE = 'http://localhost:3001';

// ── A1: /login form method ────────────────────────────────────────────────────
test.skip('A1 — /login form uses method=post', async () => {
  // const { page } = await browser.newPage();
  // await page.goto(`${BASE}/login`);
  // const method = await page.locator('form').first().getAttribute('method');
  // expect(method?.toLowerCase()).toBe('post');
});

// ── A2: /register form method ─────────────────────────────────────────────────
test.skip('A2 — /register form uses method=post', async () => {
  // const { page } = await browser.newPage();
  // await page.goto(`${BASE}/register`);
  // const method = await page.locator('form').first().getAttribute('method');
  // expect(method?.toLowerCase()).toBe('post');
});

// ── A3: register submit disabled+aria-busy during request ─────────────────────
test.skip('A3 — /register submit button is disabled while request in flight', async () => {
  // const { page } = await browser.newPage();
  // await page.goto(`${BASE}/register`);
  //
  // Intercept POST /api/auth/register and stall it so the loading state
  // sticks long enough for the assertion.
  // await page.route('**/api/auth/register', async (route) => {
  //   await new Promise((r) => setTimeout(r, 2000));
  //   await route.fulfill({ status: 200, body: JSON.stringify({ success: true, pending: true }) });
  // });
  //
  // await page.fill('#name', 'Jan');
  // await page.fill('#email', 'jan@example.com');
  // await page.fill('#username', 'jan');
  // await page.fill('#farmName', 'Rietfontein');
  // await page.fill('#password', 'supersecret');
  // await page.fill('#confirmPassword', 'supersecret');
  //
  // const submit = page.locator('button[type="submit"]');
  // await submit.click();
  //
  // // While in flight, assert disabled + aria-busy.
  // await expect(submit).not.toBeEnabled();
  // expect(await submit.getAttribute('aria-busy')).toBe('true');
});

// ── A4: bad-creds login → zero console.error events ──────────────────────────
test.skip('A4 — bad-creds login emits zero console.error events', async () => {
  // const { page } = await browser.newPage();
  // const consoleErrors: string[] = [];
  // page.on('console', (msg) => {
  //   if (msg.type() === 'error') consoleErrors.push(msg.text());
  // });
  //
  // await page.goto(`${BASE}/login`);
  // await page.fill('#identifier', 'wrong@user.com');
  // await page.fill('#password', 'nope');
  // await page.click('button[type="submit"]');
  //
  // // Wait for the user-facing error copy.
  // await page.locator('text=/wrong username or password/i').waitFor();
  //
  // // The form must consume the 401 silently — Sentry/Vercel must not see it.
  // expect(consoleErrors).toHaveLength(0);
});

// ── A5: verify-email resend with invalid token → zero console.error ──────────
test.skip('A5 — verify-email resend with invalid token emits zero console.error events', async () => {
  // const { page } = await browser.newPage();
  // const consoleErrors: string[] = [];
  // page.on('console', (msg) => {
  //   if (msg.type() === 'error') consoleErrors.push(msg.text());
  // });
  //
  // await page.goto(`${BASE}/verify-email?token=invalid-token`);
  //
  // // Wait for the error panel.
  // await page.locator('text=/verification failed/i').waitFor();
  //
  // // Trigger the resend — this hits /api/auth/resend-verification which may 400.
  // await page.fill('input[type="email"]', 'user@example.com');
  // await page.click('button[type="submit"]');
  //
  // // Wait for either the success message or an inline error.
  // await page.waitForTimeout(500);
  //
  // expect(consoleErrors).toHaveLength(0);
});

// Make this file a TS module so its stub type declarations don't conflict with
// other e2e spec files that use the same global stub pattern.
export {};
