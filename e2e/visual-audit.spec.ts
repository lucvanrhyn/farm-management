/**
 * e2e/visual-audit.spec.ts — Authenticated multi-viewport visual-audit harness.
 *
 * Issue #529 / PRD #521 Workstream H — code half of gate #20.
 *
 * Walks every admin surface (sourced from `lib/ops/critical-routes.ts` +
 * additional settings / tools routes not yet in that list) at BOTH desktop
 * (1440×900) and mobile (390×844) viewports. For each surface × viewport:
 *   - Emits a PNG screenshot artifact (`test-results/visual-audit/…`).
 *   - Asserts zero `console.error` events (excluding known advisory CSP noise).
 *   - Asserts the HTTP response is NOT 4xx or 5xx (2xx / 3xx are accepted).
 *   - Asserts the page does not render a React error boundary or crash UI.
 *
 * SELF-SKIP CONTRACT — the entire suite skips cleanly (exit 0, zero failures)
 * when any of the following are absent:
 *   - E2E_IDENTIFIER / E2E_PASSWORD environment variables.
 *   - The storage-state file written by `e2e/global-setup.ts`
 *     (`e2e/.auth/visual-audit.json`).
 *
 * This ensures the spec never blocks CI on branches that lack live-preview
 * credentials (developer forks, pre-seed PRs, etc.). It becomes active once
 * the #527 test-admin seed (#108) has been run against a live preview and the
 * operator sets the three env vars.
 *
 * Required env (self-skips when absent):
 *   E2E_BASE_URL    — https://my-preview.vercel.app  (default: http://localhost:3000)
 *   E2E_IDENTIFIER  — test-admin email / username  (seed: #527 / #108)
 *   E2E_PASSWORD    — test-admin password
 *   E2E_TENANT_SLUG — farm slug for the seeded admin tenant (default: acme-cattle)
 *
 * Artifacts: `test-results/visual-audit/<surface>/<viewport>.png`
 * (Playwright's `outputDir` is `test-results` by default.)
 */

import * as fs from 'fs';
import * as path from 'path';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { VISUAL_AUDIT_STORAGE_STATE_PATH } from './global-setup';

// ── Runtime config ────────────────────────────────────────────────────────────

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'acme-cattle';

/** True when a valid storage-state file exists (globalSetup succeeded). */
function hasStorageState(): boolean {
  return fs.existsSync(VISUAL_AUDIT_STORAGE_STATE_PATH);
}

// ── Viewport matrix ───────────────────────────────────────────────────────────

const VIEWPORTS = [
  { label: 'desktop', viewport: { width: 1440, height: 900 } },
  { label: 'mobile', viewport: { width: 390, height: 844 } },
] as const;

// ── Admin surfaces ────────────────────────────────────────────────────────────

/**
 * Full list of admin surfaces to walk. Paths are relative to `/<TENANT_SLUG>`.
 * We enumerate every admin nav entry plus the critical-routes list to give the
 * widest screenshot coverage with a single run.
 *
 * `needsCampId` rows are resolved at runtime (first camp fetched from
 * /api/camps before the loop) to avoid hard-coding an ID that changes per
 * clone.
 */
interface AuditSurface {
  label: string;
  /** Path relative to base URL — must begin with `/`. */
  path: string;
  /** If true, `[campId]` in path will be substituted with the first camp's id. */
  needsCampId?: boolean;
}

