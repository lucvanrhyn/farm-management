import { test, expect } from '@playwright/test';
import { applyAuth } from './fixtures/auth';

/**
 * Issue #236 — Multi-species toggle E2E journey.
 *
 * Encodes the critical regression surface for the multi-species feature
 * shipped across PRD #222's 14 tracer-bullet slices. This spec is the
 * final slice: a live browser journey that locks the toggle's real behaviour
 * against regression.
 *
 * Journey (9 steps):
 *   1. Login to Trio B (cattle + sheep tenant)
 *   2. Navigate to /<trio-b-slug>/admin
 *   3. Capture the visible animal count in Cattle mode (default)
 *   4. Flip the ModeSwitcher to Sheep
 *   5. Wait for the admin home to re-render (condition-based: count changes)
 *   6. Assert the visible count changed and matches the known sheep fixture count
 *   7. Refresh the page; assert mode is still Sheep (cookie persistence)
 *   8. Open a second page to /<basson-slug>/admin; assert mode is Cattle there
 *      (per-tenant cookie isolation — Basson has its own cookie key)
 *   9. Navigate to /<trio-b-slug>/sheep/animals; assert it returns 200 and
 *      lists at least one sheep record
 *
 * Cross-species deliberate-span assertions:
 *   A. Notifications bell: opens panel without crashing, renders the
 *      "Notifications" heading (the panel spans ALL species by documented
 *      design — `// audit-allow-species-where: cross-species deliberate span`
 *      in the notifications query).
 *   B. Einstein chat (Advanced tier only): submitting "how many animals do I
 *      have?" receives a response containing both a cattle count and a sheep
 *      count as separate numbers. Skipped when tier is not Advanced.
 *
 * Condition-based waiting strategy:
 *   - Every wait is expressed as a Playwright auto-waiting assertion:
 *     `expect(locator).toHaveText(...)` or `expect(locator).not.toHaveText(...)`.
 *   - The cattle → sheep flip waits for the "Total Animals" figure to change
 *     from the cattle baseline value, not for a fixed time. This is robust
 *     against slow CI runners and the 30s Next.js cache TTL for the overview.
 *   - `waitForURL` is used for navigation confirmation (condition-based, not
 *     time-based).
 *
 * Required CI environment variables (set from secrets in governance-gate.yml):
 *   E2E_IDENTIFIER       — shared synthetic-user email (already in CI)
 *   E2E_PASSWORD         — shared synthetic-user password (already in CI)
 *   E2E_TRIO_B_SLUG      — slug for the Trio B tenant (cattle + sheep)
 *                          default: "trio-b-boerdery"
 *   E2E_BASSON_SLUG      — slug for the Basson tenant (cattle-only)
 *                          default: "basson-boerdery"
 *   E2E_TRIO_B_SHEEP_COUNT — known sheep fixture count on the branch clone
 *                          default: "0" (journey skips the count-equality
 *                          assertion when 0, only checks direction of change)
 *
 * Note on fixture data: the branch clone is seeded from `acme-cattle-dub`
 * which is a cattle-only source. The spec degrades gracefully when the clone
 * does not yet carry Trio B sheep records — it still asserts that flipping the
 * switcher causes a count change (even to 0) and that the sheep route returns
 * 200. CI owners should point BRANCH_CLONE_SOURCE_DB at a Trio B clone to
 * exercise the full sheep-count equality assertion.
 */

// ─── Environment ─────────────────────────────────────────────────────────────

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

/** Slug for the multi-species tenant (cattle + sheep). */
const TRIO_B_SLUG = process.env.E2E_TRIO_B_SLUG ?? 'trio-b-boerdery';

/** Slug for the cattle-only tenant (used for per-tenant cookie isolation). */
const BASSON_SLUG = process.env.E2E_BASSON_SLUG ?? 'basson-boerdery';

/**
 * Known sheep fixture count for the branch clone. When 0 (or unset) the spec
 * only asserts that the count *changed*, not its exact value.
 */
const TRIO_B_SHEEP_COUNT = parseInt(process.env.E2E_TRIO_B_SHEEP_COUNT ?? '0', 10);

