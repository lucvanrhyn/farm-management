import { request, type APIRequestContext, type BrowserContext } from '@playwright/test';

/**
 * Authenticated Playwright fixture.
 *
 * Established by PRD #128 (2026-05-06). The previous `e2e/smoke.spec.ts`
 * only hit `/login` and `/` unauthenticated, so it could never observe an
 * admin page returning 500. This fixture programmatically signs in via the
 * next-auth credentials provider and returns a cookie header / storage
 * state ready to attach to a fresh BrowserContext.
 *
 * Two auth methods are exposed:
 *  - `loginViaApi(baseUrl, identifier, password)` — pure HTTP, no browser,
 *    useful for the post-promote smoke + the synthetic monitor.
 *  - `applyAuth(context, baseUrl, identifier, password)` — adds the session
 *    cookie to a Playwright BrowserContext so subsequent `page.goto()` calls
 *    are authenticated.
 */

export interface SignInResult {
  cookie: string;
  /** Parsed cookies suitable for Playwright `context.addCookies`. */
  parsed: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
  }>;
}

function parseSetCookie(setCookie: string, baseUrl: string): SignInResult['parsed'][number] | null {
  const [head, ...attrs] = setCookie.split(';').map((s) => s.trim());
  if (!head.includes('=')) return null;
  const eq = head.indexOf('=');
  const name = head.slice(0, eq);
  const value = head.slice(eq + 1);
  const url = new URL(baseUrl);
  let path = '/';
  let httpOnly = false;
  let secure = false;
  for (const attr of attrs) {
    const [k, v] = attr.split('=');
    if (k.toLowerCase() === 'path') path = v ?? '/';
    if (k.toLowerCase() === 'httponly') httpOnly = true;
    if (k.toLowerCase() === 'secure') secure = true;
  }
  return { name, value, domain: url.hostname, path, httpOnly, secure };
}

export async function loginViaApi(
  baseUrl: string,
  identifier: string,
  password: string,
  apiCtx?: APIRequestContext,
): Promise<SignInResult> {
  const ctx = apiCtx ?? (await request.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true }));
  try {
    const csrfRes = await ctx.get('/api/auth/csrf');
    if (!csrfRes.ok()) throw new Error(`CSRF: HTTP ${csrfRes.status()}`);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    const loginRes = await ctx.post('/api/auth/callback/credentials', {
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

    if (loginRes.status() !== 200 && loginRes.status() !== 302) {
      throw new Error(`Sign-in failed: HTTP ${loginRes.status()}`);
    }

    const headers = loginRes.headersArray();
    const setCookies = headers
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);
    const session = setCookies.find((c) =>
      /next-auth\.session-token|__Secure-next-auth\.session-token/.test(c),
    );
    if (!session) {
      throw new Error('credentials sign-in returned no session cookie');
    }

    const parsed: SignInResult['parsed'] = [];
    for (const sc of setCookies) {
      const p = parseSetCookie(sc, baseUrl);
      if (p) parsed.push(p);
    }
    const cookieHeader = parsed.map((c) => `${c.name}=${c.value}`).join('; ');
    return { cookie: cookieHeader, parsed };
  } finally {
    if (!apiCtx) await ctx.dispose();
  }
}

/**
 * Add the credentials-flow cookies to a Playwright BrowserContext so
 * subsequent `page.goto` calls are authenticated.
 */
export async function applyAuth(
  context: BrowserContext,
  baseUrl: string,
  identifier: string,
  password: string,
): Promise<void> {
  const { parsed } = await loginViaApi(baseUrl, identifier, password);
  await context.addCookies(
    parsed.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: 'Lax' as const,
    })),
  );
}
