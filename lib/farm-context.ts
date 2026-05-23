/**
 * Issue #393 (PRD #389, Module 3 / W2 — server + middleware slice).
 *
 * The URL `[farmSlug]` is the single tenant source of truth on the server.
 * `requireFarmContext` is the pure decision function called from `proxy.ts`
 * (and reachable from tests without the Edge runtime) that says what to do
 * with the `active_farm_slug` cookie for a given request.
 *
 * Why this exists
 * ---------------
 * Before this slice, two sources of truth competed:
 *   1. The URL segment `[farmSlug]` (the page the user is actually looking at).
 *   2. The `active_farm_slug` cookie (the most recently visited tenant).
 *
 * When the cookie and the URL disagreed — most commonly when a user switched
 * farms via the farm picker and the cookie was still pointing at the old
 * tenant — server-side fetchers reading the cookie would load the WRONG
 * farm's data on first paint, until the next request happened to refresh
 * the cookie. That bug was the symptom the user reported (#393).
 *
 * The fix is to make the URL authoritative on the server and demote the
 * cookie to a diagnostic / convenience hint: written when the URL has a
 * slug, cleared when it disagrees with the URL, and otherwise ignored.
 *
 * Contract
 * --------
 * - Pure function: no I/O, no globals, deterministic for any
 *   `(urlSlug, cookieSlug)` pair.
 * - Total: every combination of (string | null, string | null) returns a
 *   tagged decision. Empty strings on the cookie input are coerced to
 *   "absent" (some cookie libraries surface "" instead of null for a
 *   deleted-but-still-present-in-header value).
 * - Variants:
 *     - `ok` — URL and cookie agree. No response cookie write.
 *     - `clear-stale-cookie` — URL and cookie disagree. The URL is
 *       authoritative; the response must delete the cookie so client-side
 *       fetches that don't include `[farmSlug]` in the path can't pick up
 *       the stale tenant on first paint. The carried `slug` is the URL
 *       slug (the new authoritative).
 *     - `set-cookie` — URL has a slug, cookie is absent. Write the URL slug
 *       as the new cookie value so non-page-route fetches can still
 *       resolve the tenant.
 *     - `no-action` — URL has no farm slug (request is to a non-tenant
 *       route like `/farms`, `/login`, `/api/auth/*`). Leave the cookie
 *       alone — we deliberately do NOT clear it here because the cookie
 *       helps the universal /farms hub remember the last-active farm, and
 *       the explicit reset path is `/api/farms/[slug]/select`.
 */

export type FarmContextDecision =
  | { kind: 'ok'; slug: string }
  | { kind: 'clear-stale-cookie'; slug: string }
  | { kind: 'set-cookie'; slug: string }
  | { kind: 'no-action' };

export function requireFarmContext(
  slugFromUrl: string | null,
  slugFromCookie: string | null,
): FarmContextDecision {
  // No URL slug → request is not on a tenant page; leave the cookie alone
  // regardless of its value. Universal pages (/farms, /login, public APIs)
  // are not authoritative over tenant scope.
  if (!slugFromUrl) {
    return { kind: 'no-action' };
  }

  // Coerce empty-string cookie to absent — defensive for cookie libraries
  // that surface "" instead of null for an empty value.
  const cookie = slugFromCookie && slugFromCookie.length > 0 ? slugFromCookie : null;

  if (cookie === null) {
    return { kind: 'set-cookie', slug: slugFromUrl };
  }

  if (cookie === slugFromUrl) {
    return { kind: 'ok', slug: slugFromUrl };
  }

  // Cookie disagrees with URL — URL wins.
  return { kind: 'clear-stale-cookie', slug: slugFromUrl };
}
