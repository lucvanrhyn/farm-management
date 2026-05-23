/**
 * @vitest-environment node
 *
 * Issue #393 (PRD #389, Module 3 / W2 — server + middleware slice).
 *
 * The URL `[farmSlug]` is the single tenant source of truth on the server.
 * `requireFarmContext(urlSlug, cookieSlug)` is the pure decision function
 * that says what to do with the `active_farm_slug` cookie for a given
 * request.
 *
 * Matrix:
 *   - match (urlSlug === cookieSlug) → ok (no cookie write)
 *   - mismatch (urlSlug !== cookieSlug, both present) → clear-stale-cookie
 *     (the URL slug is authoritative; the cookie carries an old/foreign
 *     value and must be cleared on the response)
 *   - no cookie (urlSlug !== null, cookieSlug === null) → set-cookie
 *     (write the URL slug so client-side API calls without a [farmSlug]
 *     segment can still resolve the tenant)
 *   - no URL slug (urlSlug === null, regardless of cookieSlug) → no-action
 *     (the request is not a tenant page; leave the cookie alone)
 *
 * The function is pure: no I/O, no globals, deterministic for any
 * (urlSlug, cookieSlug) pair. Tests below assert every cell of the matrix
 * plus edge cases (empty-string vs null, identical case).
 */

import { describe, it, expect } from 'vitest';
import { requireFarmContext } from '@/lib/farm-context';

describe('requireFarmContext', () => {
  // ── Match ──────────────────────────────────────────────────────────────
  it('returns { kind: "ok", slug } when URL slug matches cookie slug', () => {
    const result = requireFarmContext('basson-boerdery', 'basson-boerdery');
    expect(result).toEqual({ kind: 'ok', slug: 'basson-boerdery' });
  });

  it('match is case-sensitive (slugs lowercase by FARM_SLUG_RE; rejected otherwise)', () => {
    // Slugs are always lowercased by the time they reach the decision
    // function; a case-mismatch is therefore semantic mismatch, not match.
    const result = requireFarmContext('basson-boerdery', 'Basson-Boerdery');
    expect(result).toEqual({
      kind: 'clear-stale-cookie',
      slug: 'basson-boerdery',
    });
  });

  // ── Mismatch ───────────────────────────────────────────────────────────
  it('returns { kind: "clear-stale-cookie", slug: URL } when URL slug differs from cookie slug', () => {
    // User navigates from basson-boerdery to trio-b-boerdery. The cookie
    // is stale — the URL is authoritative. The response must clear the
    // cookie so client-side API calls can't accidentally pick up the
    // wrong tenant on first paint.
    const result = requireFarmContext('trio-b-boerdery', 'basson-boerdery');
    expect(result).toEqual({
      kind: 'clear-stale-cookie',
      slug: 'trio-b-boerdery',
    });
  });

  it('clear-stale-cookie carries the URL slug (not the cookie slug) as the new authoritative', () => {
    // Defensive — the brief is unambiguous that the URL wins. Any future
    // refactor that swaps the slug on this variant will fail this test.
    const result = requireFarmContext('farm-b', 'farm-a');
    expect(result.kind).toBe('clear-stale-cookie');
    if (result.kind === 'clear-stale-cookie') {
      expect(result.slug).toBe('farm-b');
    }
  });

  // ── No cookie ──────────────────────────────────────────────────────────
  it('returns { kind: "set-cookie", slug: URL } when URL has a slug but cookie is missing', () => {
    // First visit to a tenant URL after a fresh login (or after a logout
    // that cleared the cookie). The cookie must be set so non-page
    // requests (client-side fetches that don't include [farmSlug] in the
    // URL) can still resolve the tenant.
    const result = requireFarmContext('basson-boerdery', null);
    expect(result).toEqual({
      kind: 'set-cookie',
      slug: 'basson-boerdery',
    });
  });

  it('treats an empty-string cookie value the same as missing cookie', () => {
    // Defensive — cookie libraries sometimes surface "" instead of null
    // for a deleted-but-still-in-the-Cookie-header value. An empty cookie
    // is not a valid slug; treat it as absent.
    const result = requireFarmContext('basson-boerdery', '');
    expect(result).toEqual({
      kind: 'set-cookie',
      slug: 'basson-boerdery',
    });
  });

  // ── No URL slug ────────────────────────────────────────────────────────
  it('returns { kind: "no-action" } when the URL has no farm slug and cookie is absent', () => {
    // Non-tenant page (e.g. /farms, /login, /api/farms/.../select).
    // Nothing to write or clear.
    const result = requireFarmContext(null, null);
    expect(result).toEqual({ kind: 'no-action' });
  });

  it('returns { kind: "no-action" } when the URL has no farm slug and cookie is present', () => {
    // User is on /farms with an old cookie hanging around. We deliberately
    // do NOT clear it here — the cookie still helps the universal /farms
    // hub remember the last-active farm and the /api/farms/[slug]/select
    // route is the explicit reset path. This variant is the pass-through.
    const result = requireFarmContext(null, 'basson-boerdery');
    expect(result).toEqual({ kind: 'no-action' });
  });

  // ── Purity ─────────────────────────────────────────────────────────────
  it('is referentially transparent (same inputs → same output, no shared state)', () => {
    const a = requireFarmContext('basson-boerdery', 'basson-boerdery');
    const b = requireFarmContext('basson-boerdery', 'basson-boerdery');
    expect(a).toEqual(b);
    // Different object identity → fresh value each call (no leaked mutation).
    expect(a).not.toBe(b);
  });
});
