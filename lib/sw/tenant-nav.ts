/**
 * lib/sw/tenant-nav.ts
 *
 * Pure URL predicate used by the Serwist navigation matcher to identify
 * tenant-scoped (`/[farmSlug]/...`) page requests that MUST bypass the
 * navigation cache. Returning `true` here routes the request to
 * `NetworkOnly`; returning `false` lets it fall through to the regular
 * StaleWhileRevalidate "pages" cache (which still serves offline support
 * for the universal entry points `/farms`, `/home`, `/offline`, etc).
 *
 * Background — issue #397 (PRD #389, Module 3 — 2026-05-23)
 * ─────────────────────────────────────────────────────────
 * Issue #393 hardened the server side of the farm-context guard: the URL
 * `[farmSlug]` is now the single tenant source of truth. But the PWA shell
 * remained vulnerable because Serwist's navigation cache is a path-keyed
 * `StaleWhileRevalidate`. When a user with an installed service worker
 * navigates from `/farm-a/dashboard` to `/farm-b/dashboard`, the path key
 * (`/farm-b/dashboard`) is admittedly different — but a returning user who
 * had previously visited `/farm-b/dashboard` while logged in as another
 * tenant could be served a *cached* shell whose React tree embeds the
 * other tenant's data, before the revalidate response arrives.
 *
 * That is the exact failure mode behind "clean headless browser did not
 * reproduce" Codex's farm-context desync — the bug requires the installed
 * SW plus a prior cache entry for the target URL.
 *
 * Strategy 2 chosen: NetworkOnly for tenant navigation
 * ────────────────────────────────────────────────────
 * The issue offered two strategies:
 *   1. Per-slug cache key — only protects against identical-URL leaks. Does
 *      not address the "stale shell still embeds tenant data" race that
 *      happens whenever the same URL is visited by two different users on
 *      the same browser profile.
 *   2. NetworkOnly for `/[farmSlug]/...` navigation — the shell is never
 *      served from cache for tenant routes. Static assets (chunks, images,
 *      geojson, etc.) keep their existing CacheFirst / SWR strategies and
 *      offline support survives for non-tenant routes (the `/offline`
 *      fallback still kicks in via Serwist's `fallbacks.entries` block).
 *
 * We picked (2) because it eliminates the leak class structurally rather
 * than narrowing it. The tradeoff is that an offline navigation into a
 * tenant route falls through to the `/offline` fallback page — but that
 * was already the user experience for tenant routes that hadn't been
 * pre-visited online. The logger flow (`/[farmSlug]/logger/[campId]`)
 * remains offline-capable because LoggerLayout pre-fetches the camp pages
 * online and the secondary `/logger/*` matcher in `app/sw.ts` warms the
 * "pages" cache for non-navigate (mode: "same-origin") fetches that bypass
 * this predicate.
 *
 * Wait — doesn't NetworkOnly for tenant nav break the offline logger?
 * No: when LoggerLayout fires a programmatic fetch of `/[farmSlug]/logger/[campId]`,
 * the request mode is `"same-origin"` (not `"navigate"`), so the Serwist
 * navigation matcher does not match at all. The next matcher in
 * `app/sw.ts` (the `/logger/` rule) catches it and writes the response
 * into the "pages" cache. When the user later hard-navigates to that camp
 * URL offline, the new NetworkOnly matcher fails (offline) and the
 * `fallbacks.entries` block serves `/offline` — which is correct, because
 * a hard navigation goes through SSR and SSR is offline-unavailable. The
 * client-side router (Link / push) skips the navigation matcher entirely
 * because it does an RSC fetch, not a document navigation, so SPA-style
 * offline logger flow is unchanged.
 *
 * Domain — what counts as a tenant slug
 * ─────────────────────────────────────
 * The pattern matches the project-wide `FARM_SLUG_RE` in
 * `lib/farm-prisma.ts`: `^[a-z0-9][a-z0-9-]{0,63}$`. The first path segment
 * must be a candidate slug; reserved top-level routes (`/farms`, `/home`,
 * `/login`, `/api`, `/_next`, `/offline`, `/pricing`, `/subscribe`,
 * `/demo`, `/verify-email`, `/register`, `/manifest.json`, `/sw.js`,
 * `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, root images) are excluded.
 * That excludes list is the authoritative non-tenant set; anything else
 * whose first segment matches `FARM_SLUG_RE` is treated as a tenant URL.
 *
 * Keeping the reserved-route list in this module (rather than re-deriving
 * from `proxy.ts`'s middleware matcher) is intentional: the matcher uses a
 * negative-lookahead regex that is awkward to consume from a pure
 * predicate, and the reserved set rarely changes. If a NEW top-level route
 * is ever added that is NOT a tenant slug, add it to RESERVED_TOP_LEVEL
 * below. The unit suite in `__tests__/sw/tenant-nav.test.ts` covers every
 * known reserved route as a regression guard.
 *
 * Pure & framework-free so it can be unit-tested without booting a service
 * worker (mirror of `lib/sw/telemetry-bypass.ts`).
 */

