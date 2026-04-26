/**
 * e2e/subscribe-complete.spec.ts — Phase B fix Playwright E2E
 *
 * Tests the /subscribe/complete return-path guard:
 *
 *   1. GET /subscribe/complete (no params) → page renders an actionable
 *      error within 2 s, exposing a CTA back to /farms (or /login when
 *      unauthenticated). It MUST NOT show the "Confirming payment…"
 *      spinner that previously ran for 24 s before bottoming out at an
 *      ambiguous timeout.
 *
 *   2. GET /subscribe/complete?farm=basson-boerdery → behaviour
 *      unchanged: the "Confirming payment…" polling spinner renders.
 *
 * IMPORTANT: All tests are tagged test.skip because this spec requires:
 *   - A running dev server on localhost:3001 (pnpm dev --port 3001)
 *   - Playwright installed: pnpm add -D @playwright/test
 *
 * Pattern matches e2e/einstein.spec.ts and e2e/tasks-geomap.spec.ts —
 * stub Playwright type so the file compiles under tsc without the
 * dependency installed. Once @playwright/test lands in devDependencies,
 * remove the test.skip() wrappers and restore the real import.
 */

// When Playwright is installed, restore this import:
// import { test, expect } from "@playwright/test";
//
// For now we use a stub type so the file compiles under tsc without Playwright,
// AND so vitest registers a skipped suite at the top level (matches
// e2e/einstein.spec.ts pattern).
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
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeVisible(options?: { timeout?: number }): void;
  toContain(s: string): void;
  toHaveURL(pattern: string | RegExp): void;
  toHaveAttribute(attr: string, value: string): void;
  not: {
    toBeVisible(): void;
    toBeEnabled(): void;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared constants
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "http://localhost:3001";
const HAPPY_FARM_SLUG = "basson-boerdery";

// ─────────────────────────────────────────────────────────────────────────────
// Spec (skipped until @playwright/test lands in devDependencies)
// ─────────────────────────────────────────────────────────────────────────────

// ── Step 1: Missing ?farm= renders the actionable error within 2 s ─────────
test.skip(
  "missing ?farm= renders actionable error within 2s, no 24s spin",
  async () => {
    // Requires Playwright + dev server. To activate, install @playwright/test
    // and remove `test.skip` (use `test` instead).
    //
    // const start = Date.now();
    // await page.goto(`${BASE}/subscribe/complete`);
    //
    // // Actionable error must appear quickly — well within 2s.
    // // Previously this code path silently spun for 24s.
    // await expect(page.getByText(/couldn't identify your farm/i)).toBeVisible({ timeout: 2000 });
    //
    // const elapsed = Date.now() - start;
    // expect(elapsed < 2000).toBeTruthy();
    //
    // // The polling spinner copy must NOT appear on the missing-param path.
    // await expect(
    //   page.getByText(/Please wait while PayFast confirms your subscription/i),
    // ).not.toBeVisible();
    //
    // // CTA button takes the user out of the dead end.
    // const cta = page.getByRole('button', { name: /go to my farms|return|sign in/i });
    // await expect(cta).toBeVisible();
    void BASE;
  },
);

// ── Step 2: Happy path with ?farm= still renders the polling spinner ──────
test.skip(
  "happy path with ?farm= still renders the polling spinner",
  async () => {
    // Requires Playwright + dev server. To activate, install @playwright/test
    // and remove `test.skip` (use `test` instead).
    //
    // await page.goto(`${BASE}/subscribe/complete?farm=${HAPPY_FARM_SLUG}`);
    //
    // // Polling spinner copy is rendered.
    // await expect(page.getByText(/Confirming payment/i)).toBeVisible();
    // await expect(
    //   page.getByText(/Please wait while PayFast confirms your subscription/i),
    // ).toBeVisible();
    //
    // // The missing-farm error must NOT appear on the happy path.
    // await expect(page.getByText(/couldn't identify your farm/i)).not.toBeVisible();
    void HAPPY_FARM_SLUG;
  },
);
