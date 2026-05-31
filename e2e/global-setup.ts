/**
 * e2e/global-setup.ts — Visual-audit authenticated global setup.
 *
 * Issue #529 / PRD #521 Workstream H — code half of gate #20.
 *
 * Runs before the visual-audit project. If E2E_IDENTIFIER, E2E_PASSWORD, and
 * a reachable E2E_BASE_URL are present it logs in via the repo-standard
 * credentials flow (same path as `e2e/fixtures/auth.ts#loginViaApi`) and
 * persists an authenticated Playwright storage-state JSON to
 * `e2e/.auth/visual-audit.json` so the visual-audit spec can consume it via
 * `storageState`.
 *
 * If any prerequisite is absent or login fails the file is NOT written, and
 * the visual-audit spec detects the missing file and self-skips cleanly (exit
 * 0, zero failures). This path is the normal behaviour on developer laptops
 * and forks without CI secrets.
 *
 * Env vars reused (same names as the rest of the authenticated suite):
 *   E2E_BASE_URL    — e.g. https://my-preview.vercel.app  (default: http://localhost:3000)
 *   E2E_IDENTIFIER  — test-admin email / username
 *   E2E_PASSWORD    — test-admin password
 *
 * Storage-state path: VISUAL_AUDIT_STORAGE_STATE_PATH (exported constant —
 * imported by visual-audit.spec.ts so there is a single source of truth).
 */

import * as fs from 'fs';
import * as path from 'path';
import { request } from '@playwright/test';

/** Canonical path consumed by both this setup and `visual-audit.spec.ts`. */
export const VISUAL_AUDIT_STORAGE_STATE_PATH = path.join(
  __dirname,
  '.auth',
  'visual-audit.json',
);

/** Minimum wait (ms) after the redirect to let the session cookie be set. */
const SETTLE_MS = 500;

function parseSetCookie(
  setCookie: string,
  baseUrl: string,
): {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
} | null {
  const [head, ...attrs] = setCookie.split(';').map((s) => s.trim());
  if (!head.includes('=')) return null;
  const eq = head.indexOf('=');
  const name = head.slice(0, eq);
  const value = head.slice(eq + 1);
  const url = new URL(baseUrl);
  let cookiePath = '/';
  let httpOnly = false;
  let secure = false;
  for (const attr of attrs) {
    const [k, v] = attr.split('=');
    if (k.toLowerCase() === 'path') cookiePath = v ?? '/';
    if (k.toLowerCase() === 'httponly') httpOnly = true;
    if (k.toLowerCase() === 'secure') secure = true;
  }
  return { name, value, domain: url.hostname, path: cookiePath, httpOnly, secure };
}

async function globalSetup(): Promise<void> {
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const identifier = process.env.E2E_IDENTIFIER ?? '';
  const password = process.env.E2E_PASSWORD ?? '';

  // ── Guard: skip silently when creds are absent ────────────────────────────
  if (!identifier || !password) {
    console.log(
      '[visual-audit global-setup] E2E_IDENTIFIER / E2E_PASSWORD not set — skipping auth setup.',
    );
    return;
  }

  // ── Guard: check base URL is reachable before attempting login ────────────
  let reachable = false;
  const probeCtx = await request.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
  });
  try {
    const probe = await probeCtx.get('/', { timeout: 10_000 });
    reachable = probe.status() < 500;
  } catch {
    // Network error — server not up or URL wrong.
    reachable = false;
  } finally {
    await probeCtx.dispose();
  }

  if (!reachable) {
    console.log(
      `[visual-audit global-setup] ${baseUrl} is not reachable — skipping auth setup.`,
    );
    return;
  }

  // ── Login via next-auth credentials provider (mirrors fixtures/auth.ts) ───
  const apiCtx = await request.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
  });

  try {
    const csrfRes = await apiCtx.get('/api/auth/csrf');
    if (!csrfRes.ok()) {
      console.log(
        `[visual-audit global-setup] CSRF fetch failed (HTTP ${csrfRes.status()}) — skipping.`,
      );
      return;
    }
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    const loginRes = await apiCtx.post('/api/auth/callback/credentials', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      form: {
        csrfToken,
        identifier,
        password,
        callbackUrl: `${baseUrl}/`,
        json: 'true',
      },
      maxRedirects: 0,
    });

    const loginStatus = loginRes.status();
    if (loginStatus !== 200 && loginStatus !== 302) {
      console.log(
        `[visual-audit global-setup] Sign-in returned HTTP ${loginStatus} — skipping.`,
      );
      return;
    }

    // Collect session cookie(s).
    const headers = loginRes.headersArray();
    const setCookies = headers
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);

    const sessionCookie = setCookies.find((c) =>
      /next-auth\.session-token|__Secure-next-auth\.session-token/.test(c),
    );
    if (!sessionCookie) {
      console.log(
        '[visual-audit global-setup] No session cookie returned — credentials may be wrong. Skipping.',
      );
      return;
    }

    // Build a storageState-compatible JSON.
    const parsedCookies = setCookies
      .map((sc) => parseSetCookie(sc, baseUrl))
      .filter(Boolean) as NonNullable<ReturnType<typeof parseSetCookie>>[];

    const storageState = {
      cookies: parsedCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: -1,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: 'Lax' as const,
      })),
      origins: [] as unknown[],
    };

    // Give the session a brief moment to propagate.
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    // Write the storage-state file.
    const dir = path.dirname(VISUAL_AUDIT_STORAGE_STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      VISUAL_AUDIT_STORAGE_STATE_PATH,
      JSON.stringify(storageState, null, 2),
      'utf-8',
    );

    console.log(
      `[visual-audit global-setup] Storage state written to ${VISUAL_AUDIT_STORAGE_STATE_PATH}`,
    );
  } catch (err) {
    // Non-fatal: log and let tests self-skip.
    console.log(
      `[visual-audit global-setup] Unexpected error during login — skipping. ${String(err)}`,
    );
  } finally {
    await apiCtx.dispose();
  }
}

export default globalSetup;
