/**
 * e2e/einstein.spec.ts — Phase L Wave 3F Playwright E2E
 *
 * Tests the critical Farm Einstein user flow end-to-end:
 *   1. Login as delta-livestock Advanced admin.
 *   2. Navigate to /delta-livestock/admin/einstein.
 *   3. Chat header shows assistant wordmark (configured assistantName or "Einstein").
 *   4. Type a question → press Enter → SSE stream begins (progressive token append).
 *   5. Final answer renders citations as [1] superscript chips.
 *   6. Hover [1] → tooltip appears with quote preview.
 *   7. Click thumbs-up → POST /api/einstein/feedback fires; UI shows feedback recorded.
 *   8. Navigate to /delta-livestock/admin/settings/ai → rename box visible,
 *      save button disabled for whitespace-only input.
 *
 * IMPORTANT: All tests are tagged test.skip because this spec requires:
 *   - A running dev server on localhost:3001 (pnpm dev --port 3001)
 *   - The delta-livestock tenant DB migrated with Phase L schema (Wave 4)
 *   - Playwright installed: pnpm add -D @playwright/test
 *   - OPENAI_API_KEY + ANTHROPIC_API_KEY in the dev server environment
 *
 * Pattern matches Phase K's e2e/tasks-geomap.spec.ts (7 skipped tests, same
 * stub type declarations). Once Playwright is installed and Wave 4 migrations
 * run, remove the test.skip() calls and restore the real import.
 *
 * The spec is serial because chat state (queryLogId) flows from step 4 to step 7.
 */

// When Playwright is installed, restore this import:
// import { test, expect } from "@playwright/test";
//
// For now we use a stub type so the file compiles under tsc without Playwright.
// The stub is only present until `@playwright/test` is added to devDependencies.
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
  toBeVisible(): void;
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

const FARM_SLUG = 'delta-livestock';
const BASE = 'http://localhost:3001';

// Use env vars in real runs — never hard-code creds in source.
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'luc@trio-b.farm';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? 'change-me-in-env';

// The question used in the chat flow. Phrased to have a real grounded answer
// in trio-b's seeded observation data.
const TEST_QUESTION = 'What observations were recorded in camp 1 this month?';

// ─────────────────────────────────────────────────────────────────────────────
// Spec (all steps skipped until Playwright runner installed + Wave 4 migrations)
// ─────────────────────────────────────────────────────────────────────────────

// test.describe.configure({ mode: "serial" });

// ── Step 1: Login ─────────────────────────────────────────────────────────────
test.skip('Step 1 — login as delta-livestock Advanced admin', async () => {
  // Requires Playwright + dev server. To activate, remove test.skip.
  //
  // const { page } = await browser.newPage();
  //
  // await page.goto(`${BASE}/login`);
  // await page.fill('[name="email"]', ADMIN_EMAIL);
  // await page.fill('[name="password"]', ADMIN_PASS);
  // await page.click('[type="submit"]');
  // await page.waitForURL(`${BASE}/${FARM_SLUG}/admin`);
  // expect(page.url()).toContain(`/${FARM_SLUG}/admin`);
  //
  // Save auth state so subsequent steps reuse the session:
  // await page.context().storageState({ path: 'e2e/.auth/trio-b-admin.json' });
  //
  // Note: storageState must be configured in playwright.config.ts:
  //   use: { storageState: 'e2e/.auth/trio-b-admin.json' }
});

// ── Step 2: Navigate to Einstein chat page ────────────────────────────────────
test.skip('Step 2 — navigate to Einstein chat page', async () => {
  // Requires: Step 1 auth state.
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/einstein`);
  // await page.waitForURL(`${BASE}/${FARM_SLUG}/admin/einstein`);
  // expect(page.url()).toContain('/admin/einstein');
  //
  // Verify the page loaded without error boundary
  // const errorBoundary = page.locator('[data-testid="error-boundary"]');
  // expect(await errorBoundary.isVisible()).toBeFalsy();
});

// ── Step 3: Assert assistant wordmark in header ───────────────────────────────
test.skip('Step 3 — chat header shows assistant wordmark', async () => {
  // Requires: Step 2 navigation.
  //
  // The EinsteinChat header renders the assistantName from aiSettings
  // (or "Einstein" as default). Look for either the configured name or the
  // default via a data-testid attribute on the header element.
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/einstein`);
  //
  // Assert wordmark is present (data-testid="einstein-wordmark" set by EinsteinChat.tsx)
  // const wordmark = page.locator('[data-testid="einstein-wordmark"]');
  // await wordmark.waitFor({ state: 'visible', timeout: 8_000 });
  // const wordmarkText = await wordmark.textContent();
  // expect(wordmarkText).toBeTruthy();
  //
  // The text must be non-empty — either default "Einstein" or the farm's configured name
  // expect(wordmarkText!.trim().length).toBeGreaterThan(0);
});