const AUDIT_SURFACES: AuditSurface[] = [
  // ── Farm home ──
  { label: 'farm-home', path: `/${TENANT_SLUG}` },
  // ── Dashboard ──
  { label: 'dashboard', path: `/${TENANT_SLUG}/dashboard` },
  // ── Admin core ──
  { label: 'admin-overview', path: `/${TENANT_SLUG}/admin` },
  { label: 'admin-animals', path: `/${TENANT_SLUG}/admin/animals` },
  { label: 'admin-mobs', path: `/${TENANT_SLUG}/admin/mobs` },
  { label: 'admin-camps', path: `/${TENANT_SLUG}/admin/camps` },
  { label: 'admin-camp-detail', path: `/${TENANT_SLUG}/admin/camps/[campId]`, needsCampId: true },
  { label: 'admin-tasks', path: `/${TENANT_SLUG}/admin/tasks` },
  { label: 'admin-observations', path: `/${TENANT_SLUG}/admin/observations` },
  { label: 'admin-finansies', path: `/${TENANT_SLUG}/admin/finansies` },
  // ── Admin analytics ──
  { label: 'admin-reproduction', path: `/${TENANT_SLUG}/admin/reproduction` },
  { label: 'admin-performance', path: `/${TENANT_SLUG}/admin/performance` },
  // ── Admin settings ──
  { label: 'settings-methodology', path: `/${TENANT_SLUG}/admin/settings/methodology` },
  { label: 'settings-ai', path: `/${TENANT_SLUG}/admin/settings/ai` },
  { label: 'settings-species', path: `/${TENANT_SLUG}/admin/settings/species` },
  { label: 'settings-subscription', path: `/${TENANT_SLUG}/admin/settings/subscription` },
  // ── Einstein ──
  { label: 'einstein', path: `/${TENANT_SLUG}/admin/einstein` },
  // ── Tools ──
  { label: 'tools-rotation-planner', path: `/${TENANT_SLUG}/tools/rotation-planner` },
  { label: 'tools-veld', path: `/${TENANT_SLUG}/tools/veld` },
  { label: 'tools-feed-on-offer', path: `/${TENANT_SLUG}/tools/feed-on-offer` },
  // ── Logger (farmer-facing) ──
  { label: 'logger', path: `/${TENANT_SLUG}/logger` },
  // ── Map ──
  { label: 'map', path: `/${TENANT_SLUG}/map` },
];

// ── Console-noise allow-list ──────────────────────────────────────────────────

/**
 * Browser-emitted advisories that are not app errors. Matches against the
 * full console-error text. Same pattern as admin-journey.spec.ts.
 */
const CONSOLE_NOISE_RE =
  /upgrade-insecure-requests.*report-only|Failed to load resource.*favicon|content-security-policy/i;

function isConsoleNoise(text: string): boolean {
  return CONSOLE_NOISE_RE.test(text);
}

// ── Error-boundary detection ──────────────────────────────────────────────────

function hasErrorBoundary(html: string): boolean {
  return (
    html.includes('Something went wrong') ||
    html.includes('data-error-boundary') ||
    html.includes('data-testid="error-boundary"') ||
    html.includes('Application error') ||
    html.includes('a server-side exception has occurred')
  );
}

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Add the persisted storage-state cookies to the browser context.
 * This avoids a live network login per test — globalSetup logged in once.
 */
async function applyStorageState(context: BrowserContext): Promise<void> {
  const raw = fs.readFileSync(VISUAL_AUDIT_STORAGE_STATE_PATH, 'utf-8');
  const state = JSON.parse(raw) as {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Lax' | 'Strict' | 'None';
    }>;
  };
  await context.addCookies(state.cookies);
}

// ── First-camp resolution ─────────────────────────────────────────────────────

async function resolveFirstCampId(page: Page): Promise<string | null> {
  try {
    const res = await page.request.get(`${BASE_URL}/api/camps`);
    if (!res.ok()) return null;
    const data = (await res.json()) as Array<{ camp_id: string }>;
    return Array.isArray(data) && data.length > 0 ? data[0].camp_id : null;
  } catch {
    return null;
  }
}

// ── Screenshot artifact helper ────────────────────────────────────────────────

/**
 * Emit a screenshot to `test-results/visual-audit/<label>/<viewport>.png`.
 * Uses `page.screenshot` with `fullPage: false` (viewport-only) to keep
 * artifacts a manageable size; the Playwright test runner additionally
 * captures a full-page trace when `--trace` is enabled.
 */
