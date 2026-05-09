import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Phase H.2 mechanical coverage — every admin-write API route must call
 * `verifyFreshAdminRole` before its destructive work.
 *
 * Why this is needed
 * ------------------
 * Phase H removed the 60 s meta-db refresh from the NextAuth jwt callback
 * (lib/auth-options.ts). As a result `session.user.farms[*].role` is only
 * refreshed at initial sign-in or on explicit `useSession().update()`.
 *
 * Most API routes call `getPrismaForSlugWithAuth(session, slug)` or
 * `getPrismaWithAuth(session)` — both of which trust the JWT cache. A demoted
 * ADMIN therefore keeps their old role on every destructive route that only
 * does `if (role !== "ADMIN")` until their session expires.
 *
 * session.maxAge=8h caps worst-case staleness at one business day; this test
 * adds defence-in-depth by forcing every admin-write handler to call the
 * meta-db-hitting `verifyFreshAdminRole(userId, slug)` helper on the write
 * path, closing the gap for the operations where stale-ADMIN would be worst.
 *
 * How the test works (string-matching, no AST parse needed)
 * ---------------------------------------------------------
 *  - Walk `app/api/**\/route.ts`.
 *  - For every `export (async) function (GET|POST|PATCH|PUT|DELETE)` we find,
 *    check if its body mentions `getPrismaForSlugWithAuth` /
 *    `getPrismaWithAuth` (the string contains check covers routes where the
 *    auth helper is called from a local `authorize()` helper too — we slice
 *    the handler's source range).
 *  - Hand-curated allowlists below enumerate every (a) read-only and (b)
 *    non-admin-write handler. Anything NOT on the allowlist is category (c)
 *    and MUST textually contain `verifyFreshAdminRole` inside the same
 *    handler body.
 *  - The test ALSO fails if an allowlisted handler has disappeared —
 *    preventing the allowlist from rotting past the codebase.
 */

const REPO_ROOT = join(__dirname, '..', '..');
const API_ROOT = join(REPO_ROOT, 'app', 'api');

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const METHODS: ReadonlyArray<Method> = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

/**
 * Category (a) — read-only handlers. GET-only routes typically land here, but
 * any method that only reads (no mutation of DB state) counts. Each entry is
 * "<relative-route-path>::<METHOD>".
 */
const READ_ONLY: ReadonlySet<string> = new Set([
  '[farmSlug]/budgets/route.ts::GET',
  '[farmSlug]/tax/it3/preview/route.ts::GET',
  '[farmSlug]/tax/it3/route.ts::GET',
  '[farmSlug]/transactions/route.ts::GET',
  '[farmSlug]/nvd/route.ts::GET',
  '[farmSlug]/rainfall/route.ts::GET',
  '[farmSlug]/rotation/plans/route.ts::GET',
  '[farmSlug]/rotation/plans/[planId]/route.ts::GET',
  '[farmSlug]/settings/alerts/route.ts::GET',
  '[farmSlug]/map/infrastructure/route.ts::GET',
  '[farmSlug]/map/rainfall-gauges/route.ts::GET',
  '[farmSlug]/map/task-pins/route.ts::GET',
  '[farmSlug]/map/water-points/route.ts::GET',
  'animals/[id]/route.ts::GET',
  'camps/status/route.ts::GET',
  'farm-settings/map/route.ts::GET',
  'farm-settings/tasks/route.ts::GET',
  'mobs/route.ts::GET',
  'observations/route.ts::GET',
  'task-occurrences/route.ts::GET',
  'transaction-categories/route.ts::GET',
  'transactions/route.ts::GET',
  // Phase G (P6.5): routes migrated to getFarmContext / getFarmContextForSlug.
  // These were outside the H.2 test's original scope (it matched only legacy
  // helpers); after the Phase G scope widening they are discovered and need
  // explicit classification.
  'animals/route.ts::GET',
  'camps/route.ts::GET',
  'farm/route.ts::GET',
  'notifications/route.ts::GET',
  'tasks/route.ts::GET',
  // Phase G (P6.5): cookie-scoped read-only handlers migrated via
  // getFarmContextForSlug (slug-in-query-string pattern) or getFarmContext.
  'farm/settings/route.ts::GET',
  'farm/species-settings/route.ts::GET',
  'onboarding/template/route.ts::GET',
  // Phase G (P6.5): [farmSlug]/** read-only handlers migrated to
  // getFarmContextForSlug — the H.2 test's widened scope (see collectHandlers)
  // now discovers them. All are pure reads: no DB writes, no tenant config.
  '[farmSlug]/camps/[campId]/cover/route.ts::GET',
  '[farmSlug]/camps/[campId]/stats/route.ts::GET',
  '[farmSlug]/export/route.ts::GET',
  '[farmSlug]/feed-on-offer/route.ts::GET',
  '[farmSlug]/financial-analytics/route.ts::GET',
  '[farmSlug]/nvd/[id]/pdf/route.ts::GET',
  '[farmSlug]/nvd/[id]/route.ts::GET',
  '[farmSlug]/performance/route.ts::GET',
  '[farmSlug]/profitability-by-animal/route.ts::GET',
  '[farmSlug]/rotation/route.ts::GET',
  '[farmSlug]/tax/it3/[id]/pdf/route.ts::GET',
  '[farmSlug]/tax/it3/[id]/route.ts::GET',
  '[farmSlug]/veld-assessments/route.ts::GET',
  '[farmSlug]/veld-score/summary/route.ts::GET',
]);

/**
 * Category (b) — writes, but any farm user (LOGGER / VIEWER / ADMIN) may
 * perform them. These routes intentionally have no `role !== "ADMIN"` gate
 * (or admit LOGGER in addition to ADMIN). Adding a fresh-admin check here
 * would be a behaviour change, not a security fix.
 */
const NON_ADMIN_WRITE: ReadonlySet<string> = new Set([
  // Animals: LOGGER may update status/deceasedAt/currentCamp through PATCH.
  // (animals/route.ts POST does not appear on the allowlist because it uses
  // getFarmContext() — not getPrismaWithAuth — and therefore falls outside
  // this test's mechanical scope. The test scope is deliberately bounded to
  // routes that call getPrisma(ForSlug)?WithAuth as specified in Phase H.2.)
  'animals/[id]/route.ts::PATCH',

  // Camp cover readings: any farm user may attach a photo URL after logging.
  '[farmSlug]/camps/[campId]/cover/[readingId]/attachment/route.ts::PATCH',

  // Einstein: ask + feedback are per-user actions, not tenant config.
  'einstein/ask/route.ts::POST',
  'einstein/feedback/route.ts::POST',

  // Observations: core field-log activity open to all roles.
  'observations/route.ts::POST',
  'observations/[id]/attachment/route.ts::PATCH',

  // Push subscriptions: per-user device registration, not tenant config.
  'push/subscribe/route.ts::POST',
  'push/subscribe/route.ts::DELETE',

  // Farm-settings AI + methodology PUT: today these routes intentionally lack
  // a `role !== "ADMIN"` gate — they rely on tier-based gating (paid only).
  // They are effectively settings writes but don't meet category (c)'s
  // "business logic rejects non-admin" criterion. Flag as non-admin write.
  // If tightening these to ADMIN is desired, that's a separate change — add
  // the role guard first, then move the entry to the admin-write list so the
  // coverage check forces verifyFreshAdminRole.
  '[farmSlug]/farm-settings/ai/route.ts::PUT',
  '[farmSlug]/farm-settings/methodology/route.ts::PUT',

  // Phase G (P6.5): pre-migrated (Phase D) + newly-migrated handlers that
  // allow any farm user (LOGGER / VIEWER / ADMIN) to write.
  //
  // animals/route.ts::POST — LOGGER may create calf records (calving flow).
  // notifications/*::POST/PATCH — per-user mark-read, not tenant config.
  'animals/route.ts::POST',
  'notifications/[id]/route.ts::PATCH',
  'notifications/read-all/route.ts::POST',

  // Phase G (P6.5): non-admin writes under [farmSlug]/** — any farm user may
  // invoke these. They mutate state but are NOT tenant-admin config.
  //
  // breeding/analyze — triggers an OpenAI call; tier-gated (paid only) but
  // open to any authenticated farm user who meets the tier threshold.
  // nvd/validate — dry-run withdrawal check, no DB mutation (semantically
  // read-only, but POST by convention because it takes a body).
  // veld-assessments::POST — ADMIN-or-MANAGER write. Manager is not ADMIN
  // so the fresh-admin check doesn't apply here; a future tightening could
  // add a `verifyFreshManagerRole` helper.
  '[farmSlug]/breeding/analyze/route.ts::POST',
  '[farmSlug]/nvd/validate/route.ts::POST',
  '[farmSlug]/veld-assessments/route.ts::POST',

  // photos/upload — any farm user may upload photos for observations; not
  // tenant config. Migrated to getFarmContext in Phase D/G.
  'photos/upload/route.ts::POST',

  // Wave H1 (#173) — proxy-matcher exclusions wrapped in `publicHandler`.
  // publicHandler is the no-auth adapter; these routes intentionally have no
  // admin gate (pure beacons + tenant-select shortcircuit). They were already
  // outside this test's mechanical scope before H1 (no `getPrismaWithAuth`)
  // but the adapter import (`@/lib/server/route`) widens coverage, so they
  // must be explicitly classified.
  'csp-report/route.ts::POST',
  'farms/[slug]/select/route.ts::GET',
  'health/route.ts::GET',
  'telemetry/client-errors/route.ts::POST',
  'telemetry/vitals/route.ts::POST',

  // Wave H2 (#174) — auth-flow entry points wrapped in `publicHandler`.
  // publicHandler is the no-auth adapter; these routes are pre-session entry
  // points (login pre-check, registration, email verification, resend) that
  // intentionally have no admin gate. Each route enforces its own validation
  // + rate limits inside `handle`.
  'auth/login-check/route.ts::POST',
  'auth/register/route.ts::POST',
  'auth/resend-verification/route.ts::POST',
  'auth/verify-email/route.ts::GET',

  // Wave H4 (#177) — framework-managed routes wrapped in `publicHandler`.
  // publicHandler is the no-auth adapter. NextAuth's catch-all manages its
  // own session/auth state internally (cookies, OAuth, JWT). Inngest's serve
  // handler verifies its own X-Inngest-Signature; cron fallback hits POST
  // without a session. Neither has an admin gate by design.
  'auth/[...nextauth]/route.ts::GET',
  'auth/[...nextauth]/route.ts::POST',
  'inngest/route.ts::GET',
  'inngest/route.ts::POST',
  'inngest/route.ts::PUT',

  // Wave H5 (#176) — PayFast ITN webhook wrapped in `publicHandler`.
  // publicHandler is the no-auth adapter; PayFast posts ITNs server-to-server
  // without a session. The handler enforces its own 7-step pipeline (IP
  // allowlist + signature + ITN-validate + token + order + dedup + status
  // ladder) inside `handle` — admin-role gating does not apply.
  'webhooks/payfast/route.ts::POST',
]);

/** Find every route.ts under app/api recursively. */
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

/**
 * Extract the source range of each exported handler. Returns an array of
 * `{ method, body }` where `body` is the substring between the function
 * opening and the matching closing brace, OR — for ADR-0001 adapter
 * exports (`export const GET = tenantRead({...})`) — the entire call
 * expression so the adapter-pattern recognisers below can see the
 * adapter callee.
 *
 * We deliberately do NOT parse with TypeScript — a regex find of the
 * declaration + manual brace-balance is enough for a lint-level check
 * and stays dep-free.
 */
function handlerBodies(source: string): Map<Method, string> {
  const out = new Map<Method, string>();
  for (const method of METHODS) {
    // Pattern 1: legacy `export async function GET(...)` form — body is the
    // function body braces.
    const declRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, 'g');
    const match = declRe.exec(source);
    if (!match) {
      // Pattern 2: ADR-0001 `export const GET = tenantRead({...})` form —
      // capture from the `=` through the balanced parens of the adapter call.
      const constRe = new RegExp(
        `export\\s+const\\s+${method}\\s*(?::[^=]+)?=\\s*`,
        'g',
      );
      const cmatch = constRe.exec(source);
      if (!cmatch) continue;
      // Find the first `(` after the match — that's the adapter call open.
      const exprStart = cmatch.index + cmatch[0].length;
      const parenIdx = source.indexOf('(', exprStart);
      if (parenIdx === -1) continue;
      let p = 1;
      let j = parenIdx + 1;
      for (; j < source.length && p > 0; j++) {
        const c = source[j];
        if (c === '(') p++;
        else if (c === ')') p--;
      }
      out.set(method, source.slice(cmatch.index, j));
      continue;
    }
    // Skip past the argument list — the handler signature can include
    // destructured params (`{ params }`) whose braces would otherwise fool a
    // naïve left-to-right brace balancer. Walk from the opening `(` of the
    // arg list, matching parens, and start the body scan from the FIRST `{`
    // after the closing `)`.
    let i = match.index + match[0].length; // one past the opening `(`
    let paren = 1;
    for (; i < source.length && paren > 0; i++) {
      const c = source[i];
      if (c === '(') paren++;
      else if (c === ')') paren--;
    }
    // `i` now points just after the closing `)`. Handler signatures may have
    // a return-type annotation (`: Promise<Response>`) before the body — skip
    // whitespace + annotation chars until we hit the body `{`.
    const braceIdx = source.indexOf('{', i);
    if (braceIdx === -1) continue;
    // Ensure there's no second `(` before `{` — that would indicate we stopped
    // inside a nested arg list (not happening in this codebase, but cheap).
    const start = braceIdx;
    let depth = 0;
    for (let j = braceIdx; j < source.length; j++) {
      const c = source[j];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          out.set(method, source.slice(start, j + 1));
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Detect whether a handler reaches `verifyFreshAdminRole`. We accept either
 * a direct call inside the handler body or a reference to a local helper
 * (same file) that itself calls it — string-match the whole file as a
 * secondary signal when the handler body delegates to a local `authorize(...)`
 * helper with `requireAdmin = true`.
 *
 * For this codebase, a direct call from the handler body is the pattern
 * everywhere it's already wired — so we require the string `verifyFreshAdminRole`
 * to appear inside the handler body (or its delegated admin-authorize helper).
 * If false positives surface in the future, tighten this to handler-body only.
 */
function callsVerifyFreshAdmin(body: string, fileSource: string): boolean {
  if (body.includes('verifyFreshAdminRole')) return true;
  // ADR-0001: `adminWrite(...)` from `@/lib/server/route` enforces the
  // fresh-admin gate inside the adapter. A handler exported as
  // `export const POST = adminWrite({...})` is structurally guaranteed
  // to call `verifyFreshAdminRole` even though that string never appears
  // in the route file.
  if (/\badminWrite\s*[<(]/.test(body)) return true;
  // Delegated admin-authorize helpers (e.g. budgets + rainfall) call
  // verifyFreshAdminRole inside a module-scope `authorize(..., true)` helper.
  // If the handler invokes `authorize(` with `true` as any argument and the
  // file imports + calls verifyFreshAdminRole, treat as covered.
  const handlerUsesAuthorizeAdmin = /authorize\([^)]*\btrue\b/.test(body);
  if (handlerUsesAuthorizeAdmin && fileSource.includes('verifyFreshAdminRole')) {
    return true;
  }
  return false;
}

interface HandlerRecord {
  readonly key: string;
  readonly relPath: string;
  readonly method: Method;
  readonly usesAuthHelper: boolean;
  readonly hasFreshAdmin: boolean;
  readonly body: string;
}

function collectHandlers(): HandlerRecord[] {
  const files = walk(API_ROOT).sort();
  const records: HandlerRecord[] = [];
  for (const absPath of files) {
    const relPath = relative(API_ROOT, absPath);
    const src = readFileSync(absPath, 'utf8');
    // Use parenthesised form so comments referencing the symbol don't trigger
    // the check — we only care about actual call sites.
    //
    // Phase G (P6.5): the coverage rule now also matches the Phase D/G
    // consolidated helpers (`getFarmContext(` / `getFarmContextForSlug(`).
    // Migrated admin-write handlers still need `verifyFreshAdminRole` — the
    // helper name changed but the H.2 invariant did not.
    // ADR-0001: migrated routes import the adapter contract from
    // `@/lib/server/route` — that import counts as "uses helper" because
    // every adapter wraps `getFarmContext` + role gates internally.
    const uses =
      src.includes('getPrismaForSlugWithAuth(') ||
      src.includes('getPrismaWithAuth(') ||
      src.includes('getFarmContext(') ||
      src.includes('getFarmContextForSlug(') ||
      src.includes('@/lib/server/route');
    if (!uses) continue;
    const bodies = handlerBodies(src);
    for (const [method, body] of bodies) {
      records.push({
        key: `${relPath}::${method}`,
        relPath,
        method,
        usesAuthHelper:
          body.includes('getPrismaForSlugWithAuth(') ||
          body.includes('getPrismaWithAuth(') ||
          body.includes('getFarmContext(') ||
          body.includes('getFarmContextForSlug(') ||
          // authorize() helper pattern — body calls authorize() which internally
          // calls one of the helpers. Count as uses-helper so the coverage rule
          // applies.
          /authorize\s*\(/.test(body) ||
          // ADR-0001 adapter exports: the body slice covers the adapter call
          // expression, e.g. `tenantRead({...})`. Each adapter wraps
          // getFarmContext internally, so this counts as uses-helper.
          /\b(?:tenantRead|adminWrite|tenantWrite|publicHandler)\s*[<(]/.test(body),
        hasFreshAdmin: callsVerifyFreshAdmin(body, src),
        body,
      });
    }
  }
  return records;
}

describe('admin-write API routes must call verifyFreshAdminRole', () => {
  const handlers = collectHandlers();

  it('discovered at least the routes we expect (sanity floor)', () => {
    // If this count drops below the known minimum, the walker is mis-skipping
    // files — fail loudly.
    expect(handlers.length).toBeGreaterThan(40);
  });

  it('every category-(c) admin-write handler calls verifyFreshAdminRole', () => {
    const unwired: string[] = [];
    for (const h of handlers) {
      if (!h.usesAuthHelper) continue;
      if (READ_ONLY.has(h.key)) continue;
      if (NON_ADMIN_WRITE.has(h.key)) continue;
      if (!h.hasFreshAdmin) unwired.push(h.key);
    }
    expect(unwired, `Routes missing verifyFreshAdminRole:\n${unwired.join('\n')}`).toEqual([]);
  });

  it('every allowlisted handler still exists (allowlist cannot rot)', () => {
    const discovered = new Set(handlers.map((h) => h.key));
    const missing: string[] = [];
    for (const key of [...READ_ONLY, ...NON_ADMIN_WRITE]) {
      if (!discovered.has(key)) missing.push(key);
    }
    expect(
      missing,
      `Allowlisted handlers no longer exist — prune the list:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('no handler is on both allowlists (sanity)', () => {
    const overlap: string[] = [];
    for (const k of READ_ONLY) if (NON_ADMIN_WRITE.has(k)) overlap.push(k);
    expect(overlap).toEqual([]);
  });
});