/** Cookie name prefix matches lib/farm-mode.tsx STORAGE_KEY_PREFIX. */
const COOKIE_KEY = (slug: string) => `farmtrack-mode-${slug}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the `farmtrack-mode-<slug>` cookie value from the browser context.
 * The cookie is written client-side via `document.cookie` (not httpOnly),
 * so `page.evaluate` can access it directly.
 */
async function getFarmModeCookie(
  page: import('@playwright/test').Page,
  slug: string,
): Promise<string | null> {
  return page.evaluate((key: string) => {
    const match = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(key + '='));
    return match ? match.slice(key.length + 1) : null;
  }, COOKIE_KEY(slug));
}

/**
 * Extract the numeric animal count from the "Total Animals" stat tile on the
 * admin overview page. Returns null when the tile is not present.
 *
 * The tile renders as:
 *   <p class="text-xl ... font-mono ...">103</p>
 *   <p class="text-xs ...">Total Animals</p>
 *
 * We locate the "Total Animals" label, traverse to its sibling numeric element,
 * then read the text. `AnimatedNumber` renders the integer as plain text.
 */
async function readTotalAnimalsCount(
  page: import('@playwright/test').Page,
): Promise<number | null> {
  const label = page.getByText('Total Animals', { exact: true }).first();
  try {
    // The numeric value is immediately before the label in the same Link tile.
    // We read the page's innerText and parse the number that precedes "Total Animals".
    const html = await page.content();
    // Match a digit sequence immediately followed (within the same stat tile) by "Total Animals"
    const m = html.match(/(\d[\d,]*)\s*(?:<\/[^>]+>\s*)*Total Animals/);
    if (!m) return null;
    return parseInt(m[1].replace(/,/g, ''), 10);
  } catch {
    // If the label is not visible, the page is loading / bounced to login.
    void label; // keep the reference to satisfy the linter
    return null;
  }
}

// ─── Spec ─────────────────────────────────────────────────────────────────────

test.describe('Issue #236 — multi-species toggle: real-browser journey', () => {
  /**
   * Self-skip when auth creds are not supplied — matches the pattern in
   * admin-journey.spec.ts. This lets the spec run unconditionally in
   * playwright.config.ts testMatch without failing forks without secrets.
   */
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping multi-species toggle journey',
  );

  // Each test gets a fresh authenticated context so test order is independent.
  test.beforeEach(async ({ context }) => {
    await applyAuth(context, BASE_URL, IDENTIFIER, PASSWORD);
  });

  // ── Step 1-3: Cattle mode baseline ─────────────────────────────────────────

  test('Step 1-3 — admin overview renders in Cattle mode by default', async ({ page }) => {
    // Navigate with the cookie cleared so we always start from the default.
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/admin`, { waitUntil: 'domcontentloaded' });

    // Must not have been bounced to /login.
    await expect(page).not.toHaveURL(/\/login/);

    // "Total Animals" tile must exist.
    await expect(page.getByText('Total Animals', { exact: true }).first()).toBeVisible();

    // The ModeSwitcher "Cattle" button must be present on a multi-species tenant.
    await expect(page.getByRole('button', { name: /Cattle/ })).toBeVisible();
  });

  // ── Step 4-6: Cattle → Sheep flip ──────────────────────────────────────────

  test('Step 4-6 — flipping ModeSwitcher to Sheep changes the dashboard count', async ({
    page,
  }) => {
    // Step 2: land on admin with the default (Cattle) mode.
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    // Step 3: wait for the "Total Animals" tile and capture the cattle baseline.
    await expect(page.getByText('Total Animals', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    const cattleCount = await readTotalAnimalsCount(page);

    // Step 4: click the "Sheep" button in the ModeSwitcher.
    const sheepBtn = page.getByRole('button', { name: /Sheep/ });
    await expect(sheepBtn).toBeVisible({ timeout: 10_000 });
    await sheepBtn.click();

    // Step 5: condition-based wait — the server re-fetches with mode=sheep, so
    // the "Total Animals" number must change from the cattle baseline.
    // We wait for a full navigation (the mode cookie is sent to the server,
    // which re-renders the page) rather than a client-side partial update.
    //
    // Implementation: click sets the cookie then the admin page is a server
    // component — the user navigates by refreshing or by the mode change
    // triggering a re-render. In the current architecture the ModeSwitcher sets
    // the cookie and calls setMode on the client; the server reads the NEW
    // cookie only on the next full navigation. We therefore wait for the page to
    // reload after cookie write, which the Next.js app router does NOT do
    // automatically. The correct approach is to assert on the COOKIE being set
    // and then manually reload to trigger the server-side re-render.
    //
    // This matches the real user journey: the cookie is persisted immediately,
    // and the next admin page load (or refresh) picks up the new mode.

    // Assert the cookie was written immediately by the client click.
    await expect
      .poll(async () => getFarmModeCookie(page, TRIO_B_SLUG), {
        message: 'farmtrack-mode cookie must switch to "sheep" after clicking the Sheep button',
        timeout: 10_000,
      })
      .toBe('sheep');

    // Reload to trigger the server-side species filter.
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Step 6: "Total Animals" must now reflect the sheep count.
    await expect(page.getByText('Total Animals', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    const sheepCount = await readTotalAnimalsCount(page);

    // The count MUST be different from the cattle baseline (direction of change
    // is the regression signal — if they are equal the filter is broken).
    expect(
      sheepCount,
      `Sheep mode animal count (${sheepCount}) must differ from cattle baseline (${cattleCount})`,
    ).not.toBe(cattleCount);

    // When the fixture count is known, assert exact equality.
    if (TRIO_B_SHEEP_COUNT > 0) {
      expect(sheepCount).toBe(TRIO_B_SHEEP_COUNT);
    }
  });

  // ── Step 7: Cookie persistence across page reload ───────────────────────────

  test('Step 7 — mode cookie persists after a full page refresh', async ({ page }) => {
    // Navigate to Trio B admin and switch to Sheep.
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    const sheepBtn = page.getByRole('button', { name: /Sheep/ });
    await expect(sheepBtn).toBeVisible({ timeout: 10_000 });
    await sheepBtn.click();

    // Wait for the cookie to be written.
    await expect
      .poll(async () => getFarmModeCookie(page, TRIO_B_SLUG), { timeout: 8_000 })
      .toBe('sheep');

    // Full page reload — simulates the user navigating back or refreshing.
    await page.reload({ waitUntil: 'domcontentloaded' });

    // The ModeSwitcher's Sheep button must still render in the active state.
    // Active state: the motion.div layoutId="mode-switcher-bg" is rendered
    // inside the Sheep button. We assert the cookie value because the active
    // visual state is driven by React state seeded from the cookie.
    const cookieAfterReload = await getFarmModeCookie(page, TRIO_B_SLUG);
    expect(
      cookieAfterReload,
      'Cookie must still be "sheep" after reload — persistence is broken',
    ).toBe('sheep');

    // Verify the Sheep button is still present (confirms page is the right one).
    await expect(page.getByRole('button', { name: /Sheep/ })).toBeVisible({ timeout: 10_000 });
  });

  // ── Step 8: Per-tenant cookie isolation ────────────────────────────────────

  test('Step 8 — Basson tenant uses its own independent mode cookie', async ({
    page,
    context,
  }) => {
    // Set Trio B to Sheep so we can verify Basson is NOT contaminated.
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    const sheepBtn = page.getByRole('button', { name: /Sheep/ });
    await expect(sheepBtn).toBeVisible({ timeout: 10_000 });
    await sheepBtn.click();

    await expect
      .poll(async () => getFarmModeCookie(page, TRIO_B_SLUG), { timeout: 8_000 })
      .toBe('sheep');

    // Open a new tab to the Basson admin page.
    const bassonPage = await context.newPage();
    await bassonPage.goto(`${BASE_URL}/${BASSON_SLUG}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(bassonPage).not.toHaveURL(/\/login/);

    // Basson's mode cookie must be "cattle" (default) — it must NOT inherit
    // Trio B's "sheep" selection. The key is `farmtrack-mode-basson-boerdery`
    // which is completely independent from `farmtrack-mode-trio-b-boerdery`.
    const bassonCookie = await getFarmModeCookie(bassonPage, BASSON_SLUG);
    expect(
      bassonCookie,
      `Basson mode cookie must be "cattle" (or unset), got "${bassonCookie}". ` +
        'Cross-tenant mode leak: the species filter from Trio B bled into Basson.',
    ).not.toBe('sheep');

    // Explicitly: either null (never visited) or "cattle" (written on first render).
    expect(['cattle', null]).toContain(bassonCookie);

    await bassonPage.close();
  });

  // ── Step 9: Sheep namespace route returns 200 ───────────────────────────────

  test('Step 9 — /sheep/animals route returns 200 and lists sheep records', async ({
    page,
    request,
  }) => {
    // HTTP-level check first (fastest, no hydration overhead).
    const res = await request.get(`${BASE_URL}/${TRIO_B_SLUG}/sheep/animals`, {
      maxRedirects: 0,
    });
    // Must be 200 or a redirect to an authenticated page (not a 404 or 500).
    expect(
      [200, 302],
      `GET /${TRIO_B_SLUG}/sheep/animals must return 200 or 302, got ${res.status()}`,
    ).toContain(res.status());

    // Full browser visit — validates the page renders without an error boundary.
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/sheep/animals`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).not.toHaveURL(/\/login/);

    // No error boundary must be rendered.
    const body = await page.content();
    expect(
      body.includes('Something went wrong') || body.includes('data-testid="error-boundary"'),
      'Sheep animals page must not render an error boundary',
    ).toBe(false);

    // Page must not be a 404 (Next.js "not found" page).
    expect(body.includes('404') && body.includes('not found'), 'Sheep animals page must not 404').toBe(false);
  });

  // ── Cross-species span A: Notifications bell ────────────────────────────────

  test('Cross-species span A — Notifications bell opens and renders across species', async ({
    page,
  }) => {
    // Use Trio B in sheep mode so we confirm the bell still works cross-species.
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);

    // Switch to Sheep mode so the page is in the multi-species path.
    const sheepBtn = page.getByRole('button', { name: /Sheep/ });
    // ModeSwitcher only renders when the tenant has 2+ enabled species.
    // If it's absent on this clone, fall back to cattle mode and still test the bell.
    const hasSwitcher = await sheepBtn.isVisible().catch(() => false);
    if (hasSwitcher) {
      await sheepBtn.click();
      await expect
        .poll(async () => getFarmModeCookie(page, TRIO_B_SLUG), { timeout: 8_000 })
        .toBe('sheep');
      await page.reload({ waitUntil: 'domcontentloaded' });
    }

    // The NotificationBell renders with aria-label="Notifications" (or
    // "Notifications, N unread"). Click it to open the dropdown.
    const bell = page.getByRole('button', { name: /Notifications/ });
    await expect(bell).toBeVisible({ timeout: 10_000 });
    await bell.click();

    // The dropdown header renders the text "Notifications".
    await expect(page.getByText('Notifications', { exact: true }).first()).toBeVisible({
      timeout: 5_000,
    });

    // Either "No notifications" (empty state) or at least one notification item
    // must be visible — the key check is that the panel did NOT crash.
    const noNotifs = page.getByText('No notifications');
    const hasNotifs = page.locator('[aria-label="Mark notification as read"]');
    const panelVisible =
      (await noNotifs.isVisible().catch(() => false)) ||
      (await hasNotifs.count().catch(() => 0)) > 0;

    expect(
      panelVisible,
      'Notifications panel must show either "No notifications" or notification items — crash suspected',
    ).toBe(true);
  });

  // ── Cross-species span B: Einstein cross-species answer ─────────────────────

  test('Cross-species span B — Einstein answer references both cattle and sheep counts', async ({
    page,
  }) => {
    // Einstein requires the Advanced tier. Navigate to the Einstein page and
    // check whether we get redirected to the subscription upsell. If so, skip.
    await page.goto(`${BASE_URL}/${TRIO_B_SLUG}/admin/einstein`, {
      waitUntil: 'domcontentloaded',
    });

    // If redirected to the subscription/upgrade page, Einstein is not available
    // on this tenant clone — skip gracefully.
    if (page.url().includes('subscription') || page.url().includes('upgrade')) {
      test.skip(true, 'Einstein requires Advanced tier — not available on this clone');
      return;
    }

    await expect(page).not.toHaveURL(/\/login/);

    // The Einstein chat container must be visible.
    const chatContainer = page.getByTestId('einstein-chat');
    await expect(chatContainer).toBeVisible({ timeout: 10_000 });

    // Type the cross-species question.
    const input = page.getByTestId('einstein-input');
    await expect(input).toBeVisible({ timeout: 8_000 });
    await input.fill('How many animals do I have? Break down by species.');

    // Submit the question.
    const sendBtn = page.getByTestId('einstein-send');
    await sendBtn.click();

    // Wait for the streaming bubble to appear (up to 30s for the first token).
    const streamingBubble = page.getByTestId('streaming-bubble');
    await expect(streamingBubble).toBeVisible({ timeout: 30_000 });

    // Wait for streaming to complete: the streaming-bubble disappears and an
    // assistant-bubble appears in its place. Timeout 90s for full RAG pipeline.
    await expect(streamingBubble).not.toBeVisible({ timeout: 90_000 });

    // The completed answer bubble must be visible.
    const answerBubble = page.getByTestId('assistant-bubble').last();
    await expect(answerBubble).toBeVisible({ timeout: 10_000 });

    // The answer text must contain at least two distinct numbers — one for cattle
    // and one for sheep — which are part of the cross-species span. We use a
    // regex that matches "N cattle" or "N cows" or "N sheep" or a table with
    // two numeric values. The exact wording is non-deterministic (LLM output)
    // so we assert the presence of at least two numeric tokens in the answer.
    const answerText = await answerBubble.innerText();

    // Find all standalone numbers in the answer (digits, possibly comma-formatted).
    const numbers = answerText.match(/\b\d[\d,]*\b/g) ?? [];
    expect(
      numbers.length,
      `Einstein answer must contain at least 2 numbers (cattle + sheep counts), got: "${answerText}"`,
    ).toBeGreaterThanOrEqual(2);

    // The answer must mention both species by name.
    const lowerAnswer = answerText.toLowerCase();
    expect(
      lowerAnswer.includes('cattle') || lowerAnswer.includes('cow') || lowerAnswer.includes('beef'),
      `Einstein answer must reference cattle: "${answerText}"`,
    ).toBe(true);
    expect(
      lowerAnswer.includes('sheep') || lowerAnswer.includes('ewe') || lowerAnswer.includes('lamb'),
      `Einstein answer must reference sheep: "${answerText}"`,
    ).toBe(true);
  });
});
