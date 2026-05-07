#!/usr/bin/env tsx
/**
 * Post-promote authenticated smoke driver.
 *
 * Established by PRD #128 (2026-05-06). After `pnpm ops:promote-branch` runs
 * (and the meta-DB is marked promoted), this script:
 *   1. Programmatically signs into the live deploy as a synthetic user.
 *   2. Iterates the CRITICAL_ROUTES list and GETs each one.
 *   3. Asserts every route returned 200 and did NOT render the global error
 *      boundary or the React 19 generic crash UI.
 *   4. On any failure, exits non-zero. The post-merge-promote workflow then
 *      invokes `rollback-promote` to clear the meta-DB `promoted_at` row.
 *
 * Usage:
 *   pnpm tsx scripts/post-promote-smoke.ts \
 *     --base https://farm-management-lilac.vercel.app \
 *     --tenant delta-livestock \
 *     --identifier "$BENCH_USER" \
 *     --password "$BENCH_PASSWORD"
 *
 * Exit codes:
 *   0 — all routes OK
 *   1 — at least one route returned an error / boundary / crash
 *   2 — auth failure or config error (smoke could not run)
 */
import { resolveCriticalRoutes } from '../lib/ops/critical-routes';
import { runProdSmoke, formatSmokeReport } from '../lib/ops/prod-smoke';

interface CliFlags {
  baseUrl: string;
  tenant: string;
  identifier: string;
  password: string;
  campId?: string;
  jsonReport?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags = {
    baseUrl: '',
    tenant: '',
    identifier: '',
    password: '',
  } as CliFlags;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => args[++i];
    if (arg === '--base') flags.baseUrl = next();
    else if (arg === '--tenant') flags.tenant = next();
    else if (arg === '--identifier') flags.identifier = next();
    else if (arg === '--password') flags.password = next();
    else if (arg === '--camp-id') flags.campId = next();
    else if (arg === '--json-report') flags.jsonReport = next();
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: post-promote-smoke --base <url> --tenant <slug> --identifier <email> --password <pw> [--camp-id <id>] [--json-report <path>]',
      );
      process.exit(0);
    }
  }
  for (const k of ['baseUrl', 'tenant', 'identifier', 'password'] as const) {
    if (!flags[k]) {
      console.error(`post-promote-smoke: missing --${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`);
      process.exit(2);
    }
  }
  return flags;
}

/**
 * Sign in via next-auth credentials provider and return the cookie header.
 * Mirrors the network calls the login page makes — POST to
 * `/api/auth/csrf`, then POST to `/api/auth/callback/credentials`.
 */
async function signIn(
  baseUrl: string,
  identifier: string,
  password: string,
): Promise<string> {
  // 1. Get CSRF token (also sets the csrf cookie).
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (!csrfRes.ok) {
    throw new Error(`CSRF fetch failed: HTTP ${csrfRes.status}`);
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = csrfRes.headers.get('set-cookie') ?? '';

  // 2. POST credentials. next-auth sets the session cookie on a 200.
  const form = new URLSearchParams();
  form.set('csrfToken', csrfToken);
  form.set('identifier', identifier);
  form.set('password', password);
  form.set('callbackUrl', `${baseUrl}/`);
  form.set('json', 'true');

  const loginRes = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      cookie: csrfCookie,
    },
    body: form.toString(),
    redirect: 'manual',
  });

  if (loginRes.status !== 200 && loginRes.status !== 302) {
    throw new Error(`credentials sign-in failed: HTTP ${loginRes.status}`);
  }

  const setCookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookies.find((c) =>
    /next-auth\.session-token|__Secure-next-auth\.session-token/.test(c),
  );
  if (!sessionCookie) {
    throw new Error(
      `credentials sign-in returned no session cookie — likely wrong identifier/password or unverified email`,
    );
  }
  // Also keep the csrf cookie since some routes verify it.
  const cookies = [sessionCookie.split(';')[0], csrfCookie.split(';')[0]].filter(Boolean);
  return cookies.join('; ');
}

async function main(argv: readonly string[]): Promise<number> {
  const flags = parseArgs(argv);

  let cookie: string;
  try {
    cookie = await signIn(flags.baseUrl, flags.identifier, flags.password);
  } catch (err) {
    console.error(
      `post-promote-smoke: sign-in failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }

  const routes = resolveCriticalRoutes({
    farmSlug: flags.tenant,
    firstCampId: flags.campId,
    // If no campId provided, the camp-detail route is filtered out implicitly
    // by the resolver throwing — keep the smoke runnable without one by
    // dropping needsCampId routes when no campId was supplied.
    includeAdminOnly: true,
  }).filter(() => true);

  // If no campId was passed, drop the camp-detail route from the sweep so the
  // resolver doesn't throw. The PR-time admin-journey spec runs with a real
  // campId; this script favours robustness for cron-style runs.
  let resolvedRoutes = routes;
  if (!flags.campId) {
    try {
      resolvedRoutes = resolveCriticalRoutes({
        farmSlug: flags.tenant,
        includeAdminOnly: true,
        // Pass a dummy campId; we'll drop the route below.
        firstCampId: 'placeholder',
      }).filter((r) => !r.url.includes('/camps/placeholder'));
    } catch (err) {
      console.error(
        `post-promote-smoke: resolve failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return 2;
    }
  }

  const report = await runProdSmoke({
    baseUrl: flags.baseUrl,
    routes: resolvedRoutes,
    cookie,
    timeoutMs: 20_000,
  });

  console.log(formatSmokeReport(report));

  if (flags.jsonReport) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(flags.jsonReport, JSON.stringify(report, null, 2));
  }

  return report.ok ? 0 : 1;
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    console.error('post-promote-smoke: fatal:', err);
    process.exit(2);
  },
);
