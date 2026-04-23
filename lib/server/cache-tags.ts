/**
 * lib/server/cache-tags.ts
 *
 * Single source of truth for all Next.js cache tags used by `unstable_cache`
 * and `revalidateTag`. No raw tag strings should appear anywhere else in the
 * codebase — import from here.
 *
 * Tag taxonomy:
 *   farm-<slug>              — broad invalidation (use only for global ops like reset)
 *   farm-<slug>-dashboard    — dashboard aggregates + alert counts
 *   farm-<slug>-camps        — camp list, conditions, cover
 *   farm-<slug>-animals      — animal roster, repro stats
 *   farm-<slug>-observations — observation feed, veld assessments
 *   farm-<slug>-settings     — farm settings, species settings, alert thresholds
 *   farm-<slug>-tasks        — tasks + occurrences
 *   farm-<slug>-alerts       — alert rules + notification state
 */

export type FarmCacheScope =
  | "all"
  | "dashboard"
  | "camps"
  | "animals"
  | "observations"
  | "settings"
  | "tasks"
  | "alerts";

/**
 * Build a farm-scoped cache tag.
 *
 * @param slug  The farm slug (e.g. "trio-b").
 * @param scope The data domain being cached. Defaults to "all" (broad nuke).
 *
 * Use the most specific scope possible so that mutations only invalidate
 * what they actually changed.
 */
export function farmTag(slug: string, scope: FarmCacheScope = "all"): string {
  return scope === "all" ? `farm-${slug}` : `farm-${slug}-${scope}`;
}

// ── Convenience tag arrays for common mutation surfaces ───────────────────────
// These are used by lib/server/revalidate.ts — don't call revalidateTag here.

export const animalWriteTags = (slug: string) =>
  [farmTag(slug, "animals"), farmTag(slug, "dashboard")] as const;

export const observationWriteTags = (slug: string) =>
  [farmTag(slug, "observations"), farmTag(slug, "dashboard")] as const;

export const campWriteTags = (slug: string) =>
  [farmTag(slug, "camps"), farmTag(slug, "dashboard")] as const;

export const mobWriteTags = (slug: string) =>
  [farmTag(slug, "animals"), farmTag(slug, "camps")] as const;

export const taskWriteTags = (slug: string) =>
  [farmTag(slug, "tasks")] as const;

export const settingsWriteTags = (slug: string) =>
  [farmTag(slug, "settings")] as const;

export const transactionWriteTags = (slug: string) =>
  [farmTag(slug, "settings"), farmTag(slug, "dashboard")] as const;

export const alertWriteTags = (slug: string) =>
  [farmTag(slug, "alerts"), farmTag(slug, "dashboard")] as const;

export const rotationWriteTags = (slug: string) =>
  [farmTag(slug, "camps"), farmTag(slug, "dashboard")] as const;
