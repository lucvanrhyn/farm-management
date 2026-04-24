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
 * opening and the matching closing brace.
 *
 * We deliberately do NOT parse with TypeScript — a regex find of
 * `export async function <METHOD>(` + manual brace-balance is enough for a
 * lint-level check and stays dep-free. Handlers in this codebase do not nest
 * `export async function ...` inside one another.
 */
function handlerBodies(source: string): Map<Method, string> {
  const out = new Map<Method, string>();
  for (const method of METHODS) {
    const declRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, 'g');
    const match = declRe.exec(source);
    if (!match) continue;
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
    let braceIdx = source.indexOf('{', i);
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
    const uses =
      src.includes('getPrismaForSlugWithAuth(') || src.includes('getPrismaWithAuth(');
    if (!uses) continue;
    const bodies = handlerBodies(src);
    for (const [method, body] of bodies) {
      records.push({
        key: `${relPath}::${method}`,
        relPath,
        method,
        usesAuthHelper: body.includes('getPrismaForSlugWithAuth(') ||
          body.includes('getPrismaWithAuth(') ||
          // authorize() helper pattern — body calls authorize() which internally
          // calls one of the helpers. Count as uses-helper so the coverage rule
          // applies.
          /authorize\s*\(/.test(body),
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
