/**
 * @vitest-environment node
 *
 * Phase G (P6.5) — regression-prevention coverage test.
 *
 * After Phase D + G, every API route under the proxy.ts matcher should
 * consume auth via `getFarmContext` / `getFarmContextForSlug` rather than
 * the legacy `getServerSession(authOptions)` + `getPrismaWithAuth(session)`
 * pair. The consolidated helpers eliminate a serial meta-db round-trip per
 * cold request (the whole point of Phase D/G).
 *
 * This test walks `app/api/**\/route.ts` and fails if any non-excluded
 * route.ts co-imports `getServerSession` and `authOptions`. The allowlist
 * below enumerates every file that is deliberately EXEMPT:
 *   1. Files outside the proxy.ts matcher (no signed headers possible).
 *   2. The nextauth catch-all route which must import authOptions by
 *      construction.
 *   3. The /api/farms/[slug]/select route which proxy.ts shortcircuits
 *      before the auth hoist.
 *
 * Why a test and not an ESLint rule
 * ---------------------------------
 * A vitest lint-level test is consistent with
 * `__tests__/auth/admin-write-routes-check-role.test.ts` (Phase H.2) and
 * keeps the linting surface flat (no custom ESLint plugin to install).
 * The cost is a string-level AST-free scan — sufficient for import checks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const API_ROOT = join(REPO_ROOT, 'app', 'api');

/**
 * Routes excluded from the session-consolidation rule.
 *
 * Each entry is relative to `app/api`. The comment explains WHY it's
 * exempt — reviewers should push back if an exemption's rationale no
 * longer applies.
 */
const EXEMPT: ReadonlySet<string> = new Set([
  // ── proxy matcher exclusions (proxy.ts config.matcher) ──
  // Observations: high-volume write path kept off the middleware hop.
  'observations/route.ts',
  'observations/reset/route.ts',
  'observations/[id]/route.ts',
  'observations/[id]/attachment/route.ts',
  // Einstein: RAG endpoint — streamed, bypasses middleware.
  'einstein/ask/route.ts',
  'einstein/feedback/route.ts',
  // Inngest webhook: signed by Inngest, not by our proxy.
  'inngest/route.ts',
  // Telemetry: tiny beacon endpoint outside the hoist.
  'telemetry/vitals/route.ts',
  // Webhooks: PayFast (and future) are signed by upstream, not by our proxy.
  'webhooks/payfast/route.ts',

  // ── auth catch-all: must import authOptions ──
  'auth/[...nextauth]/route.ts',
  // auth register / verify / resend — under /api/auth/** which the proxy
  // intentionally skips (matcher excludes api/auth).
  'auth/register/route.ts',
  'auth/verify-email/route.ts',
  'auth/resend-verification/route.ts',

  // ── /api/farms/:slug/select — proxy shortcircuits this path ──
  // (see proxy.ts line 17 — it returns NextResponse.next() without
  //  running getToken or stamping headers).
  'farms/[slug]/select/route.ts',

  // ── /api/subscription/status — cross-farm endpoint ──
  // This route accepts ?farm=<slug> and looks up subscription state in
  // the meta DB. The consolidated helpers scope to a single active farm
  // (fast-path session carries only that slug in user.farms); this
  // handler legitimately needs the full session.user.farms list. Left
  // on the legacy path — still goes through the proxy so auth is still
  // fast-path'd at the middleware hop, only the handler-body lookup
  // uses getServerSession.
  'subscription/status/route.ts',

  // ── /api/admin/consulting/[id] — platform-admin endpoint ──
  // Operates on meta-DB consulting-lead rows (not any farm DB). Has no
  // useful farm context; retains getServerSession for the email lookup.
  'admin/consulting/[id]/route.ts',

  // ── /api/admin/evict-farm-client — dev evict endpoint ──
  // Accepts a slug and evicts that farm's Prisma client cache. Needs the
  // full session.user.farms list to verify ADMIN on an arbitrary slug;
  // getFarmContext's fast path scopes to the active farm only.
  'admin/evict-farm-client/route.ts',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (entry === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

function usesLegacyAuthPair(source: string): boolean {
  // We match on actual import form — `from "next-auth"` for the function
  // and `from "@/lib/auth-options"` for authOptions. String contains is
  // sufficient because the repo never re-exports these.
  //
  // A file counts as "legacy" only when BOTH imports are present (a route
  // can import authOptions for an isolated `update()` trigger without
  // using the legacy auth pair on its read path).
  const importsGetServerSession = /from\s+["']next-auth["']/.test(source) &&
    /getServerSession/.test(source);
  const importsAuthOptions = /from\s+["']@\/lib\/auth-options["']/.test(source);
  return importsGetServerSession && importsAuthOptions;
}

describe('session-consolidation coverage', () => {
  const files = walk(API_ROOT).sort();

  it('discovered at least the routes we expect (sanity floor)', () => {
    // If this count drops, the walker is mis-skipping files — fail loudly.
    expect(files.length).toBeGreaterThan(60);
  });

  it('every non-exempt API route uses the consolidated helpers', () => {
    const violations: string[] = [];
    for (const abs of files) {
      const rel = relative(API_ROOT, abs);
      if (EXEMPT.has(rel)) continue;
      const src = readFileSync(abs, 'utf8');
      if (usesLegacyAuthPair(src)) violations.push(rel);
    }
    expect(
      violations,
      [
        'Routes still importing getServerSession + authOptions:',
        ...violations,
        '',
        'Migrate these to `getFarmContext(req)` (cookie-scoped) or',
        '`getFarmContextForSlug(farmSlug, req)` ([farmSlug]/** routes)',
        'per lib/server/farm-context{,-slug}.ts.',
        '',
        'If the route is intentionally outside the proxy matcher, add it',
        'to the EXEMPT set in this test with a comment explaining why.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('every exempt file still exists (allowlist cannot rot)', () => {
    const discovered = new Set(files.map((f) => relative(API_ROOT, f)));
    const missing: string[] = [];
    for (const rel of EXEMPT) {
      if (!discovered.has(rel)) missing.push(rel);
    }
    expect(
      missing,
      `Exempt routes no longer exist — prune the list:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
