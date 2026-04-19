/**
 * e2e/tasks-geomap.spec.ts — Phase K Wave 3G Playwright E2E
 *
 * Tests the full Tasks + GeoMap user flow end-to-end:
 *   1. Login as trio-b admin
 *   2. Install template pack (settings page)
 *   3. Pick "Dip day — cattle" template → create task
 *   4. Open map → toggle Task pins layer → verify pin renders
 *   5. Long-press off-camp → create task at coordinates → pin appears
 *   6. Complete the off-camp task with treatment payload → verify obs in feed
 *   7. Toggle AFIS layer → mock GeoJSON → verify polygon renders
 *
 * IMPORTANT: All tests are marked test.skip because this spec requires:
 *   - A running dev server on localhost:3001 (pnpm dev --port 3001)
 *   - The trio-b-boerdery tenant DB seeded with at least one camp
 *   - Playwright installed (not currently in devDependencies)
 *
 * Once Playwright is added (`pnpm add -D @playwright/test`), remove the
 * test.skip() calls and add the base URL to playwright.config.ts:
 *   use: { baseURL: 'http://localhost:3001' }
 *
 * The spec is serial because each step depends on state from the previous one.
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
  toBeVisible(): void;
  toContain(s: string): void;
  toHaveURL(pattern: string | RegExp): void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared constants
// ─────────────────────────────────────────────────────────────────────────────
const FARM_SLUG = "trio-b-boerdery";
const BASE = `http://localhost:3001`;

const ADMIN_EMAIL = "luc@trio-b.farm"; // set from env in real run: process.env.E2E_ADMIN_EMAIL
const ADMIN_PASS = "change-me-in-env"; // set from env in real run: process.env.E2E_ADMIN_PASS

// AFIS fixture GeoJSON — one red fire perimeter polygon near Gauteng
const AFIS_FIXTURE = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [28.0, -26.0],
            [28.1, -26.0],
            [28.1, -25.9],
            [28.0, -25.9],
            [28.0, -26.0],
          ],
        ],
      },
      properties: { confidence: "high", satellite: "AQUA" },
    },
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec
// ─────────────────────────────────────────────────────────────────────────────

// When Playwright is wired up, replace test.skip with test throughout.
// test.describe.configure({ mode: "serial" });

// ── Step 1: Login ─────────────────────────────────────────────────────────────
test.skip("Step 1 — login as trio-b admin", async () => {
  // Requires Playwright. To activate, install @playwright/test and replace test.skip with test.
  // const { page } = await browser.newPage();  // example
  //
  // await page.goto(`${BASE}/login`);
  // await page.fill('[name="email"]', ADMIN_EMAIL);
  // await page.fill('[name="password"]', ADMIN_PASS);
  // await page.click('[type="submit"]');
  // await page.waitForURL(`${BASE}/farms`);
  // expect(page.url()).toContain("/farms");
  //
  // Save storage state so subsequent steps reuse the session:
  // await page.context().storageState({ path: "e2e/.auth/trio-b-admin.json" });
});

// ── Step 2: Install template pack ─────────────────────────────────────────────
test.skip("Step 2 — install template pack from settings page", async () => {
  // Requires: Step 1 auth state + dev server + DB with TaskTemplate table
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/settings/tasks`);
  // const installBtn = page.getByRole("button", { name: /install template pack/i });
  // await installBtn.click();
  //
  // Wait for toast/success feedback
  // await page.waitForSelector("text=20 templates installed", { timeout: 10_000 });
  // expect(await page.locator("text=20 templates installed").isVisible()).toBeTruthy();
});

// ── Step 3: Create "Dip day — cattle" task ────────────────────────────────────
test.skip("Step 3 — create 'Dip day — cattle' task from template", async () => {
  // Requires: Step 2 (templates installed)
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/tasks`);
  // await page.getByRole("button", { name: /new task/i }).click();
  //
  // Open template picker
  // await page.getByRole("combobox", { name: /template/i }).click();
  // await page.getByRole("option", { name: "Dip day — cattle" }).click();
  //
  // Select first camp
  // const campSelect = page.getByRole("combobox", { name: /camp/i });
  // await campSelect.click();
  // await page.getByRole("option").first().click();
  //
  // Submit
  // await page.getByRole("button", { name: /create task/i }).click();
  //
  // Verify task appears in list with correct type
  // await page.waitForSelector("[data-task-type='dipping']", { timeout: 8_000 });
  // expect(await page.locator("[data-task-type='dipping']").count()).toBeGreaterThan(0);
});

// ── Step 4: Map — toggle Task pins layer ──────────────────────────────────────
test.skip("Step 4 — open map and toggle Task pins layer on", async () => {
  // Requires: Step 3 (at least one task with campId set)
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/map`);
  //
  // Find the LayerToggle button for "Task pins"
  // const taskPinsToggle = page.getByRole("button", { name: /task pins/i });
  // await taskPinsToggle.click();
  //
  // Wait for map to render a pin (Mapbox adds a canvas element with markers)
  // The test verifies a pin appears at the camp centroid by checking for the
  // marker element in the DOM. FarmMap uses data-testid="task-pin-{taskId}".
  // await page.waitForSelector('[data-testid^="task-pin-"]', { timeout: 10_000 });
  // expect(await page.locator('[data-testid^="task-pin-"]').count()).toBeGreaterThan(0);
});

// ── Step 5: Long-press off-camp → create task ─────────────────────────────────
test.skip("Step 5 — long-press off-camp to create a task at coordinates", async () => {
  // Fallback: if long-press isn't implemented, use task creation form with lat/lng query params
  // e.g. navigate to /trio-b-boerdery/admin/tasks/new?lat=-25.5&lng=28.1&type=generic
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/tasks/new?lat=-25.5&lng=28.1`);
  // await page.fill('[name="title"]', "Off-camp test task");
  // await page.getByRole("button", { name: /create/i }).click();
  //
  // Navigate back to map and verify a pin appears near (-25.5, 28.1)
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/map`);
  // The task-pin layer toggle should now show the off-camp pin.
  // await page.waitForSelector('[data-testid^="task-pin-"]', { timeout: 8_000 });
  //
  // Note: exact coordinate matching requires Mapbox to expose marker positions
  // via DOM attributes. Assert count increased by at least 1 versus Step 4 baseline.
});

// ── Step 6: Complete task with treatment payload → verify obs feed ─────────────
test.skip("Step 6 — complete off-camp task with treatment payload → observation in feed", async () => {
  // Requires: Step 5 (off-camp task created)
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/tasks`);
  //
  // Find the off-camp task created in Step 5
  // await page.getByText("Off-camp test task").click();
  //
  // Open complete-with-payload dialog
  // await page.getByRole("button", { name: /complete task/i }).click();
  // await page.fill('[name="product"]', "Copper supplement");
  // await page.getByRole("button", { name: /submit/i }).click();
  //
  // Verify task status changed to completed
  // await page.waitForSelector("[data-status='completed']", { timeout: 8_000 });
  //
  // Navigate to observations feed and verify the treatment obs
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/observations`);
  // await page.waitForSelector("text=Copper supplement", { timeout: 8_000 });
  // expect(await page.locator("text=Copper supplement").isVisible()).toBeTruthy();
  //
  // The obs row should have type="treatment"
  // expect(await page.locator("[data-obs-type='treatment']").count()).toBeGreaterThan(0);
});

// ── Step 7: Toggle AFIS layer with mocked GeoJSON ──────────────────────────────
test.skip("Step 7 — toggle AFIS layer with mocked upstream GeoJSON", async () => {
  // Requires: Page context with Playwright route interception
  //
  // Intercept the AFIS proxy endpoint and return fixture data
  // await page.route(`**/api/map/gis/afis**`, (route) => {
  //   route.fulfill({
  //     status: 200,
  //     contentType: "application/json",
  //     body: AFIS_FIXTURE,
  //   });
  // });
  //
  // await page.goto(`${BASE}/${FARM_SLUG}/admin/map`);
  //
  // Click the AFIS layer toggle
  // const afisToggle = page.getByRole("button", { name: /fire perimeters|afis/i });
  // await afisToggle.click();
  //
  // Verify the mock was called (Playwright registers the route intercept hit)
  // The AFIS polygon should appear on the Mapbox canvas. Since we can't pixel-
  // inspect the canvas directly, we verify the layer is "on" via aria state:
  // expect(await afisToggle.getAttribute("aria-pressed")).toBe("true");
  //
  // Additionally verify the route was intercepted (fulfillment happened):
  // const requests = await page.context().waitForEvent("request",
  //   (req) => req.url().includes("/api/map/gis/afis")
  // );
  // expect(requests).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// Playwright setup instructions (for Wave 4)
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
//      use: { baseURL: "http://localhost:3001" },
//      webServer: {
//        command: "pnpm dev --port 3001",
//        port: 3001,
//        reuseExistingServer: !process.env.CI,
//      },
//    });
//
// 3. Add script to package.json:
//    "test:e2e": "playwright test"
//
// 4. Add auth setup fixture:
//    In playwright.config.ts: globalSetup: "./e2e/auth-setup.ts"
//    Create e2e/auth-setup.ts that logs in and saves storage state to
//    e2e/.auth/trio-b-admin.json. Reference in use.storageState.
//
// 5. Set env vars:
//    E2E_ADMIN_EMAIL=luc@trio-b.farm
//    E2E_ADMIN_PASS=<password>
//
// 6. Remove all test.skip() → test() in this file.
//    Remove the stub type declarations at the top.
//    Restore the real import: import { test, expect } from "@playwright/test";
//
// 7. Run: pnpm test:e2e
