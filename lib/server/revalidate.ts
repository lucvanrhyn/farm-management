/**
 * lib/server/revalidate.ts
 *
 * Thin wrappers that call `revalidateTag` with the correct farm-scoped tags
 * after a successful DB write. Import one of these in every mutation route —
 * never call `revalidateTag` with raw strings.
 *
 * All helpers accept the farm slug so they work both in URL-scoped routes
 * (slug from params) and in shared routes (slug from session / getPrismaWithAuth).
 */

import { revalidateTag } from "next/cache";
import {
  animalWriteTags,
  observationWriteTags,
  campWriteTags,
  mobWriteTags,
  taskWriteTags,
  settingsWriteTags,
  transactionWriteTags,
  alertWriteTags,
  rotationWriteTags,
  notificationWriteTags,
  farmIdentityWriteTags,
  farmTag,
} from "./cache-tags";

// Next.js 16 revalidateTag requires a second "profile" argument.
// "max" means: purge all cache entries with this tag immediately.
const REVALIDATE_PROFILE = "max" as const;

/** Animal create / update / delete / import */
export function revalidateAnimalWrite(slug: string): void {
  for (const tag of animalWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/**
 * Observation create / update / delete / attachment.
 *
 * Issue #413 — `observationType` is REQUIRED. Pass the wire `type` field
 * (e.g. `body.type` in `POST /api/observations`) so the helper can add the
 * `farm-<slug>-camps` tag when the write is a camp-inspection
 * (`camp_condition` / `camp_check`). Pass `null` for routes that reuse
 * this helper without writing a typed Observation row (admin reset,
 * NVD / IT3 / veld-assessment side-channels) — those keep the historical
 * "invalidate observations + dashboard" semantics.
 */
export function revalidateObservationWrite(
  slug: string,
  observationType: string | null,
): void {
  for (const tag of observationWriteTags(slug, observationType)) {
    revalidateTag(tag, REVALIDATE_PROFILE);
  }
}

/** Camp create / update / delete / cover */
export function revalidateCampWrite(slug: string): void {
  for (const tag of campWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Mob create / update / delete + animal-in-mob changes */
export function revalidateMobWrite(slug: string): void {
  for (const tag of mobWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Task create / update / delete */
export function revalidateTaskWrite(slug: string): void {
  for (const tag of taskWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/**
 * Farm / species settings, map config, alert thresholds, AI settings,
 * methodology, billing tier display.
 */
export function revalidateSettingsWrite(slug: string): void {
  for (const tag of settingsWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/**
 * Farm identity cache invalidation (issue #438 — server-rendered farm hero).
 *
 * Must be called whenever `FarmSettings` is written so the `/<slug>/home`
 * RSC re-renders with the new farm name / breed / hero image on next request.
 * `revalidateSettingsWrite` already invalidates the settings tile; this helper
 * separately busts the narrow `farm-<slug>-identity` tag so `getFarmIdentity`
 * in `lib/domain/farm/get-farm-identity.ts` does not serve a stale cached
 * response.
 */
export function revalidateFarmIdentityWrite(slug: string): void {
  for (const tag of farmIdentityWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Transaction / budget / category writes */
export function revalidateTransactionWrite(slug: string): void {
  for (const tag of transactionWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Alert rule changes */
export function revalidateAlertWrite(slug: string): void {
  for (const tag of alertWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Rotation plan / step / execute */
export function revalidateRotationWrite(slug: string): void {
  for (const tag of rotationWriteTags(slug)) revalidateTag(tag, REVALIDATE_PROFILE);
}

/**
 * Notification create / mark-read / expire.
 *
 * Pass `userEmail` for user-specific mutations (e.g. mark-as-read) so only
 * that user's cached feed is invalidated. Omit for farm-wide mutations (e.g.
 * the cron that generates new alerts for the whole farm) — which will only
 * bust the farm-scoped tag and leave per-user overlays untouched.
 */
export function revalidateNotificationWrite(
  slug: string,
  userEmail?: string,
): void {
  for (const tag of notificationWriteTags(slug, userEmail)) {
    revalidateTag(tag, REVALIDATE_PROFILE);
  }
}

/**
 * Broad nuke — invalidates all cached data for a farm.
 * Only use for global operations like /admin/reset or reset endpoints.
 */
export function revalidateFarmAll(slug: string): void {
  revalidateTag(farmTag(slug, "all"), REVALIDATE_PROFILE);
}
