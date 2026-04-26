/**
 * e2e/observations.spec.ts — Phase H Playwright E2E
 *
 * Tests the observation animal-picker user flow end-to-end:
 *   1. Login as delta-livestock Advanced admin.
 *   2. Navigate to /delta-livestock/admin/observations.
 *   3. Click "+ New Entry" → modal opens.
 *   4. Pick an animal-linked observation type (e.g. "weighing").
 *   5. Pick a camp (sets the prefetched quick-pick scope).
 *   6. Type a query into the AnimalPicker → debounced /api/animals?search=
 *      request fires within ~500 ms → result rows render.
 *   7. Click a result → input's controlled feedback shows the chosen animalId.
 *   8. Verify that an empty query does NOT trigger a network request to
 *      /api/animals.
 *   9. Submit the observation → modal closes → row appears in the timeline.
 *
 * IMPORTANT: All tests are tagged test.skip because this spec requires:
 *   - A running dev server on localhost:3001 (pnpm dev --port 3001)
 *   - The delta-livestock tenant DB seeded with at least one camp + 100+
 *     active animals so the picker has rows beyond the first 50.
 *   - Playwright installed: pnpm add -D @playwright/test
 *
 * Pattern matches Phase L's e2e/einstein.spec.ts (skipped tests + the same
 * stub type declarations). Once Playwright is installed, remove the
 * test.skip() calls and restore the real `import { test, expect }` line.
 */

// When Playwright is installed, restore this import:
// import { test, expect, type Page } from "@playwright/test";
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
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeVisible(): void;
  toContain(s: string): void;
  toEqual(v: unknown): void;
  toHaveURL(pattern: string | RegExp): void;
  toHaveAttribute(attr: string, value: string): void;
  toBeGreaterThan(n: number): void;
  not: {
    toBeVisible(): void;
    toBeEnabled(): void;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared constants
// ─────────────────────────────────────────────────────────────────────────────

const FARM_SLUG = "delta-livestock";
const BASE = "http://localhost:3001";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "luc@trio-b.farm";
const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? "change-me-in-env";

// ─────────────────────────────────────────────────────────────────────────────
// Spec (all steps skipped until Playwright runner installed)
// ─────────────────────────────────────────────────────────────────────────────

// test.describe.configure({ mode: "serial" });

// ── Step 1: Login ─────────────────────────────────────────────────────────────
test.skip("Step 1 — login as delta-livestock admin", async () => {
  // const { page } = await browser.newPage();
  // await page.goto(`${BASE}/login`);
  // await page.fill('[name="email"]', ADMIN_EMAIL);
  // await page.fill('[name="password"]', ADMIN_PASS);
  // await page.click('[type="submit"]');
  // await page.waitForURL(`${BASE}/${FARM_SLUG}/admin`);
  // expect(page.url()).toContain(`/${FARM_SLUG}/admin`);
  // await page.context().storageState({ path: "e2e/.auth/trio-b-admin.json" });
  void ADMIN_EMAIL;
  void ADMIN_PASS;
});

// ── Step 2: Navigate to observations page ─────────────────────────────────────
test.skip("Step 2 — navigate to observations page", async () => {
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/observations`);
  // await page.waitForURL(`${BASE}/${FARM_SLUG}/admin/observations`);
  // expect(page.url()).toContain("/admin/observations");
  //
  // Verify the timeline header is visible
  // const heading = page.locator("h1", { hasText: "Observations" });
  // await heading.waitFor({ state: "visible", timeout: 8_000 });
  void BASE;
  void FARM_SLUG;
});

// ── Step 3: Open the create-observation modal ────────────────────────────────
test.skip("Step 3 — clicking + New Entry opens the modal", async () => {
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/observations`);
  // await page.click('button:has-text("+ New Entry")');
  //
  // const modal = page.locator('h3:has-text("New Observation")');
  // await modal.waitFor({ state: "visible", timeout: 4_000 });
  // expect(await modal.isVisible()).toBeTruthy();
});

// ── Step 4: Pick an animal-linked observation type ───────────────────────────
test.skip("Step 4 — selecting weighing reveals camp + animal picker", async () => {
  // After the modal is open in step 3:
  // await page.click('button:has-text("Weighing")');
  //
  // The form step should now be visible with Camp + Animal fields.
  // const campLabel = page.locator('label:has-text("Camp")');
  // await campLabel.waitFor({ state: "visible" });
  //
  // const animalSection = page.locator('div:has-text("Animal (optional)")');
  // await animalSection.waitFor({ state: "visible" });
});

