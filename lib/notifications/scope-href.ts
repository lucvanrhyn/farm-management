// lib/notifications/scope-href.ts — the single owner of notification deep-link
// farm-scoping.
//
// A persisted Notification.href is a deep-link consumed by three surfaces with
// very different amounts of context:
//   - the in-app NotificationBell (knows the active farmSlug),
//   - the daily email digest (knows the farmSlug),
//   - the push service worker (app/sw.ts) which has NO farm context at all — it
//     navigates to whatever href the push payload carries, verbatim.
//
// Because the push SW cannot reconstruct the slug, the persisted href MUST be
// self-contained: the alert generators emit a complete `/${farmSlug}/...` path
// at source (honouring the AlertCandidate.href "farm-scoped" contract). This
// helper is the shared, idempotent guard the two context-aware consumers use so
// that:
//   - an already-scoped href is returned unchanged (no `/slug/slug/...`),
//   - a legacy bare href (`/admin/...`, persisted before the source fix and
//     still inside its ≤24h TTL) is self-healed to the active farm,
//   - query string and hash are preserved (the previous inline bell impl went
//     through `new URL(...).pathname` and silently dropped `?focus=`).
//
// Absolute (http/https) hrefs are returned unchanged — generators never emit
// them, but defending here keeps every caller a one-liner.

/**
 * Return `href` as a farm-scoped, leading-slash path (`/${farmSlug}/...`),
 * idempotently. Preserves query and hash. Absolute URLs pass through unchanged.
 */
export function scopeHref(href: string, farmSlug: string): string {
  if (!farmSlug) return href;
  if (/^https?:\/\//i.test(href)) return href;

  // Normalise to a leading-slash path without touching query/hash.
  let path = href.startsWith("/") ? href : `/${href}`;

  // Strip an existing farm-slug segment so re-scoping is a no-op. We only strip
  // when `/${farmSlug}` is a whole path segment — i.e. followed by `/`, `?`,
  // `#`, or end-of-string — never a prefix match like `/${farmSlug}-other`.
  const prefix = `/${farmSlug}`;
  if (
    path === prefix ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}?`) ||
    path.startsWith(`${prefix}#`)
  ) {
    path = path.slice(prefix.length) || "/";
  }

  return `${prefix}${path}`;
}
