/**
 * tests/e2e/routing.spec.ts — Phase C system-endpoint E2E
 *
 * Tests the three Phase C bug fixes end-to-end:
 *
 *   C1.  GET /api/health returns 200 with Content-Type: application/json
 *        and a body containing `{ status: "ok", timestamp: <ISO8601> }`.
 *   C2.  Unknown paths render a real 404 (status 404 + a "Page not found"
 *        marker from app/not-found.tsx) instead of 307'ing to /login.
 *   C3.  /demo (when present as a route) responds 200 to anonymous visitors.
 *        Phase C did NOT ship a /demo page — the matcher was unblocked so
 *        whatever ships next is reachable. While no /demo file exists this
 *        test is `test.skip` so the build stays green; flip back to test()
 *        the moment a /demo page lands.
 *
 *   Regression guard. Existing protected routes still 307 → /login when the
 *   visitor is unauthenticated (e.g. /farms). This is the safety check that
 *   the bug C2 fall-through has not over-corrected.
 *
 * IMPORTANT: All tests are marked test.skip because this spec requires:
 *   - A running dev server on localhost:3001 (pnpm dev --port 3001)
 *   - Playwright installed (not currently in devDependencies)
 *
 * Once Playwright is added (`pnpm add -D @playwright/test`), remove the
 * test.skip() calls and add the base URL to playwright.config.ts:
 *   use: { baseURL: 'http://localhost:3001' }
 *
 * Pattern matches e2e/einstein.spec.ts and e2e/tasks-geomap.spec.ts (stub
 * type declarations until Playwright lands in devDependencies).
 */

// When Playwright is installed, restore this import:
// import { test, expect } from "@playwright/test";
//
// For now we use a stub type so the file compiles under tsc without Playwright.
// The stub is only present until `@playwright/test` is added to devDependencies.
interface PlaywrightAPIResponse {
  status(): number;
  headers(): Record<string, string>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
interface PlaywrightPage {
  goto(
    url: string,
    options?: { waitUntil?: string },
  ): Promise<PlaywrightAPIResponse | null>;
  getByText(s: string | RegExp): { isVisible(): Promise<boolean> };
  url(): string;
  content(): Promise<string>;
}
interface PlaywrightRequest {
  get(url: string): Promise<PlaywrightAPIResponse>;
}
interface PlaywrightTestFn {
  (
    name: string,
    fn: (ctx: { page: PlaywrightPage; request: PlaywrightRequest }) => Promise<void>,
  ): void;
  skip(
    name: string,
    fn: (ctx: { page: PlaywrightPage; request: PlaywrightRequest }) => Promise<void>,
  ): void;
  describe: {
    (name: string, fn: () => void): void;
    configure(options: { mode: string }): void;
  };
}
declare const test: PlaywrightTestFn;
declare const expect: (value: unknown) => {
  toBe(value: unknown): void;
  toBeTruthy(): void;
  toMatch(pattern: RegExp | string): void;
  toContain(s: string): void;
  toBeVisible(): Promise<void>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared constants
// ─────────────────────────────────────────────────────────────────────────────
const BASE = `http://localhost:3001`;

// ─────────────────────────────────────────────────────────────────────────────
// C1 — /api/health
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Phase C — bug C1 /api/health", () => {
  test.skip("returns 200 with application/json", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const ct = res.headers()["content-type"];
    expect(ct).toMatch(/^application\/json/);
  });

  test.skip("body has status: ok", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(body.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2 — unknown route fall-through
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Phase C — bug C2 unknown-route 404 fall-through", () => {
  test.skip("unknown path returns 404 (not 307 to /login)", async ({ page }) => {
    const res = await page.goto(
      `${BASE}/some-nonexistent-path-12345`,
      { waitUntil: "domcontentloaded" },
    );
    expect(res?.status()).toBe(404);
    // The current URL must still be the typo path, not /login.
    expect(page.url()).toContain("/some-nonexistent-path-12345");
    // app/not-found.tsx renders the heading "Page not found".
    const html = await page.content();
    expect(html).toContain("Page not found");
  });

  test.skip("near-miss for /farms (i.e. /farmz) returns 404", async ({ page }) => {
    const res = await page.goto(`${BASE}/farmz`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(404);
    expect(page.url()).toContain("/farmz");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3 — /demo public access
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase C did NOT ship the /demo page itself — see Deferred items in the
// branch return notes. The middleware has been unblocked so a future /demo
// page is reachable unauthenticated. When that page lands, flip these
// `test.skip` calls to `test` and they will start enforcing the contract.
test.describe("Phase C — bug C3 /demo unwalled", () => {
  test.skip("/demo responds 200 to anonymous visitors", async ({ page }) => {
    const res = await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    // Must not redirect to /login.
    expect(page.url()).toContain("/demo");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression guard — protected routes still redirect
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Phase C — regression: protected routes still 307 → /login", () => {
  test.skip("/farms (unauth) redirects to /login", async ({ page }) => {
    const res = await page.goto(`${BASE}/farms`, { waitUntil: "domcontentloaded" });
    // Final landing URL is /login; first hop was 307.
    expect(page.url()).toContain("/login");
    // Status of the *final* document is whatever the login page is (200).
    expect(res?.status()).toBe(200);
  });

  test.skip("/trio-b-boerdery/admin/animals (unauth) redirects to /login", async ({
    page,
  }) => {
    await page.goto(`${BASE}/trio-b-boerdery/admin/animals`, {
      waitUntil: "domcontentloaded",
    });
    expect(page.url()).toContain("/login");
  });
});