// ── Step 5: Pick a camp ───────────────────────────────────────────────────────
test.skip("Step 5 — picking a camp populates the quick-pick", async () => {
  // const campSelect = page.locator('select[aria-label="Camp"], select').first();
  // await campSelect.selectOption({ index: 1 });
  //
  // The quick-pick (prefetched animals filtered by camp) should now be visible
  // when at least one prefetched animal lives in the chosen camp:
  // const quickPick = page.locator('select[aria-label="Quick-pick animal"]');
  // expect(await quickPick.isVisible()).toBeTruthy();
});

// ── Step 6: AnimalPicker — empty query MUST NOT fire a network request ───────
test.skip("Step 6 — empty query does not call /api/animals", async () => {
  // // Capture network calls to /api/animals after the modal is open.
  // const calls: string[] = [];
  // page.on("request", (req) => {
  //   const url = req.url();
  //   if (url.includes("/api/animals")) calls.push(url);
  // });
  //
  // // Open the modal + select type + camp (steps 3-5).
  // await page.click('button:has-text("+ New Entry")');
  // await page.click('button:has-text("Weighing")');
  // await page.locator('select').first().selectOption({ index: 1 });
  //
  // // Wait for the debounce window to pass without typing.
  // await page.waitForTimeout(600);
  //
  // // Filter to GET /api/animals (POST is for the observation submit at the end).
  // const getCalls = calls.filter((u) => u.includes("/api/animals"));
  // // The page itself does NOT call /api/animals on mount (SSR prefetch via
  // // prisma direct), so the picker must not introduce a spurious GET either.
  // expect(getCalls).toEqual([]);
});

// ── Step 7: AnimalPicker — typing fires a debounced GET ───────────────────────
test.skip("Step 7 — typing triggers a debounced /api/animals?search= request", async () => {
  // const calls: string[] = [];
  // page.on("request", (req) => {
  //   const url = req.url();
  //   if (url.includes("/api/animals") && req.method() === "GET") calls.push(url);
  // });
  //
  // // Open + select.
  // await page.click('button:has-text("+ New Entry")');
  // await page.click('button:has-text("Weighing")');
  // await page.locator('select').first().selectOption({ index: 1 });
  //
  // const search = page.locator('input[aria-label="Search animals"]');
  // await search.fill("C00");
  //
  // // The fetch is debounced 250 ms; wait up to 500 ms before asserting.
  // await page.waitForRequest(
  //   (req) =>
  //     req.url().includes("/api/animals?") &&
  //     req.url().includes("search=C00") &&
  //     req.method() === "GET",
  //   { timeout: 1_000 },
  // );
  //
  // // Result rows should render (assuming trio-b has at least one C00* animal).
  // const firstResult = page.locator('button[type="button"][aria-label]:has-text("C00")').first();
  // await firstResult.waitFor({ state: "visible", timeout: 4_000 });
});

// ── Step 8: Click a result → animalId binds to the form ──────────────────────
test.skip("Step 8 — clicking a result binds the animalId", async () => {
  // // Continue from step 7's typed query.
  // const firstResult = page.locator('button[type="button"]:has(span.font-mono)').first();
  // const tagText = await firstResult.locator('span.font-mono').textContent();
  // await firstResult.click();
  //
  // // The "Selected: <id>" caption appears underneath the picker.
  // const selectedCaption = page.locator('span:has-text("Selected:")');
  // await selectedCaption.waitFor({ state: "visible" });
  // expect(await selectedCaption.textContent()).toContain(tagText ?? "");
});

// ── Step 9: Submit observation and verify it appears in the timeline ─────────
test.skip("Step 9 — submitting closes the modal and the row appears", async () => {
  // // Fill the type-specific required fields (e.g. weight_kg for "weighing").
  // await page.locator('input[type="number"]').first().fill("450");
  //
  // // Click Create.
  // await page.click('button:has-text("Create")');
  //
  // // Modal closes — header no longer in the DOM.
  // const modal = page.locator('h3:has-text("New Weighing")');
  // await modal.waitFor({ state: "detached", timeout: 4_000 });
  //
  // // Timeline refreshes and shows the new row (latest entry at top).
  // const newRow = page.locator('text=/450/').first();
  // await newRow.waitFor({ state: "visible", timeout: 4_000 });
});