/**
 * Mirrors `FARM_SLUG_RE` in `lib/farm-prisma.ts`. Anchored — the pattern
 * matches the entire candidate string, so anything with a slash or invalid
 * char fails.
 */
const FARM_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Reserved top-level path segments that must NEVER be treated as a tenant
 * slug. Order doesn't matter — this is a `Set` lookup.
 *
 * Includes the universal entry points (`farms`, `home`), auth surfaces,
 * Serwist artifacts, public marketing pages, and bare API/Next prefixes.
 * Site-root files (favicon, manifest, sw.js, robots, sitemap) and root
 * image assets (brangus.jpg, farm-select.jpg) are handled by extension
 * + literal checks in `isTenantNavigationRequest` directly.
 */
const RESERVED_TOP_LEVEL = new Set<string>([
  "api",
  "_next",
  "farms",
  "home",
  "login",
  "register",
  "verify-email",
  // Password-reset surfaces (PRs #540/#542) — added to the reserved set when
  // S10/sync-L2 made `lib/offline-store.ts` consume this predicate for
  // tenant-DB resolution; they were latent gaps since the routes shipped.
  "forgot-password",
  "reset-password",
  "offline",
  "pricing",
  "subscribe",
  "demo",
]);

/**
 * Returns true when the given pathname is a tenant-scoped navigation that
 * must bypass the Serwist navigation cache.
 *
 * @param pathname - URL pathname (must start with `/`; empty string is
 *   treated as non-tenant for defensive parity with the SW matcher input).
 */
export function isTenantNavigationRequest(pathname: string): boolean {
  // Defensive: an empty / non-rooted pathname can't be a tenant URL.
  if (!pathname || pathname[0] !== "/") return false;

  // Root path is the anonymous landing / authenticated home redirect.
  if (pathname === "/") return false;

  // Split: "/foo/bar" -> ["", "foo", "bar"]. We want index 1.
  const slash = pathname.indexOf("/", 1);
  const firstSegment = slash === -1 ? pathname.slice(1) : pathname.slice(1, slash);

  // Reserved top-level prefix (api, _next, farms, home, login, etc.).
  if (RESERVED_TOP_LEVEL.has(firstSegment)) return false;

  // Site-root files: anything containing a `.` in the first segment is a
  // file (favicon.ico, manifest.json, sw.js, robots.txt, sitemap.xml, root
  // images). They are not tenant pages and must keep their own caching.
  if (firstSegment.includes(".")) return false;

  // First segment must match the canonical FARM_SLUG_RE. Anything that
  // fails (uppercase, leading hyphen, > 64 chars, etc.) is not a tenant
  // URL by definition.
  return FARM_SLUG_RE.test(firstSegment);
}
