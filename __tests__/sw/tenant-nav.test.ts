/**
 * __tests__/sw/tenant-nav.test.ts
 *
 * Locks in the predicate that decides which navigation requests are
 * tenant-scoped and MUST bypass the navigation cache (issue #397).
 *
 * Why this test exists
 * ────────────────────
 * Issue #393 made the URL `[farmSlug]` the single tenant source of truth
 * on the server. But Serwist's navigation StaleWhileRevalidate cache could
 * still satisfy a navigation to `/farm-b/dashboard` with a cached shell
 * that was rendered while the user was on farm A — the cache is path-keyed,
 * but SWR returns the stale entry immediately on every cache hit. Because
 * the cached HTML embeds tenant-specific data in the React tree, the user
 * could see farm A's data on a farm B URL for the duration of one revalidate
 * window.
 *
 * The fix (strategy 2 in the issue) routes every `/[farmSlug]/...` navigation
 * through `NetworkOnly`, so the shell is never served from cache. Static
 * assets (chunks, images, geojson) keep their existing caching strategies.
 *
 * The pure predicate lives in `lib/sw/tenant-nav.ts` so it can be unit-tested
 * without booting a service worker. The matcher in `app/sw.ts` wraps it.
 *
 * Domain note — what counts as a "tenant slug"
 * ────────────────────────────────────────────
 * Slugs match the project-wide pattern `^[a-z0-9][a-z0-9-]{0,63}$` (see
 * `FARM_SLUG_RE` in `lib/farm-prisma.ts`). The first path segment is the
 * candidate slug. We must NOT treat the following top-level routes as
 * tenant pages:
 *   /                       — anonymous landing / authenticated /home redirect
 *   /api/...                — API routes (already handled by their own matcher)
 *   /_next/...              — Next.js build assets
 *   /farms                  — universal authenticated entry point
 *   /home                   — universal authenticated entry point
 *   /login, /register,      — auth surfaces
 *     /verify-email
 *   /offline                — Serwist offline fallback (must stay cacheable)
 *   /pricing, /subscribe,   — public marketing
 *     /demo
 *   /manifest.json,         — PWA artifacts
 *     /sw.js, /icon-*.png
 *   /favicon.ico,           — site root files
 *     /robots.txt, /sitemap.xml
 */

import { describe, it, expect } from "vitest";
import { isTenantNavigationRequest } from "@/lib/sw/tenant-nav";

describe("isTenantNavigationRequest", () => {
  // ── Tenant URLs MUST be NetworkOnly (predicate returns true) ────────────

  it("returns true for the bare tenant home", () => {
    expect(isTenantNavigationRequest("/basson-boerdery")).toBe(true);
  });

  it("returns true for a tenant dashboard", () => {
    expect(isTenantNavigationRequest("/basson-boerdery/dashboard")).toBe(true);
  });

  it("returns true for a tenant admin sub-page", () => {
    expect(isTenantNavigationRequest("/basson-boerdery/admin/animals")).toBe(true);
  });

  it("returns true for a tenant logger page", () => {
    expect(isTenantNavigationRequest("/basson-boerdery/logger")).toBe(true);
  });

  it("returns true for a tenant logger camp page", () => {
    expect(isTenantNavigationRequest("/basson-boerdery/logger/BB-C014")).toBe(true);
  });

  it("returns true for the tenant map page (issue #256)", () => {
    expect(isTenantNavigationRequest("/basson-boerdery/map")).toBe(true);
  });

  it("returns true for tenant sheep + game species namespaces", () => {
    expect(isTenantNavigationRequest("/basson-boerdery/sheep")).toBe(true);
    expect(isTenantNavigationRequest("/basson-boerdery/game/animals")).toBe(true);
  });

  it("returns true for short numeric-leading slugs (e.g. '1-farm')", () => {
    // FARM_SLUG_RE accepts a leading digit.
    expect(isTenantNavigationRequest("/1-farm/dashboard")).toBe(true);
  });

  // ── Non-tenant URLs MUST stay cacheable (predicate returns false) ───────

  it("returns false for the root path", () => {
    expect(isTenantNavigationRequest("/")).toBe(false);
  });

  it("returns false for /farms (universal entry point)", () => {
    expect(isTenantNavigationRequest("/farms")).toBe(false);
    expect(isTenantNavigationRequest("/farms/select")).toBe(false);
  });

  it("returns false for /home", () => {
    expect(isTenantNavigationRequest("/home")).toBe(false);
  });

  it("returns false for auth routes", () => {
    expect(isTenantNavigationRequest("/login")).toBe(false);
    expect(isTenantNavigationRequest("/register")).toBe(false);
    expect(isTenantNavigationRequest("/verify-email")).toBe(false);
    // Password-reset surfaces (PRs #540/#542) — latent reserved-list gap
    // closed when S10/sync-L2 made offline-store consume this predicate.
    expect(isTenantNavigationRequest("/forgot-password")).toBe(false);
    expect(isTenantNavigationRequest("/reset-password")).toBe(false);
  });

  it("returns false for /offline (Serwist fallback must stay cached)", () => {
    expect(isTenantNavigationRequest("/offline")).toBe(false);
  });

  it("returns false for public marketing surfaces", () => {
    expect(isTenantNavigationRequest("/pricing")).toBe(false);
    expect(isTenantNavigationRequest("/subscribe")).toBe(false);
    expect(isTenantNavigationRequest("/demo")).toBe(false);
  });

  it("returns false for /api/* (handled by its own matcher)", () => {
    expect(isTenantNavigationRequest("/api/camps")).toBe(false);
    expect(isTenantNavigationRequest("/api/farms/basson-boerdery/select")).toBe(false);
  });

  it("returns false for /_next/* build assets", () => {
    expect(isTenantNavigationRequest("/_next/static/chunks/main.js")).toBe(false);
    expect(isTenantNavigationRequest("/_next/data/dashboard.json")).toBe(false);
  });

  it("returns false for PWA artifacts and site root files", () => {
    expect(isTenantNavigationRequest("/manifest.json")).toBe(false);
    expect(isTenantNavigationRequest("/sw.js")).toBe(false);
    expect(isTenantNavigationRequest("/favicon.ico")).toBe(false);
    expect(isTenantNavigationRequest("/robots.txt")).toBe(false);
    expect(isTenantNavigationRequest("/icon-192x192.png")).toBe(false);
  });

  it("returns false for paths whose first segment is not a valid slug", () => {
    // Uppercase fails FARM_SLUG_RE.
    expect(isTenantNavigationRequest("/Basson-Boerdery/dashboard")).toBe(false);
    // Leading hyphen fails FARM_SLUG_RE.
    expect(isTenantNavigationRequest("/-bad/dashboard")).toBe(false);
    // Slugs >64 chars fail FARM_SLUG_RE.
    const tooLong = "a".repeat(65);
    expect(isTenantNavigationRequest(`/${tooLong}/dashboard`)).toBe(false);
  });

  it("returns false for image assets at the site root", () => {
    // brangus.jpg / farm-select.jpg etc. are served from /. Their own
    // cacheFirst matcher handles them — they must NOT be NetworkOnly.
    expect(isTenantNavigationRequest("/brangus.jpg")).toBe(false);
    expect(isTenantNavigationRequest("/farm-select.jpg")).toBe(false);
  });

  it("returns false for the empty string (defensive)", () => {
    expect(isTenantNavigationRequest("")).toBe(false);
  });
});
