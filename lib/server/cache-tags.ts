import { isCampInspection } from "@/lib/domain/observations/is-camp-inspection";

/**
 * lib/server/cache-tags.ts
 *
 * Single source of truth for all Next.js cache tags used by `unstable_cache`
 * and `revalidateTag`. No raw tag strings should appear anywhere else in the
 * codebase — import from here.
 *
 * Tag taxonomy:
 *   farm-<slug>                — broad invalidation (use only for global ops like reset)
 *   farm-<slug>-dashboard      — dashboard aggregates + alert counts
 *   farm-<slug>-camps          — camp list, conditions, cover
 *   farm-<slug>-animals        — animal roster, repro stats
 *   farm-<slug>-observations   — observation feed, veld assessments
 *   farm-<slug>-settings       — farm settings, species settings, alert thresholds
 *   farm-<slug>-tasks          — tasks + occurrences
 *   farm-<slug>-alerts         — alert rules + notification state
 *   farm-<slug>-notifications  — unread notification feed served to /api/notifications
 *   user-notifications-<email> — per-user overlay for mark-read mutations
 */

export type FarmCacheScope =
  | "all"
  | "dashboard"
  | "camps"
  | "animals"
  | "observations"
  | "settings"
  | "tasks"
  | "alerts"
  | "notifications";

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

/**
 * Tags to invalidate after an animal write (create / update / delete / import).
 *
 * Issue #420 — the `farm-<slug>-camps` tag is REQUIRED. The Logger Home
 * camp grid and `GET /api/camps` (`getCachedCampList` in
 * `lib/server/cached.ts`) derive per-camp `animal_count` from an
 * `animal.groupBy({ by: ["currentCamp"] })` over the animal roster, so an
 * animal write that omits the camps tag (e.g. an `animal_movement` /
 * PATCH `currentCamp`) leaves the camp tiles stale until TTL. Mirror of
 * the `observationWriteTags` camps coupling shipped by PRD #412 (#413).
 * Remove the camps tag only if you have also decoupled `getCachedCampList`
 * from the animal-roster groupBy.
 */
export const animalWriteTags = (slug: string) =>
  [farmTag(slug, "animals"), farmTag(slug, "dashboard"), farmTag(slug, "camps")] as const;

/**
 * Tags to invalidate after an observation write.
 *
 * Issue #413 — `observationType` is now REQUIRED (no overload). When
 * the type is a camp-inspection write (`camp_condition` / `camp_check`,
 * per `isCampInspection` in `lib/domain/observations/`), the
 * `farm-<slug>-camps` tag is added so cached camp-scoped fetchers
 * invalidate. Pass `null` for writes that do not have a single
 * observation type (admin reset, NVD/IT3 reuse) — the camps tag is
 * NOT added in that case.
 *
 * Background: pre-#413 this helper returned only
 * `[observations, dashboard]`, leaving cached camp fetchers stale
 * until TTL — see issue #409 and PRD #412 for the staleness class.
 */
export const observationWriteTags = (
  slug: string,
  observationType: string | null,
): readonly string[] => {
  const tags: string[] = [farmTag(slug, "observations"), farmTag(slug, "dashboard")];
  if (observationType !== null && isCampInspection(observationType)) {
    tags.push(farmTag(slug, "camps"));
  }
  return tags;
};

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

/**
 * Per-user notification tag.
 *
 * The notification feed served by `/api/notifications` is both farm-scoped
 * (cron writes new rows for the whole farm) and user-scoped (the mark-read
 * mutation only affects the current user's view). We tag cache entries with
 * BOTH so that either class of write can invalidate the correct slice.
 */
export function notificationTag(userEmail: string): string {
  return `user-notifications-${userEmail}`;
}

export const notificationWriteTags = (slug: string, userEmail?: string) => {
  const base: string[] = [farmTag(slug, "notifications")];
  if (userEmail) base.push(notificationTag(userEmail));
  return base as readonly string[];
};