// ── Step 4: Type a question and observe SSE streaming ─────────────────────────
test.skip('Step 4 — type a question and observe progressive token streaming', async () => {
  // Requires: Step 2 auth + OPENAI_API_KEY + ANTHROPIC_API_KEY in dev env.
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/einstein`);
  //
  // Find the chat input textarea
  // const input = page.locator('[data-testid="einstein-input"]');
  // await input.waitFor({ state: 'visible', timeout: 8_000 });
  //
  // Type the question
  // await input.fill(TEST_QUESTION);
  // await input.press('Enter');
  //
  // SSE streaming: the assistant bubble should begin appearing progressively.
  // The in-progress bubble has aria-busy="true" while streaming.
  // const bubble = page.locator('[data-testid="einstein-answer-bubble"]');
  // await bubble.waitFor({ state: 'visible', timeout: 30_000 });
  // expect(await bubble.getAttribute('aria-busy')).toBe('true');
  //
  // Wait for streaming to complete (aria-busy becomes false or disappears)
  // await page.waitForFunction(
  //   () => {
  //     const el = document.querySelector('[data-testid="einstein-answer-bubble"]');
  //     return el && el.getAttribute('aria-busy') !== 'true';
  //   },
  //   { timeout: 60_000 }
  // );
  //
  // Verify the bubble has non-empty text content
  // const answerText = await bubble.textContent();
  // expect(answerText).toBeTruthy();
  // expect(answerText!.trim().length).toBeGreaterThan(10);
});

// ── Step 5: Citations render as [1] chips ─────────────────────────────────────
test.skip('Step 5 — final answer renders citation chips', async () => {
  // Requires: Step 4 answer complete.
  //
  // Citations are rendered as superscript chips: <sup data-testid="citation-chip-1">[1]</sup>
  // (CitationChip.tsx follows the inline [n] format per research brief).
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/einstein`);
  // // (re-run the question or carry page state from Step 4)
  //
  // Wait for a citation chip to appear
  // const citationChip = page.locator('[data-testid^="citation-chip-"]').first();
  // await citationChip.waitFor({ state: 'visible', timeout: 60_000 });
  //
  // The chip text should be a number (the citation index)
  // const chipText = await citationChip.textContent();
  // expect(chipText).toBeTruthy();
  // expect(Number(chipText)).toBeGreaterThan(0);
});

// ── Step 6: Hover citation chip → tooltip with quote preview ─────────────────
test.skip('Step 6 — hover citation chip reveals tooltip with quote preview', async () => {
  // Requires: Step 5 (citation chip visible).
  //
  // The CitationChip tooltip shows the source quote on hover.
  // data-testid="citation-tooltip" is set by CitationChip.tsx.
  //
  // const citationChip = page.locator('[data-testid^="citation-chip-"]').first();
  //
  // Hover the chip
  // await citationChip.hover();
  //
  // Wait for tooltip to appear
  // const tooltip = page.locator('[data-testid="citation-tooltip"]');
  // await tooltip.waitFor({ state: 'visible', timeout: 5_000 });
  // expect(await tooltip.isVisible()).toBeTruthy();
  //
  // Tooltip must contain a non-empty quote string
  // const tooltipText = await tooltip.textContent();
  // expect(tooltipText).toBeTruthy();
  // expect(tooltipText!.trim().length).toBeGreaterThan(0);
  //
  // Move away — tooltip should disappear
  // await page.mouse.move(0, 0);
  // await tooltip.waitFor({ state: 'hidden', timeout: 3_000 });
  // expect(await tooltip.isVisible()).toBeFalsy();
});

