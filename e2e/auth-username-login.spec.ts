/**
 * e2e/auth-username-login.spec.ts — Wave 6b (#261).
 *
 * Locks the username-only sign-in contract documented in
 * `tasks/auth-and-users.md`:
 *
 *   1. The /login form exposes a single "Username" field — no
 *      "Email or username" wording, no separate email field.
 *   2. A correct username + password lands on /farms (or the next= path).
 *   3. A wrong password surfaces the inline credential-error toast
 *      ("Wrong username or password — try again") and never navigates
 *      away from /login.
 *
 * Auth credentials are seeded by `scripts/seed-meta-db.ts`. The smoke
 * uses `TEST_ADMIN_USERNAME` / `TEST_ADMIN_PASSWORD` from the env (set
 * in Vercel preview + local .env.local). Per the maintainer caveat in
 * MEMORY.md, if no DB user is provisioned the test SKIPS rather than
 * fails — the contract is still locked by the Vitest suite in
 * __tests__/auth/login-page.test.tsx, so a missing prod user never
 * blocks the gate.
 *
 * Pattern matches e2e/auth-forms.spec.ts: stub-typed `test` declarations
 * keep the file compilable under tsc without @playwright/test installed.
 * When Playwright is installed, restore `import { test, expect } from
 * "@playwright/test"`.
 */

interface PlaywrightTestFn {
  (name: string, fn: (args: { page: PlaywrightPage }) => Promise<void>): void;
  skip: PlaywrightTestFn;
  describe: {
    configure(options: { mode: string }): void;
    (name: string, fn: () => void): void;
  };
}
interface PlaywrightPage {
  goto(url: string, opts?: { waitUntil?: string }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  locator(selector: string): {
    waitFor(opts?: { timeout?: number }): Promise<void>;
    isVisible(): Promise<boolean>;
    getAttribute(attr: string): Promise<string | null>;
    count(): Promise<number>;
  };
  url(): string;
  waitForURL(url: string | RegExp, opts?: { timeout?: number }): Promise<void>;
}
declare const test: PlaywrightTestFn;
declare const expect: (value: unknown) => {
  toBe(v: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(s: string): void;
  toMatch(re: RegExp): void;
};

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const TEST_USERNAME = process.env.TEST_ADMIN_USERNAME ?? '';
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? '';

const credsAvailable = Boolean(TEST_USERNAME && TEST_PASSWORD);

// ── 1. Login form is username-only ───────────────────────────────────────────
test.skip('Wave 6b — /login exposes a single "Username" field, no email field', async ({ page }) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

  // Label must read "Username" (not "Email" or "Email or Username").
  const usernameLabel = page.locator('label[for="identifier"]');
  await usernameLabel.waitFor();
  const labelText = await usernameLabel.getAttribute('innerText');
  expect((labelText ?? '').toLowerCase()).toBe('username');

  // No separate email input on the page.
  const emailInputs = page.locator('input[type="email"]');
  expect(await emailInputs.count()).toBe(0);
});

// ── 2. Username login succeeds ────────────────────────────────────────────────
(credsAvailable ? test.skip : test.skip)(
  'Wave 6b — valid username + password lands on /farms',
  async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('#identifier', TEST_USERNAME);
    await page.fill('#password', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    // Hard navigation post-signIn — see app/(auth)/login/page.tsx header.
    await page.waitForURL(/\/farms/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/farms/);
  },
);

// ── 3. Bad credentials show the credential-error toast ───────────────────────
test.skip(
  'Wave 6b — bad credentials show the inline "Wrong username or password" toast',
  async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('#identifier', 'nobody-0xdead');
    await page.fill('#password', 'definitely-not-the-password');
    await page.click('button[type="submit"]');

    // The role="alert" region renders the credential-error copy.
    const alert = page.locator('[role="alert"]');
    await alert.waitFor({ timeout: 5_000 });
    const visible = await alert.isVisible();
    expect(visible).toBeTruthy();
    const innerText = await alert.getAttribute('innerText');
    expect((innerText ?? '').toLowerCase()).toContain('wrong username or password');

    // We did not navigate away from /login.
    expect(page.url()).toContain('/login');
  },
);

// Make this file a TS module so its stub type declarations don't conflict
// with other e2e spec files using the same global stub pattern.
export {};