async function captureScreenshot(
  page: Page,
  label: string,
  viewportLabel: string,
): Promise<void> {
  const dir = path.join('test-results', 'visual-audit', label);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${viewportLabel}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('Issue #529 — authenticated multi-viewport visual audit', () => {
  test.skip(
    !IDENTIFIER || !PASSWORD,
    'E2E_IDENTIFIER / E2E_PASSWORD not set — skipping visual-audit harness',
  );

  test.describe.configure({ mode: 'serial' });

  for (const { label: viewportLabel, viewport } of VIEWPORTS) {
    test.describe(`Viewport: ${viewportLabel} (${viewport.width}×${viewport.height})`, () => {
      test.use({ viewport });

      /**
       * Single consolidated test per viewport: walks all surfaces, collects
       * failures, and reports them together. Serial execution within a viewport
       * means screenshots are taken in nav order (easier to review).
       *
       * We use a single test (not one test per surface) so that the suite
       * reports as two tests (desktop + mobile) and does not explode CI
       * reporting into 40+ rows. Each failure includes the surface label.
       */
      test(`all admin surfaces render cleanly at ${viewportLabel}`, async ({
        context,
        page,
      }) => {
        // Additional skip guard: if globalSetup wrote no file (e.g. server
        // unreachable at setup time) skip gracefully at test time too.
        test.skip(
          !hasStorageState(),
          'visual-audit storage state not found — globalSetup skipped (server unreachable or creds wrong)',
        );

        await applyStorageState(context);

        // Resolve the first camp id for needsCampId routes.
        const firstCampId = await resolveFirstCampId(page);

        const failures: Array<{ surface: string; reason: string }> = [];

        for (const surface of AUDIT_SURFACES) {
          // Resolve path (substitute camp id if needed).
          let resolvedPath = surface.path;
          if (surface.needsCampId) {
            if (!firstCampId) {
              // Cannot resolve; skip this surface (not a failure).
              console.log(
                `[visual-audit] No campId available — skipping surface "${surface.label}"`,
              );
              continue;
            }
            resolvedPath = resolvedPath.replace('[campId]', encodeURIComponent(firstCampId));
          }

          const url = `${BASE_URL}${resolvedPath}`;

          // Collect console errors for this navigation only.
          const consoleErrors: string[] = [];
          const onConsole = (msg: import('@playwright/test').ConsoleMessage) => {
            if (msg.type() !== 'error') return;
            const text = msg.text();
            if (!isConsoleNoise(text)) consoleErrors.push(text);
          };
          page.on('console', onConsole);

          let response: import('@playwright/test').Response | null = null;
          try {
            response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          } catch (navErr) {
            failures.push({ surface: surface.label, reason: `Navigation error: ${String(navErr)}` });
            page.off('console', onConsole);
            continue;
          }

          // Capture screenshot regardless of outcome (useful for debugging).
          try {
            await captureScreenshot(page, surface.label, viewportLabel);
          } catch {
            // Non-fatal — screenshot failure shouldn't fail the audit.
          }

          const status = response?.status() ?? 0;
          const html = (await page.content()).slice(0, 60_000);

          // Assertions — collect rather than throw so we see all failures.
          if (status >= 400) {
            failures.push({ surface: surface.label, reason: `HTTP ${status}` });
          } else if (hasErrorBoundary(html)) {
            failures.push({ surface: surface.label, reason: 'React error boundary rendered' });
          } else if (consoleErrors.length > 0) {
            failures.push({
              surface: surface.label,
              reason: `console.error × ${consoleErrors.length}: ${consoleErrors[0]}`,
            });
          }

          page.off('console', onConsole);
        }

        // Report all failures together for actionable CI output.
        expect(
          failures,
          `Visual-audit failures at ${viewportLabel}:\n${failures
            .map((f) => `  ${f.surface} — ${f.reason}`)
            .join('\n')}`,
        ).toEqual([]);
      });
    });
  }
});