// ── Step 7: Thumbs-up feedback ────────────────────────────────────────────────
test.skip('Step 7 — click thumbs-up fires POST /api/einstein/feedback; UI confirms', async () => {
  // Requires: Step 4 complete (queryLogId in DOM via data attribute).
  //
  // EinsteinChat.tsx renders the thumbs-up button with:
  //   data-testid="feedback-up-btn"
  //   data-query-log-id="<id>"  (the queryLogId from the final SSE frame)
  //
  // const thumbsUp = page.locator('[data-testid="feedback-up-btn"]');
  // await thumbsUp.waitFor({ state: 'visible', timeout: 5_000 });
  //
  // Track the feedback API call
  // const feedbackRequest = page.waitForRequest(
  //   (req) => req.url().includes('/api/einstein/feedback') && req.method() === 'POST'
  // );
  //
  // await thumbsUp.click();
  // const req = await feedbackRequest;
  // const body = JSON.parse(req.postData() ?? '{}');
  // expect(body.feedback).toBe('up');
  // expect(typeof body.queryLogId).toBe('string');
  //
  // UI should show a "Feedback recorded" confirmation (aria-label or data-testid)
  // const confirmation = page.locator('[data-testid="feedback-confirmation"]');
  // await confirmation.waitFor({ state: 'visible', timeout: 5_000 });
  // expect(await confirmation.isVisible()).toBeTruthy();
});

// ── Step 8: Settings AI page — rename validation ──────────────────────────────
test.skip('Step 8 — settings/ai rename box visible; save disabled for whitespace-only input', async () => {
  // Requires: Step 1 auth + Wave 4 migrations (aiSettings column).
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/settings/ai`);
  // await page.waitForURL(`${BASE}/${FARM_SLUG}/admin/settings/ai`);
  //
  // Rename input should be visible (data-testid="assistant-name-input")
  // const renameInput = page.locator('[data-testid="assistant-name-input"]');
  // await renameInput.waitFor({ state: 'visible', timeout: 8_000 });
  // expect(await renameInput.isVisible()).toBeTruthy();
  //
  // The current value should be "Einstein" (default) or the farm's configured name
  // const currentValue = await renameInput.inputValue();
  // expect(currentValue.trim().length).toBeGreaterThan(0);
  //
  // Clear the input and type whitespace only
  // await renameInput.fill('   ');
  //
  // Save button should be disabled (data-testid="save-assistant-name-btn")
  // const saveBtn = page.locator('[data-testid="save-assistant-name-btn"]');
  // await saveBtn.waitFor({ state: 'visible', timeout: 3_000 });
  // expect(await saveBtn.isEnabled()).toBeFalsy();
  //
  // Typing a valid name should re-enable the save button
  // await renameInput.fill('FarmBot');
  // expect(await saveBtn.isEnabled()).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// Playwright setup instructions (for Wave 4 activation)
// ─────────────────────────────────────────────────────────────────────────────
// To activate this spec:
//
// 1. Install Playwright:
//    pnpm add -D @playwright/test
//    pnpm exec playwright install chromium
//
// 2. Add playwright.config.ts at the repo root:
//    import { defineConfig } from "@playwright/test";
//    export default defineConfig({
//      testDir: "./e2e",
//      use: {
//        baseURL: "http://localhost:3001",
//        storageState: "e2e/.auth/trio-b-admin.json",
//      },
//      webServer: {
//        command: "pnpm dev --port 3001",
//        port: 3001,
//        reuseExistingServer: !process.env.CI,
//      },
//    });
//
// 3. Create e2e/auth-setup.ts that logs in and saves storage state:
//    import { chromium } from "@playwright/test";
//    async function globalSetup() {
//      const browser = await chromium.launch();
//      const page = await browser.newPage();
//      await page.goto("http://localhost:3001/login");
//      await page.fill('[name="email"]', process.env.E2E_ADMIN_EMAIL!);
//      await page.fill('[name="password"]', process.env.E2E_ADMIN_PASS!);
//      await page.click('[type="submit"]');
//      await page.waitForURL(/admin/);
//      await page.context().storageState({ path: "e2e/.auth/trio-b-admin.json" });
//      await browser.close();
//    }
//    export default globalSetup;
//
// 4. Set env vars:
//    E2E_ADMIN_EMAIL=luc@trio-b.farm
//    E2E_ADMIN_PASS=<password>
//    OPENAI_API_KEY=<key>
//    ANTHROPIC_API_KEY=<key>
//
// 5. Run Wave 4 migrations first:
//    npx tsx scripts/migrate-phase-l-einstein.ts delta-livestock
//    npx tsx scripts/backfill-phase-l-embeddings.ts delta-livestock
//
// 6. Remove all test.skip() → test() in this file.
//    Remove the stub type declarations at the top.
//    Restore the real import: import { test, expect } from "@playwright/test";
//
// 7. Run: pnpm test:e2e

// Make this file a TS module so its stub type declarations don't conflict with
// other e2e spec files that use the same global stub pattern.
export {};
